// Mapeamento VISUAL de status — nunca um enum paralelo (seção 9 do
// requisito). email_attachments.processing_status descreve só a
// PROMOÇÃO (PENDING = ainda não vinculado a um document_version;
// PROCESSED = vinculado; FAILED = a tentativa de promoção falhou — ver
// comentário da coluna na migration 20260823060000). O processamento de
// CONTEÚDO (extração de texto) só começa depois de promovido, no
// document_version (AWAITING_PROCESSING/PROCESSING/PROCESSED/FAILED).
// Esta função combina as duas colunas reais numa única leitura visual —
// nunca inventa um terceiro enum.

import type { AttachmentProcessingStatus, DocumentVersionProcessingStatus } from "./types";
import type { AttachmentDisplayStatus } from "./types";

export function resolveAttachmentDisplayStatus(
  attachmentProcessingStatus: AttachmentProcessingStatus,
  linkedDocumentVersionProcessingStatus: DocumentVersionProcessingStatus | null
): AttachmentDisplayStatus {
  if (attachmentProcessingStatus === "FAILED") {
    return { label: "Falha no processamento", tone: "failed" };
  }

  if (attachmentProcessingStatus === "PENDING") {
    // Recebido/baixado (a ingestão só cria a linha depois de ter os
    // bytes e o hash) mas ainda não entrou na fila de processamento de
    // conteúdo — isso só acontece quando o anexo é promovido.
    return { label: "Recebido — aguardando processamento", tone: "pending" };
  }

  // attachmentProcessingStatus === "PROCESSED" ⇒ promovido a
  // document_version; o status de CONTEÚDO real é o do document_version.
  switch (linkedDocumentVersionProcessingStatus) {
    case "PROCESSING":
      return { label: "Em processamento", tone: "processing" };
    case "PROCESSED":
      return { label: "Processado", tone: "processed" };
    case "FAILED":
      return { label: "Falha no processamento", tone: "failed" };
    case "AWAITING_PROCESSING":
    case "NOT_UPLOADED":
    case null:
    default:
      return { label: "Aguardando processamento", tone: "pending" };
  }
}
