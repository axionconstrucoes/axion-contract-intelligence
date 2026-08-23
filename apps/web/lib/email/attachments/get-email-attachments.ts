// Leitura somente-leitura de anexos — reutilizada pelo Context Builder
// (apps/web/lib/ai/context/build-event-context.ts) e disponível para
// uma futura tela de Timeline (ver docs/email-attachments-and-drive-mirror.md,
// seção "Timeline — o que falta"). Nenhuma escrita acontece aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAttachment } from "./types";

type EmailAttachmentRow = {
  id: string;
  project_id: string;
  email_id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  gmail_attachment_id: string;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  sha256_hash: string;
  storage_bucket: string;
  storage_path: string;
  received_at: string;
  ingested_at: string;
  processing_status: EmailAttachment["processingStatus"];
  processing_error: string | null;
  document_version_id: string | null;
  source_language: string | null;
  drive_sync_status: EmailAttachment["driveSyncStatus"];
  drive_file_id: string | null;
  drive_synced_at: string | null;
  drive_sync_error: string | null;
  created_at: string;
};

function mapRow(row: EmailAttachmentRow): EmailAttachment {
  return {
    id: row.id,
    projectId: row.project_id,
    emailId: row.email_id,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    gmailAttachmentId: row.gmail_attachment_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    sha256Hash: row.sha256_hash,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    receivedAt: row.received_at,
    ingestedAt: row.ingested_at,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    documentVersionId: row.document_version_id,
    sourceLanguage: row.source_language,
    driveSyncStatus: row.drive_sync_status,
    driveFileId: row.drive_file_id,
    driveSyncedAt: row.drive_synced_at,
    driveSyncError: row.drive_sync_error,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS =
  "id,project_id,email_id,gmail_message_id,gmail_thread_id,gmail_attachment_id,original_file_name,mime_type,file_size_bytes,sha256_hash,storage_bucket,storage_path,received_at,ingested_at,processing_status,processing_error,document_version_id,source_language,drive_sync_status,drive_file_id,drive_synced_at,drive_sync_error,created_at";

export async function getEmailAttachmentsForEmail(
  supabase: SupabaseClient,
  emailId: string
): Promise<EmailAttachment[]> {
  const { data, error } = await supabase
    .from("email_attachments")
    .select(SELECT_COLUMNS)
    .eq("email_id", emailId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar anexos do e-mail: ${error.message}`);
  }

  return (data as unknown as EmailAttachmentRow[]).map(mapRow);
}

/** Bulk — usada pelo Context Builder para resolver anexos de vários e-mails de uma vez (evita N+1). */
export async function getEmailAttachmentsForEmails(
  supabase: SupabaseClient,
  emailIds: string[]
): Promise<Map<string, EmailAttachment[]>> {
  const byEmailId = new Map<string, EmailAttachment[]>();
  if (emailIds.length === 0) {
    return byEmailId;
  }

  const { data, error } = await supabase.from("email_attachments").select(SELECT_COLUMNS).in("email_id", emailIds);

  if (error) {
    throw new Error(`Falha ao carregar anexos dos e-mails: ${error.message}`);
  }

  for (const row of data as unknown as EmailAttachmentRow[]) {
    const attachment = mapRow(row);
    const list = byEmailId.get(attachment.emailId) ?? [];
    list.push(attachment);
    byEmailId.set(attachment.emailId, list);
  }

  return byEmailId;
}
