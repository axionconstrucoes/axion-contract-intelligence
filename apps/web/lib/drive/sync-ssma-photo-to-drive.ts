// Espelhamento assíncrono e idempotente das fotos SSMA já confirmadas no
// Supabase. O Supabase continua sendo a fonte autoritativa: uma falha no
// Google Drive nunca remove nem invalida o formulário/foto original.

import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDriveFilesClient,
  type DriveWritableFilesClient,
} from "./drive-client";
import { isDriveOAuthConfigured, loadDriveOAuthConfig } from "./drive-config";
import { extractGoogleDriveFolderId } from "@/lib/integrations/esg-ssma/drive-source-policy";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export interface SsmaPhotoForDriveSync {
  id: string;
  projectId: string;
  submissionId: string;
  driveFolderName: string;
  occurredAt: string;
  originalFileName: string;
  mimeType: string;
  storageBucket: string;
  storagePath: string;
  driveSyncStatus: "PENDING" | "SYNCED" | "FAILED";
  driveFileId?: string | null;
}

export type SsmaDriveSyncResult =
  | { status: "SYNCED"; driveFileId: string }
  | { status: "ALREADY_SYNCED"; driveFileId: string | null }
  | { status: "FAILED"; error: string };

export interface SyncSsmaPhotoToDriveOptions {
  driveClient?: DriveWritableFilesClient;
  downloadPhotoBytes?: (photo: SsmaPhotoForDriveSync) => Promise<Buffer>;
  rootFolderUrl?: string;
}

function escapeDriveQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function safeDriveError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "DRIVE_OAUTH_NOT_CONFIGURED") return "Credencial Google Drive não configurada.";
  if (message === "SSMA_DRIVE_ROOT_NOT_CONFIGURED") return "Pasta SSMA/ESG da obra não configurada.";
  if (message === "INVALID_SSMA_DRIVE_ROOT") return "URL da pasta SSMA/ESG inválida.";
  if (message === "SSMA_DRIVE_SUBFOLDER_NOT_FOUND") return "Subpasta SSMA do formulário não encontrada.";
  if (/invalid_grant|unauthorized|401/i.test(message)) return "Autorização Google Drive expirada ou revogada.";
  if (/forbidden|permission|insufficient|403/i.test(message)) return "Credencial Google Drive sem permissão de escrita na pasta SSMA/ESG.";
  if (/not found|404/i.test(message)) return "Pasta SSMA/ESG não encontrada ou sem acesso.";
  return "Falha ao espelhar a foto SSMA no Google Drive.";
}

export function buildSsmaDriveFileName(photo: SsmaPhotoForDriveSync): string {
  const occurred = new Date(photo.occurredAt);
  const timestamp = Number.isNaN(occurred.getTime())
    ? "data-desconhecida"
    : occurred.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  const safeName = photo.originalFileName
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "foto.jpg";
  return `${timestamp}_${photo.id}_${safeName}`;
}

async function listFolderId(
  client: DriveWritableFilesClient,
  rootFolderId: string,
  folderName: string
): Promise<string> {
  const response = await client.list({
    q: `'${escapeDriveQuery(rootFolderId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 2,
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const matches = (response.data.files ?? []).filter((item) => item.id);
  if (matches.length !== 1) throw new Error("SSMA_DRIVE_SUBFOLDER_NOT_FOUND");
  return matches[0].id!;
}

async function findExistingDriveFile(
  client: DriveWritableFilesClient,
  folderId: string,
  photoId: string
): Promise<string | null> {
  const response = await client.list({
    q: `'${escapeDriveQuery(folderId)}' in parents and appProperties has { key='ssmaPhotoId' and value='${escapeDriveQuery(photoId)}' } and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 2,
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return response.data.files?.find((item) => item.id)?.id ?? null;
}

async function downloadFromSupabaseStorage(
  supabase: SupabaseClient,
  photo: SsmaPhotoForDriveSync
): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(photo.storageBucket)
    .createSignedUrl(photo.storagePath, 60);
  if (error || !data?.signedUrl) throw new Error("SSMA_STORAGE_SIGNED_URL_FAILED");
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error("SSMA_STORAGE_DOWNLOAD_FAILED");
  return Buffer.from(await response.arrayBuffer());
}

async function updatePhotoAsSynced(
  supabase: SupabaseClient,
  photo: SsmaPhotoForDriveSync,
  driveFileId: string
): Promise<void> {
  const { error } = await supabase
    .from("ssma_submission_photos")
    .update({
      drive_sync_status: "SYNCED",
      drive_file_id: driveFileId,
      drive_synced_at: new Date().toISOString(),
      drive_sync_error: null,
    })
    .eq("id", photo.id);
  if (error) throw new Error("SSMA_DRIVE_STATE_UPDATE_FAILED");
}

async function writeAudit(
  supabase: SupabaseClient,
  photo: SsmaPhotoForDriveSync,
  action: "SSMA_DRIVE_FILE_SYNCED" | "SSMA_DRIVE_FILE_SYNC_FAILED",
  detail: string
): Promise<void> {
  await supabase.from("audit_log_entries").insert({
    project_id: photo.projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action,
    entity_type: "SSMA_SUBMISSION_PHOTO",
    entity_id: photo.id,
    detail,
  });
}

export async function syncSsmaPhotoToDrive(
  supabase: SupabaseClient,
  photo: SsmaPhotoForDriveSync,
  options: SyncSsmaPhotoToDriveOptions = {}
): Promise<SsmaDriveSyncResult> {
  if (photo.driveSyncStatus === "SYNCED") {
    return { status: "ALREADY_SYNCED", driveFileId: photo.driveFileId ?? null };
  }

  try {
    if (!options.driveClient && !isDriveOAuthConfigured()) {
      throw new Error("DRIVE_OAUTH_NOT_CONFIGURED");
    }

    let rootFolderUrl = options.rootFolderUrl;
    if (!rootFolderUrl) {
      const { data, error } = await supabase
        .from("project_integrations")
        .select("folder_reference")
        .eq("project_id", photo.projectId)
        .eq("source_type", "ESG_SSMA")
        .maybeSingle();
      if (error || !data?.folder_reference) throw new Error("SSMA_DRIVE_ROOT_NOT_CONFIGURED");
      rootFolderUrl = data.folder_reference;
    }

    const rootFolderId = extractGoogleDriveFolderId(rootFolderUrl ?? "");
    if (!rootFolderId) throw new Error("INVALID_SSMA_DRIVE_ROOT");

    const client = options.driveClient ?? createDriveFilesClient(loadDriveOAuthConfig());
    const targetFolderId = await listFolderId(client, rootFolderId, photo.driveFolderName);
    let driveFileId = await findExistingDriveFile(client, targetFolderId, photo.id);

    if (!driveFileId) {
      const download = options.downloadPhotoBytes ?? ((item) => downloadFromSupabaseStorage(supabase, item));
      const bytes = await download(photo);
      const response = await client.create({
        requestBody: {
          name: buildSsmaDriveFileName(photo),
          parents: [targetFolderId],
          appProperties: {
            source: "ACC_SSMA",
            ssmaPhotoId: photo.id,
            ssmaSubmissionId: photo.submissionId,
          },
        },
        media: { mimeType: photo.mimeType, body: Readable.from(bytes) },
        fields: "id",
        supportsAllDrives: true,
      });
      driveFileId = response.data.id ?? null;
      if (!driveFileId) throw new Error("DRIVE_FILE_ID_MISSING");
    }

    await updatePhotoAsSynced(supabase, photo, driveFileId);
    await writeAudit(
      supabase,
      photo,
      "SSMA_DRIVE_FILE_SYNCED",
      `Foto SSMA "${photo.originalFileName}" espelhada na subpasta "${photo.driveFolderName}" do Google Drive.`
    );
    return { status: "SYNCED", driveFileId };
  } catch (error) {
    const safeMessage = safeDriveError(error);
    await supabase
      .from("ssma_submission_photos")
      .update({ drive_sync_status: "FAILED", drive_sync_error: safeMessage })
      .eq("id", photo.id);
    await writeAudit(supabase, photo, "SSMA_DRIVE_FILE_SYNC_FAILED", safeMessage);
    return { status: "FAILED", error: safeMessage };
  }
}
