// Ingestão de anexos de e-mail — fluxo obrigatório desta fase:
// GMAIL → baixar anexo → hash → SUPABASE DB → SUPABASE STORAGE →
// persistência confirmada → (depois, best-effort) tentar GOOGLE DRIVE.
//
// A sincronização com o Drive NUNCA acontece aqui — ver
// apps/web/lib/drive/sync-attachment-to-drive.ts, chamada
// separadamente pelo script orquestrador depois que a ingestão no
// Supabase já está confirmada. Se o download/hash/upload falhar, esta
// função nunca grava uma linha parcial: como o schema exige
// file_size_bytes/sha256_hash/storage_path (todos só conhecidos DEPOIS
// do download), uma falha nessas etapas nunca cria registro — a
// próxima execução simplesmente tenta de novo (idempotente: a
// verificação de existência roda antes de qualquer download).

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEmailAttachmentStoragePath } from "./build-storage-path";
import { computeSha256Hex } from "./hash";
import type { DownloadAttachmentBytes, EmailAttachment, GmailAttachmentPart } from "./types";

export interface IngestEmailAttachmentsInput {
  projectId: string;
  emailId: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  receivedAt: string;
  parts: GmailAttachmentPart[];
  downloadAttachmentBytes: DownloadAttachmentBytes;
}

export type IngestAttachmentResult =
  | { status: "INGESTED"; attachment: EmailAttachment }
  | { status: "ALREADY_INGESTED"; attachment: EmailAttachment }
  | { status: "FAILED"; gmailAttachmentId: string; originalFileName: string; error: string };

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

async function writeAttachmentAudit(
  supabase: SupabaseClient,
  projectId: string,
  attachmentId: string,
  detail: string
): Promise<void> {
  // actor_type='SYSTEM' exige actor_user_id E actor_label nulos (ver
  // migration 20260822060313_fix_system_actor_audit_label.sql) — nunca
  // repetir aquele bug aqui.
  const { error } = await supabase.from("audit_log_entries").insert({
    project_id: projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action: "EMAIL_ATTACHMENT_INGESTED",
    entity_type: "EMAIL_ATTACHMENT",
    entity_id: attachmentId,
    detail,
  });
  if (error) {
    throw new Error(`Falha ao registrar auditoria de ingestão de anexo: ${error.message}`);
  }
}

async function findExistingAttachment(
  supabase: SupabaseClient,
  emailId: string,
  gmailAttachmentId: string
): Promise<EmailAttachment | null> {
  const { data, error } = await supabase
    .from("email_attachments")
    .select("*")
    .eq("email_id", emailId)
    .eq("gmail_attachment_id", gmailAttachmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao verificar anexo existente: ${error.message}`);
  }

  return data ? mapRow(data as EmailAttachmentRow) : null;
}

async function ingestSinglePart(
  supabase: SupabaseClient,
  input: Omit<IngestEmailAttachmentsInput, "parts">,
  part: GmailAttachmentPart
): Promise<IngestAttachmentResult> {
  const { projectId, emailId, gmailMessageId, gmailThreadId, receivedAt, downloadAttachmentBytes } = input;

  try {
    // Idempotência: nunca reingerir/sobrescrever silenciosamente. Se já
    // existe, devolve a linha existente sem baixar de novo.
    const existing = await findExistingAttachment(supabase, emailId, part.gmailAttachmentId);
    if (existing) {
      return { status: "ALREADY_INGESTED", attachment: existing };
    }

    const bytes = await downloadAttachmentBytes(part);
    const sha256Hash = computeSha256Hex(bytes);
    const storagePath = buildEmailAttachmentStoragePath({
      projectId,
      emailId,
      gmailAttachmentId: part.gmailAttachmentId,
      originalFileName: part.originalFileName,
    });
    const storageBucket = "project-documents";

    // upsert:false — nunca sobrescreve um objeto existente silenciosamente.
    const { error: uploadError } = await supabase.storage
      .from(storageBucket)
      .upload(storagePath, bytes, { contentType: part.mimeType, upsert: false });

    if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
      throw new Error(`Falha ao salvar anexo no Supabase Storage: ${uploadError.message}`);
    }

    const { data: insertedData, error: insertError } = await supabase
      .from("email_attachments")
      .insert({
        project_id: projectId,
        email_id: emailId,
        gmail_message_id: gmailMessageId,
        gmail_thread_id: gmailThreadId,
        gmail_attachment_id: part.gmailAttachmentId,
        original_file_name: part.originalFileName,
        mime_type: part.mimeType,
        file_size_bytes: bytes.length,
        sha256_hash: sha256Hash,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        received_at: receivedAt,
      })
      .select("*")
      .single();

    if (insertError) {
      // Corrida concorrente: outra execução já inseriu entre a checagem
      // e este insert — nunca duplica, devolve a linha real.
      if (insertError.code === "23505") {
        const raceExisting = await findExistingAttachment(supabase, emailId, part.gmailAttachmentId);
        if (raceExisting) {
          return { status: "ALREADY_INGESTED", attachment: raceExisting };
        }
      }
      throw new Error(`Falha ao gravar metadata do anexo: ${insertError.message}`);
    }

    const attachment = mapRow(insertedData as EmailAttachmentRow);

    await writeAttachmentAudit(
      supabase,
      projectId,
      attachment.id,
      `Anexo "${part.originalFileName}" (${part.mimeType}, ${bytes.length} bytes) ingerido do e-mail ${emailId}.`
    );

    return { status: "INGESTED", attachment };
  } catch (error) {
    return {
      status: "FAILED",
      gmailAttachmentId: part.gmailAttachmentId,
      originalFileName: part.originalFileName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Nunca lança — cada parte resolve com seu próprio resultado, uma falha isolada nunca impede as demais. */
export async function ingestEmailAttachmentsForMessage(
  supabase: SupabaseClient,
  input: IngestEmailAttachmentsInput
): Promise<IngestAttachmentResult[]> {
  const { parts, ...rest } = input;

  const results: IngestAttachmentResult[] = [];
  for (const part of parts) {
    results.push(await ingestSinglePart(supabase, rest, part));
  }
  return results;
}
