// Lógica pura da fila de upload múltiplo — sanitização, validação,
// classificação de deduplicação/versão/conflito e cálculo de
// progresso ponderado por fase. Sem DOM, sem React: importável tanto
// pelo hook do navegador quanto por scripts/test-multi-document-upload.mjs.
//
// A classificação aqui é só para feedback rápido na UI — a decisão
// que vale de verdade é sempre revalidada no servidor
// (register_project_document_upload, migration 20260825130000).

import {
  MAX_FILE_SIZE_BYTES,
  MIME_BY_EXTENSION,
} from "./allowed-file-types";
import {
  PHASE_ORDER,
  PHASE_WEIGHTS,
  type BatchSummary,
  type ClassificationResult,
  type ExistingDocumentSnapshot,
  type QueueFileDescriptor,
  type QueueItem,
  type QueueItemStatus,
  type QueuePhase,
} from "./types";

export function sanitizeFileName(fileName: string): string {
  return (
    fileName
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "arquivo"
  );
}

export function resolveExtension(fileName: string): string {
  const parts = fileName.split(".");
  if (parts.length < 2) return "";
  return (parts.pop() ?? "").toLowerCase();
}

export function resolveMimeType(fileName: string): string | null {
  return MIME_BY_EXTENSION[resolveExtension(fileName)] ?? null;
}

// Título do documento derivado do nome do arquivo: extensão fora,
// separadores viram espaço, colapsa espaços. "Contrato_Base-v2.pdf"
// vira "Contrato Base v2". Nunca vazio (cai para "Documento sem
// título" em último caso, nunca lança).
export function deriveTitleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "");
  const spaced = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced || "Documento sem título";
}

// Normalização para comparar títulos entre arquivos e documentos já
// existentes: minúsculas, sem acento, sem pontuação, espaços
// colapsados. Nunca usada para exibição — só para decidir
// NOVA_VERSAO vs CONFLITO vs NOVO.
export function normalizeTitleForMatching(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildDescriptor(
  fileName: string,
  sizeBytes: number
): QueueFileDescriptor {
  return {
    name: fileName,
    extension: resolveExtension(fileName),
    sizeBytes,
    mimeType: resolveMimeType(fileName),
  };
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

// Mesmas regras do upload individual (extensão/MIME permitido,
// tamanho máximo) — revalidadas de novo no servidor via o bucket
// "project-documents" (allowed_mime_types + file_size_limit).
export function validateDescriptor(
  descriptor: QueueFileDescriptor
): ValidationResult {
  if (descriptor.sizeBytes <= 0) {
    return { ok: false, reason: "Arquivo vazio." };
  }

  if (descriptor.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: "Arquivo ultrapassa o limite de 50 MB.",
    };
  }

  if (!descriptor.mimeType) {
    return { ok: false, reason: "Formato de arquivo não permitido." };
  }

  return { ok: true };
}

// Chave barata (nome + tamanho) para recusar, na hora da seleção,
// arquivos claramente repetidos no mesmo lote (antes mesmo do hash
// estar calculado). A checagem definitiva de duplicidade é sempre
// por hash — feita em classifyCandidate, depois de cada arquivo ser
// hasheado.
export function buildSelectionKey(descriptor: QueueFileDescriptor): string {
  return `${descriptor.name.toLowerCase()}|${descriptor.sizeBytes}`;
}

// Mescla arquivos recém-selecionados com os já presentes na fila —
// nunca descarta os anteriores (seleção múltipla em mais de uma vez,
// requisito 1.3) e recusa repetidos dentro do próprio lote pela
// chave barata nome+tamanho (requisito 1.5; a checagem definitiva
// por hash acontece depois, em classifyCandidate).
export function mergeNewFiles(
  existingDescriptors: readonly QueueFileDescriptor[],
  newDescriptors: readonly QueueFileDescriptor[]
): {
  toAdd: QueueFileDescriptor[];
  skipped: QueueFileDescriptor[];
} {
  const seenKeys = new Set(existingDescriptors.map(buildSelectionKey));
  const toAdd: QueueFileDescriptor[] = [];
  const skipped: QueueFileDescriptor[] = [];

  for (const descriptor of newDescriptors) {
    const key = buildSelectionKey(descriptor);
    if (seenKeys.has(key)) {
      skipped.push(descriptor);
      continue;
    }
    seenKeys.add(key);
    toAdd.push(descriptor);
  }

  return { toAdd, skipped };
}

// Classificação NOVO / NOVA_VERSAO / DUPLICADO / CONFLITO.
//
// Ordem de prioridade:
// 1. hash já existe em QUALQUER documento do projeto -> DUPLICADO
// 2. hash já existe em outro item deste mesmo lote -> DUPLICADO
// 3. título normalizado bate com um documento existente:
//    - mesmo kind -> NOVA_VERSAO (precisa confirmação humana)
//    - kind diferente -> CONFLITO (precisa decisão humana)
// 4. nenhuma correspondência -> NOVO
export function classifyCandidate(params: {
  sha256Hash: string;
  fileName: string;
  kind: string;
  existingDocuments: readonly ExistingDocumentSnapshot[];
  batchHashIndex: ReadonlyMap<string, string>; // hash -> queueItemId já hasheado neste lote
  currentQueueItemId: string;
}): ClassificationResult {
  const {
    sha256Hash,
    fileName,
    kind,
    existingDocuments,
    batchHashIndex,
    currentQueueItemId,
  } = params;

  for (const document of existingDocuments) {
    if (document.versions.some((v) => v.sha256Hash === sha256Hash)) {
      return {
        classification: "DUPLICADO",
        matchedDocumentId: document.documentId,
        matchedDocumentTitle: document.title,
        reason: `Arquivo idêntico já existe em "${document.title}".`,
      };
    }
  }

  const batchMatchId = batchHashIndex.get(sha256Hash);
  if (batchMatchId && batchMatchId !== currentQueueItemId) {
    return {
      classification: "DUPLICADO",
      matchedDocumentId: null,
      matchedDocumentTitle: null,
      reason: "Arquivo duplicado dentro deste mesmo lote.",
    };
  }

  const normalizedCandidateTitle = normalizeTitleForMatching(
    deriveTitleFromFileName(fileName)
  );

  const titleMatch = existingDocuments.find(
    (document) =>
      normalizeTitleForMatching(document.title) === normalizedCandidateTitle
  );

  if (titleMatch) {
    if (titleMatch.kind === kind) {
      return {
        classification: "NOVA_VERSAO",
        matchedDocumentId: titleMatch.documentId,
        matchedDocumentTitle: titleMatch.title,
        reason: `Parece uma nova versão de "${titleMatch.title}".`,
      };
    }

    return {
      classification: "CONFLITO",
      matchedDocumentId: titleMatch.documentId,
      matchedDocumentTitle: titleMatch.title,
      reason: `Já existe "${titleMatch.title}" com tipo documental diferente.`,
    };
  }

  return {
    classification: "NOVO",
    matchedDocumentId: null,
    matchedDocumentTitle: null,
    reason: "Nenhum documento correspondente encontrado.",
  };
}

// Rótulo de versão para uma NOVA_VERSAO confirmada — mesma convenção
// do upload individual (nextVersionIndex + ".0").
export function nextVersionLabel(document: ExistingDocumentSnapshot): string {
  return `${document.nextVersionIndex}.0`;
}

// Progresso ponderado por fase (nunca por tempo decorrido). `done`
// indica se a fase atual já terminou (ex.: hash calculado) ou ainda
// está em andamento (ex.: aguardando resposta do upload).
export function progressForPhase(
  phase: QueuePhase,
  phaseDone: boolean
): number {
  const index = PHASE_ORDER.indexOf(phase);
  const completedWeight = PHASE_ORDER.slice(0, index).reduce(
    (sum, p) => sum + PHASE_WEIGHTS[p],
    0
  );
  return Math.min(
    100,
    completedWeight + (phaseDone ? PHASE_WEIGHTS[phase] : 0)
  );
}

const TERMINAL_DONE: readonly QueueItemStatus[] = [
  "CONCLUIDO",
  "AGUARDANDO_ANALISE",
];
const TERMINAL_PENDING_REVIEW: readonly QueueItemStatus[] = [
  "AGUARDANDO_ANALISE",
];
const TERMINAL_DUPLICATED: readonly QueueItemStatus[] = ["DUPLICADO"];
const TERMINAL_REJECTED: readonly QueueItemStatus[] = ["REJEITADO"];
const TERMINAL_ERRORED: readonly QueueItemStatus[] = ["ERRO"];
const PROCESSING_STATUSES: readonly QueueItemStatus[] = [
  "VALIDANDO",
  "CALCULANDO_HASH",
  "ENVIANDO",
  "REGISTRANDO",
  "PROCESSANDO",
];

// Converte os documentos já carregados na página (getManagedDocuments,
// já filtrados por RLS/projeto) para o snapshot de dedup — nenhuma
// consulta nova é feita só para isso.
export function toExistingDocumentSnapshots(
  documents: readonly {
    id: string;
    title: string;
    kind: string;
    versions: readonly {
      versionIndex: number;
      sha256Hash?: string | null;
    }[];
  }[]
): ExistingDocumentSnapshot[] {
  return documents.map((document) => ({
    documentId: document.id,
    title: document.title,
    kind: document.kind,
    versions: document.versions.map((v) => ({
      sha256Hash: v.sha256Hash ?? null,
    })),
    nextVersionIndex:
      Math.max(0, ...document.versions.map((v) => v.versionIndex)) + 1,
  }));
}

// Mensagem específica exigida pelo requisito de erros — nunca "Erro
// desconhecido" quando a causa é conhecida.
export function buildImportErrorMessage(
  fileName: string,
  reason: string
): string {
  return `${fileName} não foi importado: ${reason}.`;
}

export function computeBatchSummary(
  items: readonly Pick<QueueItem, "status" | "progressPercent">[]
): BatchSummary {
  const total = items.length;
  const completed = items.filter((i) =>
    TERMINAL_DONE.includes(i.status)
  ).length;
  const duplicated = items.filter((i) =>
    TERMINAL_DUPLICATED.includes(i.status)
  ).length;
  const rejected = items.filter((i) =>
    TERMINAL_REJECTED.includes(i.status)
  ).length;
  const errored = items.filter((i) =>
    TERMINAL_ERRORED.includes(i.status)
  ).length;
  const processing = items.filter((i) =>
    PROCESSING_STATUSES.includes(i.status)
  ).length;
  const pendingReview = items.filter((i) =>
    TERMINAL_PENDING_REVIEW.includes(i.status)
  ).length;

  const overallPercent =
    total === 0
      ? 0
      : Math.round(
          items.reduce((sum, i) => sum + i.progressPercent, 0) / total
        );

  return {
    total,
    completed,
    processing,
    duplicated,
    rejected,
    errored,
    overallPercent,
    pendingReview,
  };
}
