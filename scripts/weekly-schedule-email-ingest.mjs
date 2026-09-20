// Ingestão automática do CRONOGRAMA SEMANAL (.mpp) enviado por e-mail
// pelo Planejamento — orquestrador Node (GitHub Actions / execução
// manual). Três fases idempotentes, todas configuradas POR PROJETO em
// project_weekly_schedule_ingestion_configs (nenhum remetente/domínio
// de cliente fixo em código):
//
//   intake  : lista no Gmail (somente-leitura, mesma credencial de
//             gmail-inbound-sync.mjs) as mensagens do domínio corporativo
//             configurado com anexo .mpp dentro da janela, cruza com
//             public.emails (só mensagens já sincronizadas), baixa
//             metadados + anexo e delega a decisão a
//             processWeeklyScheduleEmailCandidate (regra pura +
//             email_attachments + nova document_version
//             AWAITING_PROCESSING para o worker MPXJ existente);
//   promote : reprocessa intakes APPROVED_HUMAN_REVIEW ainda sem versão
//             (rede de segurança da ação server-side de revisão);
//   compare : para versões já EXTRACTED pelo worker, prepara/computa a
//             comparação atual x semanal anterior e atual x baseline
//             oficial (schedule_version_comparisons, idempotente);
//   classify: classificação determinística dos e-mails/anexos já
//             sincronizados (registro documental por e-mail);
//   workbook: leitura segura (valores armazenados) da planilha Excel do
//             relatório semanal — abas Curva S, Linha de Base, Financeiro,
//             Histograma e SSMA — com cruzamentos e roteamento aos Experts;
//   alerts  : cria o alerta único de ausência quando o prazo semanal
//             do projeto passou sem cronograma recebido (RECEIVED_DUPLICATE
//             conta como recebido).
//
// Leitura Gmail restrita ao mínimo: query já filtra remetente/anexo/
// janela; só metadados (cabeçalhos) e o anexo .mpp são baixados; corpo
// da mensagem nunca é persistido nem impresso. Logs não expõem tokens
// nem endereços além de contagens e ids de mensagem.
//
// Requer --apply para gravar (mesmo padrão dos demais scripts).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/weekly-schedule-email-ingest.mjs --apply
//   node --env-file=apps/web/.env.local scripts/weekly-schedule-email-ingest.mjs <projectId> --apply --phase=intake --limit=50
//   node --env-file=apps/web/.env.local scripts/weekly-schedule-email-ingest.mjs --apply --phase=compare
//   node --env-file=apps/web/.env.local scripts/weekly-schedule-email-ingest.mjs --apply --phase=classify
//   node --env-file=apps/web/.env.local scripts/weekly-schedule-email-ingest.mjs --apply --phase=workbook
//   node --env-file=apps/web/.env.local scripts/weekly-schedule-email-ingest.mjs --apply --phase=alerts

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { processWeeklyScheduleEmailCandidate } = await import("../apps/web/lib/schedule/weekly-ingestion/ingest-weekly-schedule-email");
const { prepareScheduleComparisons } = await import("../apps/web/lib/schedule/weekly-ingestion/prepare-schedule-comparisons");
const { createWeeklyAbsenceAlert, createWeeklySCurveAbsenceAlert } = await import("../apps/web/lib/schedule/weekly-ingestion/create-absence-alerts");
const { promoteReviewedIntake } = await import("../apps/web/lib/schedule/weekly-ingestion/promote-reviewed-intake");
const { classifySyncedEmails } = await import("../apps/web/lib/email/registry/classify-synced-emails");
const { processWeeklyReportWorkbooks } = await import("../apps/web/lib/schedule/weekly-report/process-weekly-report-workbooks");
const {
  loadWeeklyScheduleIngestionConfigs,
  createSupabaseWeeklyScheduleIngestionStore,
  createSupabaseScheduleComparisonStore,
  createSupabaseAbsenceAlertStore,
  createSupabaseReviewedIntakePromotionStore,
  createSupabaseEmailClassificationStore,
  createSupabaseWeeklyReportWorkbookStore,
  toCandidateAttachments,
} = await import("../apps/web/lib/schedule/weekly-ingestion/supabase-store");
const { extractEmailAddresses } = await import("../apps/web/lib/email/inbound/gmail-inbound-policy");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectIdArg = args.find((arg) => !arg.startsWith("--")) ?? null;
const phaseArg = (args.find((arg) => arg.startsWith("--phase=")) ?? "--phase=all").split("=")[1];
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;
const phases = new Set(phaseArg === "all" ? ["intake", "promote", "compare", "classify", "workbook", "alerts"] : [phaseArg]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getHeader(headers, name) {
  return headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/** Mesma extração recursiva de scripts/gmail-attachment-ingest.mjs (filename + body.attachmentId). */
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
  for (const child of part.parts ?? []) collectAttachmentParts(child, out);
  return out;
}

function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const configs = await loadWeeklyScheduleIngestionConfigs(supabase, { onlyEnabled: true, projectId: projectIdArg ?? undefined });

console.log("");
console.log("==========================================================");
console.log("INGESTÃO SEMANAL DE CRONOGRAMA (.mpp) POR E-MAIL");
console.log("==========================================================");
console.log("Modo:", apply ? "APLICAR (grava)" : "SIMULAÇÃO (--apply para gravar)");
console.log("Fases:", [...phases].join(", "));
console.log("Projetos habilitados:", configs.length);
console.log("");

if (configs.length === 0) {
  console.log("Nenhum projeto com ingestão semanal habilitada. Nada a fazer.");
  process.exit(0);
}

const summary = { candidates: 0, notSynced: 0, alreadyEvaluated: 0, recorded: {}, promoted: {}, comparisons: null, classification: null, workbooks: null, alerts: {} };

// ------------------------------------------------------------------
// FASE 1 — INTAKE (Gmail somente-leitura)
// ------------------------------------------------------------------
if (phases.has("intake")) {
  const { google } = await import("googleapis");
  const auth = new google.auth.OAuth2(required("GOOGLE_GMAIL_INBOUND_CLIENT_ID"), required("GOOGLE_GMAIL_INBOUND_CLIENT_SECRET"));
  auth.setCredentials({ refresh_token: required("GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN") });
  const gmail = google.gmail({ version: "v1", auth });
  const mailbox = required("GOOGLE_GMAIL_INBOUND_MAILBOX").toLowerCase();

  const profile = await gmail.users.getProfile({ userId: "me" });
  if (profile.data.emailAddress?.toLowerCase() !== mailbox) {
    throw new Error("A mailbox autenticada no Gmail não coincide com a mailbox configurada.");
  }

  const store = createSupabaseWeeklyScheduleIngestionStore(supabase, async ({ gmailMessageId, gmailAttachmentId }) => {
    // Só chamado para o anexo .mpp selecionado — nunca baixa o restante.
    const { data } = await gmail.users.messages.attachments.get({ userId: "me", messageId: gmailMessageId, id: gmailAttachmentId });
    return decodeBase64Url(data.data ?? "");
  });

  for (const config of configs) {
    console.log(`Projeto ${config.projectId}: varredura Gmail (domínio ${config.senderDomain}).`);

    // Overlap de 3 dias sobre o cursor; a idempotência real é o UNIQUE
    // (project_id, gmail_message_id) em weekly_schedule_email_intakes.
    const cursor = config.lastScannedSentAt ? new Date(new Date(config.lastScannedSentAt).getTime() - 3 * 24 * 3600 * 1000) : null;
    const windowStart = config.monitoringStartAt ? new Date(config.monitoringStartAt) : null;
    const afterDate = [cursor, windowStart].filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const queryParts = [`from:${config.senderDomain}`, "has:attachment", "filename:mpp"];
    if (afterDate) queryParts.push(`after:${Math.floor(afterDate.getTime() / 1000)}`);
    if (config.monitoringEndAt) queryParts.push(`before:${Math.ceil(new Date(config.monitoringEndAt).getTime() / 1000)}`);
    const query = queryParts.join(" ");

    const ids = [];
    let pageToken;
    do {
      const response = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 100, pageToken, includeSpamTrash: false });
      for (const message of response.data.messages ?? []) if (message.id) ids.push(message.id);
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < limit);

    console.log(`  Mensagens Gmail candidatas: ${ids.length}`);
    if (ids.length === 0) continue;

    const { data: emailRows, error: emailsError } = await supabase
      .from("emails")
      .select("id,provider_message_id,provider_thread_id,message_id_header,sent_at,mailbox_address,direction")
      .eq("project_id", config.projectId)
      .eq("provider", "GMAIL")
      .in("provider_message_id", ids.slice(0, limit));
    if (emailsError) throw new Error(emailsError.message);
    const emailByMessageId = new Map((emailRows ?? []).map((row) => [row.provider_message_id, row]));

    const { data: intakeRows, error: intakesError } = await supabase
      .from("weekly_schedule_email_intakes")
      .select("gmail_message_id")
      .eq("project_id", config.projectId)
      .in("gmail_message_id", ids.slice(0, limit));
    if (intakesError) throw new Error(intakesError.message);
    const alreadyEvaluated = new Set((intakeRows ?? []).map((row) => row.gmail_message_id));

    let maxSentAt = config.lastScannedSentAt ? new Date(config.lastScannedSentAt) : null;

    for (const id of ids.slice(0, limit)) {
      if (alreadyEvaluated.has(id)) {
        summary.alreadyEvaluated += 1;
        continue;
      }
      const emailRow = emailByMessageId.get(id);
      if (!emailRow) {
        // Ainda não sincronizada por gmail-inbound-sync.mjs — próxima rodada.
        summary.notSynced += 1;
        continue;
      }
      summary.candidates += 1;

      const { data: message } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const headers = message.payload?.headers ?? [];
      const parts = collectAttachmentParts(message.payload);

      const candidate = {
        emailId: emailRow.id,
        gmailMessageId: id,
        gmailThreadId: message.threadId ?? emailRow.provider_thread_id ?? null,
        messageIdHeader: getHeader(headers, "Message-ID") ?? emailRow.message_id_header ?? null,
        // Proveniência: caixa monitorada, direção (já classificada pelo
        // inbound sync) e labels/pasta do Gmail (ex.: SENT, INBOX).
        mailboxAddress: emailRow.mailbox_address ?? mailbox,
        direction: emailRow.direction ?? null,
        providerLabels: message.labelIds ?? [],
        fromAddress: extractEmailAddresses(getHeader(headers, "From"))[0] ?? "",
        toAddresses: extractEmailAddresses(getHeader(headers, "To")),
        ccAddresses: extractEmailAddresses(getHeader(headers, "Cc")),
        subject: getHeader(headers, "Subject") ?? "(sem assunto)",
        sentAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : emailRow.sent_at,
        attachments: toCandidateAttachments(parts),
      };

      console.log(`  Mensagem ${id}: ${candidate.attachments.length} anexo(s).`);
      if (!apply) continue;

      const outcome = await processWeeklyScheduleEmailCandidate(store, config, candidate);
      const key = outcome.kind === "ALREADY_EVALUATED" ? "ALREADY_EVALUATED" : outcome.status;
      summary.recorded[key] = (summary.recorded[key] ?? 0) + 1;
      console.log(`    => ${key}${outcome.kind === "RECORDED" && outcome.documentVersionId ? ` (document_version ${outcome.documentVersionId})` : ""}`);

      const sentAt = new Date(candidate.sentAt);
      if (!maxSentAt || sentAt > maxSentAt) maxSentAt = sentAt;
      await sleep(200);
    }

    if (apply && maxSentAt && (!config.lastScannedSentAt || maxSentAt > new Date(config.lastScannedSentAt))) {
      const { error } = await supabase
        .from("project_weekly_schedule_ingestion_configs")
        .update({ last_scanned_sent_at: maxSentAt.toISOString() })
        .eq("id", config.id);
      if (error) throw new Error(error.message);
    }
  }
}

// ------------------------------------------------------------------
// FASE 2 — PROMOÇÃO PÓS-REVISÃO (rede de segurança, idempotente)
// ------------------------------------------------------------------
if (phases.has("promote") && apply) {
  const promotionStore = createSupabaseReviewedIntakePromotionStore(supabase);
  const { data: approved, error: approvedError } = await supabase
    .from("weekly_schedule_email_intakes")
    .select("id")
    .eq("status", "APPROVED_HUMAN_REVIEW")
    .is("document_version_id", null)
    .in("project_id", configs.map((config) => config.projectId))
    .limit(limit);
  if (approvedError) throw new Error(approvedError.message);
  for (const row of approved ?? []) {
    // Resultado do reprocessamento volta para o ÚLTIMO evento de revisão
    // (APPROVE/REPROCESS) do intake — rastreabilidade decisão → resultado.
    const { data: lastEvent } = await supabase
      .from("email_document_review_events")
      .select("id")
      .eq("entity_type", "WEEKLY_SCHEDULE_EMAIL_INTAKE")
      .eq("entity_id", row.id)
      .in("action", ["APPROVE", "REPROCESS"])
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const result = await promoteReviewedIntake(promotionStore, row.id, lastEvent?.id ?? null);
    summary.promoted[result.outcome] = (summary.promoted[result.outcome] ?? 0) + 1;
  }
}

// ------------------------------------------------------------------
// FASE 3 — COMPARAÇÕES (pós-EXTRACTED, idempotente)
// ------------------------------------------------------------------
if (phases.has("compare") && apply) {
  summary.comparisons = await prepareScheduleComparisons(createSupabaseScheduleComparisonStore(supabase), { limit });
}

// ------------------------------------------------------------------
// FASE 4 — CLASSIFICAÇÃO DETERMINÍSTICA (registro documental por e-mail)
// ------------------------------------------------------------------
if (phases.has("classify") && apply) {
  const classificationStore = createSupabaseEmailClassificationStore(supabase);
  summary.classification = { examined: 0, classified: 0, pendingReview: 0, unclassified: 0, attachmentsClassified: 0 };
  for (const config of configs) {
    const result = await classifySyncedEmails(classificationStore, config.projectId, { limit: 200 });
    for (const key of Object.keys(summary.classification)) summary.classification[key] += result[key];
  }
}

// ------------------------------------------------------------------
// FASE 5 — PLANILHA DO RELATÓRIO SEMANAL (Curva S, Linha de Base,
// Financeiro, Histograma, SSMA) — valores armazenados, nunca macros
// ------------------------------------------------------------------
if (phases.has("workbook") && apply) {
  summary.workbooks = await processWeeklyReportWorkbooks(createSupabaseWeeklyReportWorkbookStore(supabase), { limit });
}

// ------------------------------------------------------------------
// FASE 6 — ALERTAS DE AUSÊNCIA (único por semana)
// ------------------------------------------------------------------
if (phases.has("alerts") && apply) {
  const alertStore = createSupabaseAbsenceAlertStore(supabase);
  for (const config of configs) {
    const outcome = await createWeeklyAbsenceAlert(alertStore, config, new Date());
    summary.alerts[outcome.result] = (summary.alerts[outcome.result] ?? 0) + 1;
    console.log(`Projeto ${config.projectId}: semana ${outcome.weekStart} => cronograma ${outcome.result}`);
    const sCurve = await createWeeklySCurveAbsenceAlert(alertStore, config, new Date());
    summary.alerts[`S_CURVE_${sCurve.result}`] = (summary.alerts[`S_CURVE_${sCurve.result}`] ?? 0) + 1;
    console.log(`Projeto ${config.projectId}: semana ${sCurve.weekStart} => Curva S ${sCurve.result}`);
  }
}

console.log("");
console.log("RESULTADO");
console.log("---------");
console.table([
  {
    candidatas: summary.candidates,
    nao_sincronizadas: summary.notSynced,
    ja_avaliadas: summary.alreadyEvaluated,
    ...Object.fromEntries(Object.entries(summary.recorded).map(([key, value]) => [key.toLowerCase(), value])),
  },
]);
if (Object.keys(summary.promoted).length > 0) console.table([summary.promoted]);
if (summary.comparisons) console.table([summary.comparisons]);
if (summary.classification) console.table([summary.classification]);
if (summary.workbooks) console.table([summary.workbooks]);
if (Object.keys(summary.alerts).length > 0) console.table([summary.alerts]);
console.log("");
console.log("INGESTÃO SEMANAL concluída.");
