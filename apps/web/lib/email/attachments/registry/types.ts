// Tipos puros da aba "Anexos de E-mail" (Documentos) — sem I/O, sem
// JSX, dual-runtime (bundler do Next.js + scripts Node standalone),
// mesmo padrão de apps/web/lib/ui/feature-help.ts.
//
// PROCESSADO ≠ CONSIDERADO (seção 10 do requisito): "processado" é uma
// leitura de duas colunas já existentes (email_attachments.processing_status
// + document_versions.processing_status, quando promovido). "Considerado"
// é sempre uma referência real e persistida em ai_findings/ai_curation_runs
// — nunca inferido a partir de status de processamento ou nome de arquivo.

import type { ExpertId, ExpertSeverity } from "../../../ai/types";
import type { AttachmentProcessingStatus, EmailAttachment } from "../types";

export interface EmailSummary {
  id: string;
  projectId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

/** Estágio de processamento de CONTEÚDO de um document_version (só existe depois de promovido) — subconjunto relevante aqui. */
export type DocumentVersionProcessingStatus = "NOT_UPLOADED" | "AWAITING_PROCESSING" | "PROCESSING" | "PROCESSED" | "FAILED";

export interface LinkedDocumentVersionSummary {
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  documentKind: string;
  processingStatus: DocumentVersionProcessingStatus;
}

/** Mapeamento visual — nunca um enum novo (seção 9 do requisito). */
export type AttachmentDisplayStatusTone = "pending" | "processing" | "processed" | "failed";

export interface AttachmentDisplayStatus {
  label: string;
  tone: AttachmentDisplayStatusTone;
}

export interface AttachmentFindingsSummary {
  count: number;
  highestSeverity: ExpertSeverity | null;
  findingIds: string[];
}

export interface EmailAttachmentRegistryRow {
  attachment: EmailAttachment;
  email: EmailSummary | null;
  displayStatus: AttachmentDisplayStatus;
  linkedDocument: LinkedDocumentVersionSummary | null;
  /** true somente com referência real e persistida — nunca inferido (seção 11). */
  consideredByAcc: boolean;
  expertIds: ExpertId[];
  findings: AttachmentFindingsSummary;
  /** Nº de outros anexos do mesmo projeto com o mesmo sha256_hash (e-mails diferentes) — seção 17: nunca colapsar proveniências, só informar. */
  sameContentOccurrenceCount: number;
}

export type EmailAttachmentRegistryFilter =
  | "TODOS"
  | "CONSIDERADOS_PELO_ACC"
  | "PROCESSADOS"
  | "AGUARDANDO_PROCESSAMENTO"
  | "COM_FINDINGS"
  | "INCORPORADOS_A_DOCUMENTOS";

export type EmailAttachmentRegistrySortKey = "DATA" | "NOME" | "STATUS" | "RISCO";

export type { AttachmentProcessingStatus };
