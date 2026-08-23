// Reprocessa a sincronização com o Google Drive de anexos ainda
// PENDING/FAILED — nunca um scheduler/cron, só um script sob demanda
// (mesmo princípio de scripts/gmail-attachment-ingest.mjs). Idempotente:
// anexos já SYNCED nunca são reenviados (ver syncEmailAttachmentToDrive).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/retry-email-attachment-drive-sync.mjs --apply
//   node --env-file=apps/web/.env.local scripts/retry-email-attachment-drive-sync.mjs <projectId> --apply

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { syncEmailAttachmentToDrive } = await import("../apps/web/lib/drive/sync-attachment-to-drive");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectId = args.find((arg) => !arg.startsWith("--")) ?? "00000000-0000-4000-8000-000000000001";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("");
console.log("======================================");
console.log("RETRY — SINCRONIZAÇÃO DE ANEXOS COM O GOOGLE DRIVE");
console.log("======================================");
console.log("Projeto:", projectId);
console.log("Modo:", apply ? "APLICAR (grava)" : "SIMULAÇÃO (--apply para gravar)");
console.log("");

const { data: rows, error } = await supabase
  .from("email_attachments")
  .select("id,project_id,original_file_name,mime_type,storage_bucket,storage_path,drive_sync_status")
  .eq("project_id", projectId)
  .in("drive_sync_status", ["PENDING", "FAILED"]);

if (error) {
  throw new Error(error.message);
}

console.log(`Anexos pendentes/falhados de sincronizar: ${rows.length}`);

if (!apply) {
  process.exit(0);
}

let synced = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const result = await syncEmailAttachmentToDrive(supabase, {
    id: row.id,
    projectId: row.project_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    driveSyncStatus: row.drive_sync_status,
  });

  if (result.status === "SYNCED") synced += 1;
  else if (result.status === "SKIPPED") skipped += 1;
  else if (result.status === "FAILED") {
    failed += 1;
    console.log(`  FALHA (${row.original_file_name}): ${result.error}`);
  }
}

console.log("");
console.table([{ sincronizados: synced, pulados: skipped, falhados: failed }]);
