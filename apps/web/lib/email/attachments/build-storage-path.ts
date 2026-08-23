// Construção determinística do caminho no Supabase Storage — reaproveita
// o bucket já existente "project-documents" (mesmo bucket usado por
// document_versions e por evidências ESG; ver docs/email-attachments-and-drive-mirror.md).
//
// Caminho sempre começa com "{projectId}/…" — é exatamente o prefixo
// que as policies de Storage já existentes usam via
// storage.foldername(name)[1], então nenhuma policy nova é necessária.
//
// Cada anexo tem seu PRÓPRIO caminho, sempre incluindo o
// gmailAttachmentId — isso garante, sozinho, que:
// - dois anexos com o MESMO nome de arquivo (em qualquer combinação de
//   e-mails) nunca colidem (nomes diferentes de objeto);
// - o mesmo anexo, reingerido, sempre produz o MESMO caminho
//   (idempotência — nunca sobrescreve silenciosamente porque a
//   verificação de unicidade acontece antes do upload, ver
//   ingest-email-attachments.ts).

const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9._-]/g;

function sanitizeFileName(originalFileName: string): string {
  const trimmed = originalFileName.trim();
  const sanitized = trimmed.replace(UNSAFE_FILENAME_CHARS, "_");
  return sanitized.length > 0 ? sanitized : "anexo";
}

export interface BuildEmailAttachmentStoragePathInput {
  projectId: string;
  emailId: string;
  gmailAttachmentId: string;
  originalFileName: string;
}

export function buildEmailAttachmentStoragePath(input: BuildEmailAttachmentStoragePathInput): string {
  const { projectId, emailId, gmailAttachmentId, originalFileName } = input;
  const safeName = sanitizeFileName(originalFileName);
  return `${projectId}/email-attachments/${emailId}/${gmailAttachmentId}-${safeName}`;
}
