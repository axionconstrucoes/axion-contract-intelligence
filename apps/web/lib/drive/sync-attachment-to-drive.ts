// Sincronização (espelhamento) de um anexo já ingerido para o Google
// Drive — SEMPRE best-effort: falhar aqui nunca invalida a ingestão já
// confirmada no Supabase (fonte autoritativa). Esta função NUNCA lança
// — todo resultado (inclusive falha) é comunicado via valor de retorno
// e persistido em email_attachments.drive_sync_status, nunca via
// exceção que poderia interromper o script chamador no meio de um lote.

import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDriveFilesClient, type DriveFilesClient } from "./drive-client";
import { isDriveConfigured, loadDriveConfig } from "./drive-config";

export interface EmailAttachmentForDriveSync {
  id: string;
  projectId: string;
  originalFileName: string;
  mimeType: string;
  storageBucket: string;
  storagePath: string;
  driveSyncStatus: "PENDING" | "SYNCED" | "FAILED" | "SKIPPED";
}

export type DriveSyncResult =
  | { status: "SYNCED"; driveFileId: string }
  | { status: "ALREADY_SYNCED"; driveFileId: string | null }
  | { status: "SKIPPED"; reason: string }
  | { status: "FAILED"; error: string };

export interface SyncEmailAttachmentToDriveOptions {
  /** Injeção para testes — nunca chama a API real do Drive quando fornecido. */
  driveClient?: DriveFilesClient;
  /** Obrigatório junto de `driveClient` em testes — evita chamar loadDriveConfig() (que exigiria env vars reais). */
  emailAttachmentsFolderId?: string;
  /** Injeção para testes — evita depender de Supabase Storage real. */
  downloadAttachmentBytes?: (attachment: EmailAttachmentForDriveSync) => Promise<Buffer>;
}

async function downloadFromSupabaseStorage(
  supabase: SupabaseClient,
  attachment: EmailAttachmentForDriveSync
): Promise<Buffer> {
  // Mesmo padrão já usado por apps/web/lib/timeline-export/resolve-evidence-files.ts:
  // signed URL de curta duração + fetch — nunca acesso direto ao bucket.
  const { data, error } = await supabase.storage
    .from(attachment.storageBucket)
    .createSignedUrl(attachment.storagePath, 60);

  if (error || !data?.signedUrl) {
    throw new Error(`Falha ao gerar URL assinada do anexo para sincronizar com o Drive: ${error?.message ?? "URL ausente"}`);
  }

  const response = await fetch(data.signedUrl);
  if (!response.ok) {
    throw new Error(`Falha ao baixar anexo do Supabase Storage para sincronizar com o Drive: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function writeDriveAudit(
  supabase: SupabaseClient,
  projectId: string,
  attachmentId: string,
  action: "DRIVE_FILE_SYNCED" | "DRIVE_FILE_SYNC_FAILED",
  detail: string
): Promise<void> {
  await supabase.from("audit_log_entries").insert({
    project_id: projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action,
    entity_type: "EMAIL_ATTACHMENT",
    entity_id: attachmentId,
    detail,
  });
}

export async function syncEmailAttachmentToDrive(
  supabase: SupabaseClient,
  attachment: EmailAttachmentForDriveSync,
  options: SyncEmailAttachmentToDriveOptions = {}
): Promise<DriveSyncResult> {
  // Idempotente: já sincronizado com sucesso — nunca reenviar (retry
  // sem duplicação).
  if (attachment.driveSyncStatus === "SYNCED") {
    return { status: "ALREADY_SYNCED", driveFileId: null };
  }

  const usingInjectedClient = options.driveClient !== undefined;
  const configured = usingInjectedClient || isDriveConfigured();
  if (!configured) {
    await supabase.from("email_attachments").update({ drive_sync_status: "SKIPPED" }).eq("id", attachment.id);
    return { status: "SKIPPED", reason: "Google Drive não está configurado neste ambiente (GOOGLE_DRIVE_* ausente)." };
  }

  try {
    const config = usingInjectedClient ? null : loadDriveConfig();
    const folderId = options.emailAttachmentsFolderId ?? config?.emailAttachmentsFolderId;
    if (!folderId) {
      throw new Error("emailAttachmentsFolderId ausente — obrigatório ao injetar driveClient em testes.");
    }

    const driveClient = options.driveClient ?? createDriveFilesClient(config!);
    const downloadBytes = options.downloadAttachmentBytes ?? ((a) => downloadFromSupabaseStorage(supabase, a));

    const bytes = await downloadBytes(attachment);

    const response = await driveClient.create({
      requestBody: { name: attachment.originalFileName, parents: [folderId] },
      media: { mimeType: attachment.mimeType, body: Readable.from(bytes) },
      fields: "id",
    });

    const driveFileId = response.data.id;
    if (!driveFileId) {
      throw new Error("Google Drive não retornou um id de arquivo após o upload.");
    }

    const { error: updateError } = await supabase
      .from("email_attachments")
      .update({
        drive_sync_status: "SYNCED",
        drive_file_id: driveFileId,
        drive_synced_at: new Date().toISOString(),
        drive_sync_error: null,
      })
      .eq("id", attachment.id);

    if (updateError) {
      throw new Error(`Anexo enviado ao Drive, mas falhou ao registrar no Supabase: ${updateError.message}`);
    }

    await writeDriveAudit(
      supabase,
      attachment.projectId,
      attachment.id,
      "DRIVE_FILE_SYNCED",
      `Anexo "${attachment.originalFileName}" espelhado no Google Drive (file id ${driveFileId}).`
    );

    return { status: "SYNCED", driveFileId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("email_attachments")
      .update({ drive_sync_status: "FAILED", drive_sync_error: message })
      .eq("id", attachment.id);

    await writeDriveAudit(
      supabase,
      attachment.projectId,
      attachment.id,
      "DRIVE_FILE_SYNC_FAILED",
      `Falha ao espelhar anexo "${attachment.originalFileName}" no Google Drive: ${message}`
    );

    return { status: "FAILED", error: message };
  }
}
