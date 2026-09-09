// Espelha fotos SSMA já confirmadas no Supabase para a subpasta correta
// do Google Drive. Sem --apply apenas informa a fila. O processamento é
// idempotente e aceita PENDING/FAILED para permitir retomada segura.

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { syncSsmaPhotoToDrive } = await import("../apps/web/lib/drive/sync-ssma-photo-to-drive");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
  throw new Error("--limit deve ser um inteiro entre 1 e 500.");
}

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: rows, error } = await supabase
  .from("ssma_submission_photos")
  .select("id,project_id,submission_id,original_file_name,mime_type,storage_bucket,storage_path,drive_sync_status,drive_file_id,ssma_form_submissions!inner(drive_folder_name,occurred_at,status)")
  .in("drive_sync_status", ["PENDING", "FAILED"])
  .eq("ssma_form_submissions.status", "SUBMITTED")
  .order("uploaded_at", { ascending: true })
  .limit(limit);

if (error) throw new Error(error.message);

console.log(`Fotos SSMA pendentes/falhadas: ${rows.length}`);
console.log(`Modo: ${apply ? "APLICAR" : "SIMULAÇÃO"}`);
if (!apply) process.exit(0);

let synced = 0;
let failed = 0;

for (const row of rows) {
  const submission = Array.isArray(row.ssma_form_submissions)
    ? row.ssma_form_submissions[0]
    : row.ssma_form_submissions;
  if (!submission) {
    failed += 1;
    continue;
  }

  const result = await syncSsmaPhotoToDrive(supabase, {
    id: row.id,
    projectId: row.project_id,
    submissionId: row.submission_id,
    driveFolderName: submission.drive_folder_name,
    occurredAt: submission.occurred_at,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    driveSyncStatus: row.drive_sync_status,
    driveFileId: row.drive_file_id,
  });

  if (result.status === "SYNCED") synced += 1;
  else {
    failed += 1;
    console.log(`FALHA ${row.id}: ${result.error}`);
  }
}

console.table([{ processadas: rows.length, sincronizadas: synced, falhas: failed }]);
if (failed > 0) process.exitCode = 1;
