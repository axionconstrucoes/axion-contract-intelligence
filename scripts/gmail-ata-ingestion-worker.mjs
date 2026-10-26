import { register } from "node:module";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { computeExitCode, formatSummary, processMessageRows } from "./lib/gmail-ata-processing.mjs";

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

function isMeetingMinutes(fileName) {
  const text = normalize(fileName);
  const documentExtension = /\.(pdf|doc|docx|odt|rtf)$/i.test(fileName);
  if (!documentExtension) return false;
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

const [
  { data: recent, error: recentError },
  { data: ataBySubject, error: ataError },
  { data: weeklyReports, error: weeklyReportsError },
] = await Promise.all([
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
  // Relatórios semanais são um pacote documental: MPP + Excel + PDF/ata.
  // Não limitar a 24h: isso permite recuperar anexos de pacotes já
  // sincronizados antes desta regra (ex.: Excel ausente em email_attachments).
  supabase
    .from("emails")
    .select("id,provider_message_id,provider_thread_id,sent_at,subject,from_address")
    .eq("project_id", PROJECT_ID)
    .eq("provider", "GMAIL")
    .eq("document_classification", "RELATORIO_SEMANAL")
    .order("sent_at", { ascending: false })
    .limit(150),
]);

if (recentError) throw new Error(recentError.message);
if (ataError) throw new Error(ataError.message);
if (weeklyReportsError) throw new Error(weeklyReportsError.message);

const byId = new Map();
for (const row of [...(recent ?? []), ...(ataBySubject ?? []), ...(weeklyReports ?? [])]) {
  if (row.provider_message_id) byId.set(row.id, row);
}

const summary = await processMessageRows({
  rows: byId.values(),
  planningEmails,
  gmail,
  ingest: (input) => ingestEmailAttachmentsForMessage(supabase, { projectId: PROJECT_ID, ...input }),
  link: (input) => linkEmailAttachmentToDocument(supabase, input),
  collectParts,
  decodeBase64Url,
  isMeetingMinutes,
  projectId: PROJECT_ID,
  mailbox,
});

console.log(JSON.stringify({ projectId: PROJECT_ID, ...summary }));
console.log(formatSummary(summary));

process.exitCode = computeExitCode(summary);
