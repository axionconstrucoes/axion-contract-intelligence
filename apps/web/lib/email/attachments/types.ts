// Tipos puros do pipeline de ingestão de anexos de e-mail. Sem I/O —
// dual-runtime (testável tanto pelo bundler do Next.js quanto por
// scripts Node standalone), mesmo padrão já usado em apps/web/lib/ai/.

export type AttachmentProcessingStatus = "PENDING" | "PROCESSED" | "FAILED";
export type DriveSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "SKIPPED";

/** Espelha 1:1 a tabela public.email_attachments. */
export interface EmailAttachment {
  id: string;
  projectId: string;
  emailId: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  gmailAttachmentId: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Hash: string;
  storageBucket: string;
  storagePath: string;
  receivedAt: string;
  ingestedAt: string;
  processingStatus: AttachmentProcessingStatus;
  processingError: string | null;
  documentVersionId: string | null;
  sourceLanguage: string | null;
  driveSyncStatus: DriveSyncStatus;
  driveFileId: string | null;
  driveSyncedAt: string | null;
  driveSyncError: string | null;
  createdAt: string;
}

/** Parte de mensagem Gmail com anexo, já normalizada — nunca o objeto bruto da API (mantém este módulo testável sem googleapis). */
export interface GmailAttachmentPart {
  gmailAttachmentId: string;
  originalFileName: string;
  mimeType: string;
  /** Tamanho declarado pelo Gmail — o tamanho real após download é sempre reconferido. */
  declaredSizeBytes: number;
}

/** Função de download injetada — busca os bytes de um anexo específico via Gmail API. */
export type DownloadAttachmentBytes = (part: GmailAttachmentPart) => Promise<Buffer>;
