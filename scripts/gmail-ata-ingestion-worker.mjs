import { register } from "node:module";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

register("./ts-module-resolver.mjs", import.meta.url);

const { ingestEmailAttachmentsForMessage } = await import(
  "../apps/web/lib/email/attachments/ingest-email-attachments.ts"
);
const { linkEmailAttachmentToDocument } = await import(
  "../apps/web/lib/email/attachments/link-email-attachment-to-document.ts"
);

const PROJECT_ID = process.argv[2] ?? "00000000-0000-4000-8000-000000000001";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isMeetingMinutes(fileName, subject) {
  const text = normalize(`${fileName} ${subject}`);
  return (
    /(^|[^a-z0-9])ata([^a-z0-9]|$)/.test(text) ||
    text.includes("ata de reuniao") ||
    text.includes("reuniao semanal") ||
    text.includes("meeting minutes") ||
    text.includes("minutes of meeting")
  );
}

function collectParts(part, out = []) {
  if (!part) return out;
  const fileName = String(part.filename ?? "").trim();
  const attachmentId = part.body?.attachmentId;
  if (fileName && attachmentId) {
    out.push({
      gmailAttachmentId: attachmentId,
      originalFileName: fileName,
      mimeType: part.mimeType || "application/octet-stream",
      declaredSizeBytes: Number(part.body?.size ?? 0),
    });
  }
  for (const child of part.parts ?? []) collectParts(child, out);
  return out;
}

function decodeBase64Url(value) {
  const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const mailbox = required("GOOGLE_GMAIL_INBOUND_MAILBOX").toLowerCase();

const { data: planningMembers, error: planningMembersError } = await supabase
  .from("project_memberships")
  .select("user_id")
  .eq("project_id", PROJECT_ID)
  .eq("status", "ACTIVE")
  .eq("area", "PLANEJAMENTO");
if (planningMembersError) throw new Error(planningMembersError.message);

const planningUserIds = (planningMembers ?? []).map((row) => row.user_id);
const { data: planningProfiles, error: planningProfilesError } = planningUserIds.length
  ? await supabase.from("profiles").select("email").in("id", planningUserIds)
  : { data: [], error: null };
if (planningProfilesError) throw new Error(planningProfilesError.message);

const planningEmails = new Set(
  (planningProfiles ?? []).map((row) => String(row.email ?? "").trim().toLowerCase()).filter(Boolean)
);
const auth = new google.auth.OAuth2(
  required("GOOGLE_GMAIL_INBOUND_CLIENT_ID"),
  required("GOOGLE_GMAIL_INBOUND_CLIENT_SECRET")
);
auth.setCredentials({ refresh_token: required("GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN") });
const gmail = google.gmail({ version: "v1", auth });

const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const [{ data: recent, error: recentError }, { data: ataBySubject, error: ataError }] = await Promise.all([
  supabase
    .from("emails")
    .select("id,provider_message_id,provider_thread_id,sent_at,subject,from_address")
    .eq("project_id", PROJECT_ID)
    .eq("provider", "GMAIL")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(50),
  supabase
    .from("emails")
    .select("id,provider_message_id,provider_thread_id,sent_at,subject,from_address")
    .eq("project_id", PROJECT_ID)
    .eq("provider", "GMAIL")
    .or("subject.ilike.%ata%,subject.ilike.%reuni%")
    .order("sent_at", { ascending: false })
    .limit(150),
]);

if (recentError) throw new Error(recentError.message);
if (ataError) throw new Error(ataError.message);

const byId = new Map();
for (const row of [...(recent ?? []), ...(ataBySubject ?? [])]) {
  if (row.provider_message_id) byId.set(row.id, row);
}

let scanned = 0;
let attachmentsSeen = 0;
let attachmentsIngested = 0;
let atasPromoted = 0;
let failures = 0;

for (const row of byId.values()) {
  if (!planningEmails.has(String(row.from_address ?? "").trim().toLowerCase())) continue;
  try {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: row.provider_message_id,
      format: "full",
    });

    const parts = collectParts(full.data.payload);
    if (parts.length === 0) {
      scanned += 1;
      continue;
    }

    const results = await ingestEmailAttachmentsForMessage(supabase, {
      projectId: PROJECT_ID,
      emailId: row.id,
      gmailMessageId: row.provider_message_id,
      gmailThreadId: row.provider_thread_id ?? full.data.threadId ?? null,
      receivedAt: row.sent_at,
      parts,
      downloadAttachmentBytes: async (part) => {
        const response = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: row.provider_message_id,
          id: part.gmailAttachmentId,
        });
        return decodeBase64Url(response.data.data);
      },
    });

    attachmentsSeen += parts.length;

    for (const result of results) {
      if (result.status === "FAILED") {
        failures += 1;
        continue;
      }

      if (result.status === "INGESTED") attachmentsIngested += 1;

      const attachment = result.attachment;
      if (!isMeetingMinutes(attachment.originalFileName, row.subject)) continue;

      await linkEmailAttachmentToDocument(supabase, {
        attachmentId: attachment.id,
        kind: "ATA_REUNIAO",
        documentTitle: attachment.originalFileName.replace(/\.[^.]+$/, ""),
        documentDate: String(row.sent_at).slice(0, 10),
        author: row.from_address || mailbox,
        summary: `Ata de reunião recebida por e-mail. Assunto: ${row.subject || "(sem assunto)"}`,
      });
      atasPromoted += 1;
    }

    scanned += 1;
  } catch (error) {
    failures += 1;
    console.error("[gmail-ata-worker] falha:", error instanceof Error ? error.message : String(error));
  }
}

console.log(JSON.stringify({
  projectId: PROJECT_ID,
  scanned,
  attachmentsSeen,
  attachmentsIngested,
  atasPromoted,
  failures,
}));

if (failures > 0) process.exitCode = 1;
