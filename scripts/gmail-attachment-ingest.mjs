// Ingestão de anexos de e-mails Gmail já sincronizados em `emails` —
// somente-leitura no Gmail (gmail.readonly já cobre corpo/anexos
// completos, nenhum novo escopo OAuth foi necessário), escreve em
// email_attachments + Supabase Storage, e tenta (best-effort) espelhar
// no Google Drive. Fluxo obrigatório: baixar → hash → SUPABASE DB →
// SUPABASE STORAGE → persistência confirmada → tentar GOOGLE DRIVE.
//
// Requer --apply para gravar (mesmo padrão de gmail-inbound-sync.mjs);
// sem --apply, mostra apenas quantos anexos seriam processados.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/gmail-attachment-ingest.mjs --apply
//   node --env-file=apps/web/.env.local scripts/gmail-attachment-ingest.mjs <projectId> --apply --limit=20

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { ingestEmailAttachmentsForMessage } = await import("../apps/web/lib/email/attachments/ingest-email-attachments");
const { syncEmailAttachmentToDrive } = await import("../apps/web/lib/drive/sync-attachment-to-drive");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectId = args.find((arg) => !arg.startsWith("--")) ?? "00000000-0000-4000-8000-000000000001";
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

/** Extrai recursivamente toda parte de mensagem Gmail com anexo (filename + body.attachmentId). */
function collectAttachmentParts(part, out = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) {
    out.push({
      gmailAttachmentId: part.body.attachmentId,
      originalFileName: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      declaredSizeBytes: part.body.size ?? 0,
    });
  }
  for (const child of part.parts ?? []) {
    collectAttachmentParts(child, out);
  }
  return out;
}

function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const auth = new google.auth.OAuth2(
  required("GOOGLE_GMAIL_INBOUND_CLIENT_ID"),
  required("GOOGLE_GMAIL_INBOUND_CLIENT_SECRET")
);
auth.setCredentials({ refresh_token: required("GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN") });
const gmail = google.gmail({ version: "v1", auth });

console.log("");
console.log("======================================");
console.log("INGESTÃO DE ANEXOS DE E-MAIL (Gmail → Supabase → Drive)");
console.log("======================================");
console.log("Projeto:", projectId);
console.log("Modo:", apply ? "APLICAR (grava)" : "SIMULAÇÃO (--apply para gravar)");
console.log("Limite de e-mails:", limit);
console.log("");

const { data: emailRows, error: emailsError } = await supabase
  .from("emails")
  .select("id,provider,provider_message_id,provider_thread_id,sent_at")
  .eq("project_id", projectId)
  .eq("provider", "GMAIL")
  .order("sent_at", { ascending: false })
  .limit(limit);

if (emailsError) {
  throw new Error(emailsError.message);
}

console.log(`E-mails Gmail candidatos: ${emailRows.length}`);

let ingested = 0;
let alreadyIngested = 0;
let failed = 0;
let driveSynced = 0;
let driveSkipped = 0;
let driveFailed = 0;

for (const emailRow of emailRows) {
  const { data: message } = await gmail.users.messages.get({
    userId: "me",
    id: emailRow.provider_message_id,
    format: "full",
  });

  const parts = collectAttachmentParts(message.payload);
  if (parts.length === 0) continue;

  console.log(`E-mail ${emailRow.id} (${emailRow.provider_message_id}): ${parts.length} anexo(s) encontrado(s).`);

  if (!apply) continue;

  const results = await ingestEmailAttachmentsForMessage(supabase, {
    projectId,
    emailId: emailRow.id,
    gmailMessageId: emailRow.provider_message_id,
    gmailThreadId: emailRow.provider_thread_id,
    receivedAt: emailRow.sent_at,
    parts,
    downloadAttachmentBytes: async (part) => {
      const { data } = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: emailRow.provider_message_id,
        id: part.gmailAttachmentId,
      });
      return decodeBase64Url(data.data ?? "");
    },
  });

  for (const result of results) {
    if (result.status === "INGESTED") {
      ingested += 1;
      const driveResult = await syncEmailAttachmentToDrive(supabase, {
        id: result.attachment.id,
        projectId: result.attachment.projectId,
        originalFileName: result.attachment.originalFileName,
        mimeType: result.attachment.mimeType,
        storageBucket: result.attachment.storageBucket,
        storagePath: result.attachment.storagePath,
        driveSyncStatus: result.attachment.driveSyncStatus,
      });
      if (driveResult.status === "SYNCED") driveSynced += 1;
      else if (driveResult.status === "SKIPPED") driveSkipped += 1;
      else if (driveResult.status === "FAILED") driveFailed += 1;
    } else if (result.status === "ALREADY_INGESTED") {
      alreadyIngested += 1;
    } else {
      failed += 1;
      console.log(`  FALHA (${result.originalFileName}): ${result.error}`);
    }
  }
}

console.log("");
console.log("RESULTADO");
console.log("---------");
console.table([
  {
    e_mails_verificados: emailRows.length,
    anexos_ingeridos: ingested,
    ja_ingeridos: alreadyIngested,
    falhas_ingestao: failed,
    drive_sincronizados: driveSynced,
    drive_pulados: driveSkipped,
    drive_falhados: driveFailed,
  },
]);
