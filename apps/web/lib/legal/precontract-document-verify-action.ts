"use server";

// Server Actions que confirmam se os documentos da análise são legíveis —
// ou seja, se o conteúdo contratual está de fato disponível para a
// consulta jurídica. É isto que separa "100% enviado" de "pronto".
//
// SOMENTE LEITURA: baixa o arquivo do Storage e extrai o texto em
// memória. Não grava em document_extractions, document_text_segments nem
// document_versions — a persistência de extrações continua sendo
// exclusividade de scripts/process-document-version.mjs (as tabelas de
// extração não têm policy de INSERT/UPDATE para usuários, ver migration
// 20260821011133; gravar aqui exigiria o cliente admin, que o próprio
// packages/db/src/client-admin.ts proíbe em Server Action de usuário).
//
// Revalidação obrigatória antes de tocar em qualquer conteúdo — nenhuma
// destas checagens depende de valor enviado pelo navegador além dos
// identificadores, e todas são refeitas no servidor:
//   1. usuário autenticado;
//   2. membership/permissão no projeto;
//   3. workspace do projeto é PRE_CONTRATUAL;
//   4. vínculo documentVersionId → documentId → projectId, documento ativo;
//   5. prefixo do storage path é o projectId.

import { createSupabaseServerClient } from "@axion/db/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import {
  EmptyDocumentTextError,
  UnsupportedDocumentFormatError,
  extractDocumentText,
} from "@/lib/documents/extraction/extract-document-text";
import {
  CONTRACTUAL_KINDS,
  MAX_DOCUMENTS,
  STORAGE_BUCKET,
  isStoragePathInsideProject,
} from "@/lib/documents/extraction/load-precontract-document-texts";
import type {
  BatchVerifyPrecontractDocumentsResult,
  VerifyPrecontractDocumentResult,
} from "./precontract-document-state";

const INDIVIDUAL_PREFIX = "[precontract-verify-individual]";
const BATCH_PREFIX = "[precontract-verify-batch]";

const GENERIC_FAILURE = "Não foi possível processar este documento. Tente novamente ou envie outro arquivo.";
const MISSING_CONTEXT = "Não foi possível identificar o contexto desta análise. Recarregue a página e tente novamente.";

function failure(message: string): VerifyPrecontractDocumentResult {
  return { ok: false, status: "ERRO", pageCount: null, characterCount: null, message };
}

interface VersionRow {
  id: string;
  document_id: string;
  // Nomes REAIS em document_versions. `storage_path` NAO existe nesta
  // tabela (pertence a email_attachments/contract_attachments) e fazia
  // o Postgres recusar o SELECT inteiro com 42703.
  file_path: string | null;
  storage_bucket: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  documents:
    | { id: string; project_id: string; kind: string; title: string; deleted_at: string | null }
    | { id: string; project_id: string; kind: string; title: string; deleted_at: string | null }[];
}

/**
 * Revalida usuário, permissão e workspace. Devolve o cliente pronto ou o
 * motivo da recusa — nenhum caminho segue adiante sem isto.
 */
async function authorizeWorkspace(
  projectId: string
): Promise<{ ok: true; supabase: SupabaseClient } | { ok: false; message: string }> {
  if (!projectId) return { ok: false, message: MISSING_CONTEXT };

  const supabase = await createSupabaseServerClient();

  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) return { ok: false, message: "Sessão expirada. Entre novamente para continuar." };

  const permission = await getCurrentProjectPermission(projectId);
  if (permission === null) return { ok: false, message: "Você não possui acesso ativo a esta análise." };

  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select("id,workspace_type")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !projectData) return { ok: false, message: MISSING_CONTEXT };

  if ((projectData as { workspace_type?: string }).workspace_type !== "PRE_CONTRATUAL") {
    return { ok: false, message: "Este espaço não é uma análise jurídica pré-contratual." };
  }

  return { ok: true, supabase };
}

/** Extrai e devolve só metadados de prontidão — nunca o texto. */
async function verifyVersionRow(
  supabase: SupabaseClient,
  projectId: string,
  version: VersionRow,
  // Prefixo de quem chamou: sem isto, individual e lote logavam o mesmo
  // rotulo e a investigacao do Preview nao distinguia os dois caminhos.
  logPrefix: string
): Promise<VerifyPrecontractDocumentResult> {
  const documentRow = Array.isArray(version.documents) ? version.documents[0] : version.documents;

  // Defesa redundante — nunca confiar só no filtro da query.
  if (
    !documentRow ||
    documentRow.project_id !== projectId ||
    documentRow.id !== version.document_id ||
    documentRow.deleted_at !== null
  ) {
    return failure("Documento não encontrado nesta análise.");
  }

  if (!version.file_path) return failure("Documento sem arquivo armazenado.");

  // Bucket: sem fallback silencioso. Ausente ou diferente do bucket
  // autorizado para documentos de projeto, recusa antes do download.
  if (version.storage_bucket !== STORAGE_BUCKET) {
    console.error(`${logPrefix} bucket inesperado — download recusado:`, {
      documentVersionId: version.id,
      bucket: version.storage_bucket,
    });
    return failure("Documento armazenado fora do repositório autorizado desta análise.");
  }

  // Prefixo do path conferido EXPLICITAMENTE. Falhou: não baixa, não
  // extrai, não chega ao provider.
  if (!isStoragePathInsideProject(version.file_path, projectId)) {
    console.error(`${logPrefix} path fora do projeto — download recusado`);
    return failure("Documento não encontrado nesta análise.");
  }

  try {
    const { data: file, error: downloadError } = await supabase.storage
      .from(version.storage_bucket)
      .download(version.file_path);

    if (downloadError || !file) {
      console.error(`${logPrefix} falha no download:`, downloadError?.message);
      return failure(GENERIC_FAILURE);
    }

    const extracted = await extractDocumentText({
      buffer: await file.arrayBuffer(),
      mimeType: version.mime_type,
      fileName: version.original_file_name ?? documentRow.title,
    });

    // Somente metadados seguros de prontidão — o TEXTO nunca volta ao
    // navegador. Quem precisa do conteúdo é o servidor, na consulta.
    return {
      ok: true,
      status: "PRONTO",
      pageCount: extracted.pageCount,
      characterCount: extracted.characterCount,
      message: null,
    };
  } catch (error) {
    if (error instanceof UnsupportedDocumentFormatError || error instanceof EmptyDocumentTextError) {
      return failure(error.detail);
    }

    console.error(
      `${logPrefix} erro não exibível ao usuário:`,
      error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error }
    );
    return failure(GENERIC_FAILURE);
  }
}

/**
 * Verificação de UM documento — usada logo após um upload, quando o
 * navegador acabou de criar aquela versão e precisa saber se ela ficou
 * legível.
 */
export async function verifyPrecontractDocumentAction(
  projectId: string,
  documentVersionId: string
): Promise<VerifyPrecontractDocumentResult> {
  if (!projectId || !documentVersionId) return failure(MISSING_CONTEXT);

  const authorized = await authorizeWorkspace(projectId);
  if (!authorized.ok) return failure(authorized.message);

  const { supabase } = authorized;

  const { data, error } = await supabase
    .from("document_versions")
    .select("id,document_id,file_path,storage_bucket,original_file_name,mime_type,documents!inner(id,project_id,kind,title,deleted_at)")
    .eq("id", documentVersionId)
    .eq("documents.project_id", projectId)
    .is("documents.deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error(`${INDIVIDUAL_PREFIX} falha ao validar vínculo documento/projeto:`, error.message);
    return failure(GENERIC_FAILURE);
  }

  if (!data) return failure("Documento não encontrado nesta análise.");

  return verifyVersionRow(supabase, projectId, data as unknown as VersionRow, INDIVIDUAL_PREFIX);
}

/**
 * Verificação EM LOTE, usada na hidratação após um F5.
 *
 * Recebe SOMENTE o projectId: é o servidor que descobre quais documentos
 * e versões existem e estão autorizados. O navegador não envia (e não
 * poderia enviar) a lista — uma lista vinda do cliente seria exatamente
 * o tipo de entrada que não pode governar o que será lido.
 *
 * Antes, a hidratação disparava uma Server Action POR DOCUMENTO; com
 * cinco documentos eram cinco round-trips, cinco downloads e cinco
 * extrações. Agora é uma chamada só, com teto de MAX_DOCUMENTS.
 */
export async function verifyPrecontractDocumentsBatchAction(
  projectId: string
): Promise<BatchVerifyPrecontractDocumentsResult> {
  const authorized = await authorizeWorkspace(projectId);
  if (!authorized.ok) return { ok: false, message: authorized.message, documents: [] };

  const { supabase } = authorized;

  // O servidor descobre os documentos contratuais ativos do projeto.
  const { data: documentsData, error: documentsError } = await supabase
    .from("documents")
    .select("id")
    .eq("project_id", projectId)
    .in("kind", [...CONTRACTUAL_KINDS])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_DOCUMENTS);

  if (documentsError) {
    console.error(`${BATCH_PREFIX} falha ao listar documentos:`, documentsError.message);
    return { ok: false, message: GENERIC_FAILURE, documents: [] };
  }

  const documentIds = ((documentsData ?? []) as unknown as { id: string }[]).map((row) => row.id);
  if (documentIds.length === 0) return { ok: true, message: null, documents: [] };

  const { data: versionsData, error: versionsError } = await supabase
    .from("document_versions")
    .select(
      "id,document_id,version_index,version_label,file_path,storage_bucket,original_file_name,mime_type,file_size_bytes,documents!inner(id,project_id,kind,title,deleted_at)"
    )
    .in("document_id", documentIds)
    .eq("documents.project_id", projectId)
    .is("documents.deleted_at", null)
    .order("version_index", { ascending: false });

  if (versionsError) {
    console.error(`${BATCH_PREFIX} falha ao listar versões:`, versionsError.message);
    return { ok: false, message: GENERIC_FAILURE, documents: [] };
  }

  // Versão vigente de cada documento — nunca uma versão antiga como
  // substituta quando a atual falha.
  const currentByDocument = new Map<string, VersionRow & { version_index: number; version_label: string | null; file_size_bytes: number | null }>();
  for (const row of (versionsData ?? []) as unknown as Array<
    VersionRow & { version_index: number; version_label: string | null; file_size_bytes: number | null }
  >) {
    const existing = currentByDocument.get(row.document_id);
    if (!existing || row.version_index > existing.version_index) currentByDocument.set(row.document_id, row);
  }

  const documents: BatchVerifyPrecontractDocumentsResult["documents"] = [];

  for (const documentId of documentIds) {
    const version = currentByDocument.get(documentId);
    if (!version) continue;

    const documentRow = Array.isArray(version.documents) ? version.documents[0] : version.documents;
    const verification = await verifyVersionRow(supabase, projectId, version, BATCH_PREFIX);

    documents.push({
      documentId,
      documentVersionId: version.id,
      title: documentRow?.title ?? "Documento",
      kind: documentRow?.kind ?? "CONTRATO_BASE",
      fileName: version.original_file_name ?? documentRow?.title ?? "Documento",
      versionLabel: version.version_label,
      sizeBytes: version.file_size_bytes ?? 0,
      status: verification.status,
      pageCount: verification.pageCount,
      characterCount: verification.characterCount,
      message: verification.message,
    });
  }

  return { ok: true, message: null, documents };
}
