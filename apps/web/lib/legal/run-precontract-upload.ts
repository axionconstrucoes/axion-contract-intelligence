// Orquestração do upload da análise pré-contratual, com TODAS as
// dependências injetadas. Deliberadamente fora do React: assim o
// pipeline inteiro (hash, deduplicação, decisão humana, upload com
// progresso, registro, limpeza de órfão, verificação) é testável em Node
// puro, sem navegador, sem rede e sem Supabase.
//
// Reutiliza as funções já existentes do upload múltiplo em vez de
// reimplementar uma versão reduzida:
//   computeFileSha256Hex, classifyCandidate, nextVersionLabel,
//   removeOrphanedStorageObject, register_project_document_upload.

import {
  classifyCandidate,
  nextVersionLabel,
  sanitizeFileName,
} from "@/lib/documents/multi-upload/queue-core";
import type { ExistingDocumentSnapshot } from "@/lib/documents/multi-upload/types";
import { removeOrphanedStorageObject } from "@/lib/documents/multi-upload/storage-cleanup";
import { resolveExtractionFormat, unsupportedFormatDetail } from "@/lib/documents/extraction/document-format";
import {
  uploadTimeoutForSize,
  UPLOAD_FAILURE_MESSAGES,
  UploadTransportError,
  type UploadTransport,
} from "./precontract-upload-transport";
import type {
  PrecontractDocumentStatus,
  PrecontractPendingDecision,
  VerifyPrecontractDocumentResult,
} from "./precontract-document-state";

const BUCKET = "project-documents";

export interface UploadPatch {
  status?: PrecontractDocumentStatus;
  uploadPercent?: number;
  documentId?: string | null;
  documentVersionId?: string | null;
  versionLabel?: string | null;
  pageCount?: number | null;
  characterCount?: number | null;
  message?: string | null;
  pendingDecision?: PrecontractPendingDecision | null;
}

export interface RegisterUploadArgs {
  p_project_id: string;
  p_document_id: string;
  p_document_version_id: string;
  p_kind: string;
  p_title: string;
  p_version_label: string;
  p_document_date: string;
  p_source_type: string;
  p_author: string;
  p_summary: string;
  p_file_path: string;
  p_original_file_name: string;
  p_mime_type: string | null;
  p_file_size_bytes: number;
  p_notes: string | null;
  p_sha256_hash: string;
}

export interface PrecontractUploadDeps {
  transport: UploadTransport;
  /** SHA-256 real do arquivo — o mesmo helper do upload múltiplo. */
  computeSha256: (file: Blob) => Promise<string>;
  getSession: () => Promise<{ accessToken: string; userEmail: string | null } | null>;
  storageBaseUrl: string;
  registerUpload: (args: RegisterUploadArgs) => Promise<{ error: { message: string } | null }>;
  removeStorageObject: (paths: string[]) => Promise<{ error: { message: string } | null }>;
  verifyDocument: (projectId: string, documentVersionId: string) => Promise<VerifyPrecontractDocumentResult>;
  newId: () => string;
  timeoutMs?: number;
}

export interface PrecontractUploadParams {
  projectId: string;
  file: File | Blob;
  fileName: string;
  fileSize: number;
  mimeType: string | null;
  kind: string;
  existingDocuments: readonly ExistingDocumentSnapshot[];
  /** hash -> id de item já enviado nesta sessão (dedup dentro do lote). */
  batchHashIndex: ReadonlyMap<string, string>;
  itemId: string;
  /**
   * Decisão humana já tomada para este arquivo. `undefined` significa
   * "ainda não perguntamos" — nesse caso o fluxo PARA em
   * AGUARDANDO_DECISAO em vez de escolher sozinho.
   */
  decision?: "NOVA_VERSAO" | "DOCUMENTO_SEPARADO";
  onPatch: (patch: UploadPatch) => void;
  onAbortHandle?: (abort: () => void) => void;
}

export interface PrecontractUploadOutcome {
  status: PrecontractDocumentStatus;
  sha256Hash: string | null;
  documentId: string | null;
  documentVersionId: string | null;
  storagePath: string | null;
  /** Preenchido quando a limpeza do objeto órfão falhou — nunca engolido. */
  reconciliationError: string | null;
}

function deriveTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || fileName;
}

/**
 * Executa o pipeline completo de um arquivo. Retorna o desfecho; os
 * estados intermediários saem por `onPatch`.
 */
export async function runPrecontractUpload(
  deps: PrecontractUploadDeps,
  params: PrecontractUploadParams
): Promise<PrecontractUploadOutcome> {
  const fail = (message: string, status: PrecontractDocumentStatus = "ERRO"): PrecontractUploadOutcome => {
    params.onPatch({ status, message });
    return {
      status,
      sha256Hash: null,
      documentId: null,
      documentVersionId: null,
      storagePath: null,
      reconciliationError: null,
    };
  };

  // 0. Formato: recusa antes de qualquer byte sair do navegador. O
  // motivo vem de document-format.ts (fonte única), e no caso do .mpp
  // diz como exportar em .xlsx em vez de só recusar.
  if (resolveExtractionFormat(params.mimeType, params.fileName) === null) {
    return fail(unsupportedFormatDetail(params.mimeType, params.fileName));
  }

  const session = await deps.getSession();
  if (!session) {
    return fail("Sessão expirada. Entre novamente para continuar.");
  }

  // 1. SHA-256 real — base da deduplicação e do que vai à RPC.
  let sha256Hash: string;
  try {
    sha256Hash = await deps.computeSha256(params.file);
  } catch (error) {
    console.error("[precontract-upload] falha ao calcular o hash:", error);
    return fail("Não foi possível ler o arquivo para verificação. Tente novamente.");
  }

  // 2. Classificação: duplicado / nova versão / conflito / novo.
  const classification = classifyCandidate({
    sha256Hash,
    fileName: params.fileName,
    kind: params.kind,
    existingDocuments: params.existingDocuments,
    batchHashIndex: params.batchHashIndex,
    currentQueueItemId: params.itemId,
  });

  if (classification.classification === "DUPLICADO") {
    params.onPatch({ status: "DUPLICADO", message: classification.reason, uploadPercent: 100 });
    return {
      status: "DUPLICADO",
      sha256Hash,
      documentId: classification.matchedDocumentId,
      documentVersionId: null,
      storagePath: null,
      reconciliationError: null,
    };
  }

  // Nova versão / conflito EXIGEM confirmação humana — nunca decidimos.
  if (
    (classification.classification === "NOVA_VERSAO" || classification.classification === "CONFLITO") &&
    params.decision === undefined
  ) {
    params.onPatch({
      status: "AGUARDANDO_DECISAO",
      message: classification.reason,
      pendingDecision: {
        classification: classification.classification,
        matchedDocumentId: classification.matchedDocumentId ?? "",
        matchedDocumentTitle: classification.matchedDocumentTitle ?? "",
        reason: classification.reason,
      },
    });
    return {
      status: "AGUARDANDO_DECISAO",
      sha256Hash,
      documentId: null,
      documentVersionId: null,
      storagePath: null,
      reconciliationError: null,
    };
  }

  const matched =
    params.decision === "NOVA_VERSAO" && classification.matchedDocumentId
      ? params.existingDocuments.find((document) => document.documentId === classification.matchedDocumentId)
      : undefined;

  const isNewVersion = params.decision === "NOVA_VERSAO" && matched !== undefined;

  const documentId = isNewVersion && matched ? matched.documentId : deps.newId();
  const documentVersionId = deps.newId();
  const versionLabel = isNewVersion && matched ? nextVersionLabel(matched) : "1.0";
  const title = isNewVersion && matched ? matched.title : deriveTitle(params.fileName);

  // Caminho imutável: sempre um documentVersionId novo, nunca sobrescreve.
  const storagePath = `${params.projectId}/${documentId}/${documentVersionId}/${sanitizeFileName(params.fileName)}`;

  params.onPatch({
    status: "ENVIANDO",
    uploadPercent: 0,
    documentId,
    documentVersionId,
    versionLabel,
    pendingDecision: null,
    message: null,
  });

  // 3. Upload com progresso real.
  try {
    await deps.transport({
      url: `${deps.storageBaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`,
      accessToken: session.accessToken,
      body: params.file,
      contentType: params.mimeType,
      // Timeout proporcional ao tamanho: 120 s para arquivo pequeno,
      // mais tempo para contrato grande, teto de 15 min.
      timeoutMs: deps.timeoutMs ?? uploadTimeoutForSize(params.fileSize),
      onProgress: (percent) => params.onPatch({ uploadPercent: percent }),
      onAbortHandle: params.onAbortHandle,
    });
  } catch (error) {
    const message =
      error instanceof UploadTransportError
        ? error.message
        : UPLOAD_FAILURE_MESSAGES.RESPOSTA_INVALIDA;

    // Cancelamento e timeout também podem ter deixado bytes no Storage.
    const cleanup = await removeOrphanedStorageObject(deps.removeStorageObject, storagePath);

    params.onPatch({ status: "ERRO", message, uploadPercent: 0, documentId: null, documentVersionId: null });
    return {
      status: "ERRO",
      sha256Hash,
      documentId: null,
      documentVersionId: null,
      storagePath,
      reconciliationError: cleanup.reconciliationError,
    };
  }

  // 100% enviado ≠ pronto.
  params.onPatch({ status: "PROCESSANDO", uploadPercent: 100 });

  // 4. Registro. Falhou? O objeto do Storage é removido — nunca fica órfão.
  const { error: registerError } = await deps.registerUpload({
    p_project_id: params.projectId,
    p_document_id: documentId,
    p_document_version_id: documentVersionId,
    p_kind: params.kind,
    p_title: title,
    p_version_label: versionLabel,
    p_document_date: new Date().toISOString().slice(0, 10),
    p_source_type: "UPLOAD_MANUAL",
    p_author: session.userEmail || "Análise jurídica pré-contratual",
    p_summary: "Documento enviado na análise jurídica pré-contratual.",
    p_file_path: storagePath,
    p_original_file_name: params.fileName,
    p_mime_type: params.mimeType,
    p_file_size_bytes: params.fileSize,
    p_notes: null,
    p_sha256_hash: sha256Hash,
  });

  if (registerError) {
    console.error("[precontract-upload] falha no registro:", registerError.message);
    const cleanup = await removeOrphanedStorageObject(deps.removeStorageObject, storagePath);

    params.onPatch({
      status: "ERRO",
      message: cleanup.reconciliationError
        ? "Não foi possível registrar o documento e o arquivo enviado não pôde ser removido. Avise o administrador."
        : "Não foi possível registrar o documento nesta análise. Tente novamente.",
      documentId: null,
      documentVersionId: null,
    });

    return {
      status: "ERRO",
      sha256Hash,
      documentId: null,
      documentVersionId: null,
      storagePath,
      reconciliationError: cleanup.reconciliationError,
    };
  }

  // 5. Só o servidor promove para PRONTO, relendo o arquivo.
  const verification = await deps.verifyDocument(params.projectId, documentVersionId);

  params.onPatch({
    status: verification.status,
    pageCount: verification.pageCount,
    characterCount: verification.characterCount,
    message: verification.message,
  });

  return {
    status: verification.status,
    sha256Hash,
    documentId,
    documentVersionId,
    storagePath,
    reconciliationError: null,
  };
}
