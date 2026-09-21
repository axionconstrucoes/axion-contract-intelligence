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
//   replies : captura (Gmail) as RESPOSTAS por e-mail aos alertas de risco
//             -> alert_email_messages e as processa (filtro/correlação/
//             autorização/classificação/ação formal via RPC). Usa
//             EXCLUSIVAMENTE as credenciais dedicadas
//             ACC_RISK_ALERTS_INBOUND_* (caixa axion@…; escopo gmail.readonly)
//             — nunca as do Gmail Inbound Sync; ausentes => fase pulada
//             (SKIPPED_NOT_CONFIGURED); perfil ≠ caixa => fase bloqueada.
//             Duas buscas:
//             (a) mensagens enviadas ao Reply-To opaco da caixa oficial
//                 (<caixa>+alerta-<token>@...) — caminho PRINCIPAL;
//             (b) threads dos alertas enviados — fallback (In-Reply-To/
//                 References). Nunca envia e-mail (quem envia é a outbox
//             no worker Vercel).
//
// Leitura Gmail restrita ao mínimo: query já filtra remetente/anexo/
// janela; só metadados (cabeçalhos) e o anexo .mpp são baixados; corpo
// da mensagem nunca é persistido nem impresso. Logs não expõem tokens
// nem endereços além de contagens e ids de mensagem.
//
// Requer --apply para gravar (mesmo padrão dos demais scripts) e a flag
// ACC_WEEKLY_REPORTS_ENABLED=true (trava de deployment: sem ela, nada é
// lido nem gravado — as tabelas novas podem ainda não existir no banco).
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

const { isWeeklyReportsEnabled, WEEKLY_REPORTS_FLAG_NAME } = await import("../apps/web/lib/feature-flags/weekly-reports");
if (!isWeeklyReportsEnabled()) {
  console.log(`[weekly-schedule-email-ingest] ${WEEKLY_REPORTS_FLAG_NAME} não é "true" — funcionalidade desativada; nada processado.`);
  process.exit(0);
}

const { processWeeklyScheduleEmailCandidate } = await import("../apps/web/lib/schedule/weekly-ingestion/ingest-weekly-schedule-email");
const { prepareScheduleComparisons } = await import("../apps/web/lib/schedule/weekly-ingestion/prepare-schedule-comparisons");
const { createWeeklyAbsenceAlert, createWeeklySCurveAbsenceAlert, createWeeklyWorkbookAbsenceAlert, resolveAbsenceAlertsWithEvidence } = await import("../apps/web/lib/schedule/weekly-ingestion/create-absence-alerts");
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
const { createSupabaseRiskAlertStore } = await import("../apps/web/lib/risk-alerts/supabase-store");
const { processAlertReplies } = await import("../apps/web/lib/risk-alerts/replies/process-alert-replies");
const { extractInboundFromGmail } = await import("../apps/web/lib/risk-alerts/replies/gmail-reply-extract");
const { extractReplyTokens, hashReplyToken } = await import("../apps/web/lib/risk-alerts/replies/reply-pipeline");
const { resolveRiskAlertInboundCredentials, inboundProfileMatchesMailbox, checkOverrideCompatibility } = await import("../apps/web/lib/risk-alerts/replies/inbound-credentials");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectIdArg = args.find((arg) => !arg.startsWith("--")) ?? null;
const phaseArg = (args.find((arg) => arg.startsWith("--phase=")) ?? "--phase=all").split("=")[1];
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;
const phases = new Set(phaseArg === "all" ? ["intake", "promote", "compare", "classify", "workbook", "alerts", "replies"] : [phaseArg]);

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
    // Planilha do relatório semanal ausente (mesmas garantias; inválida ≠ ausente).
    const workbook = await createWeeklyWorkbookAbsenceAlert(alertStore, config, new Date());
    summary.alerts[`WORKBOOK_${workbook.result}`] = (summary.alerts[`WORKBOOK_${workbook.result}`] ?? 0) + 1;
    // Chegada posterior da evidência resolve os alertas de ausência abertos (encerra o caso de risco).
    const resolution = await resolveAbsenceAlertsWithEvidence(alertStore, config.projectId);
    summary.alerts.RESOLVED_BY_EVIDENCE = (summary.alerts.RESOLVED_BY_EVIDENCE ?? 0) + resolution.resolved;
    console.log(`Projeto ${config.projectId}: semana ${sCurve.weekStart} => Curva S ${sCurve.result}`);
  }
}

// ------------------------------------------------------------------
// FASE 7 — RESPOSTAS POR E-MAIL AOS ALERTAS DE RISCO
// ------------------------------------------------------------------
let repliesBlocked = false;
if (phases.has("replies") && apply) {
  // Credenciais DEDICADAS (nunca GOOGLE_GMAIL_INBOUND_*, que são do Gmail
  // Inbound Sync). Ausentes => fase pulada sem falhar o job.
  const inbound = resolveRiskAlertInboundCredentials(process.env);
  if (!inbound.ok) {
    summary.replies = { status: inbound.status, missing: inbound.missing, threads: 0, replyToMatches: 0, captured: 0, processed: [] };
    console.log(`Respostas aos alertas: ${inbound.status} (variáveis ausentes: ${inbound.missing.join(", ")}).`);
  }
  const gmailClient = inbound.ok ? await (async () => {
    const { google } = await import("googleapis");
    const auth = new google.auth.OAuth2(inbound.credentials.clientId, inbound.credentials.clientSecret);
    auth.setCredentials({ refresh_token: inbound.credentials.refreshToken });
    return google.gmail({ version: "v1", auth });
  })() : null;
  // Falha fechada: a conta autenticada precisa ser exatamente a caixa dedicada.
  if (gmailClient) {
    let profileEmail = null;
    try {
      const profile = await gmailClient.users.getProfile({ userId: "me" });
      profileEmail = profile.data.emailAddress ?? null;
    } catch {
      profileEmail = null; // sem detalhes: nunca registrar token/erro de OAuth com credenciais
    }
    if (!inboundProfileMatchesMailbox(profileEmail, inbound.credentials.mailbox)) {
      repliesBlocked = true;
      summary.replies = { status: "BLOCKED_MAILBOX_MISMATCH", threads: 0, replyToMatches: 0, captured: 0, processed: [] };
      console.error("Respostas aos alertas: BLOCKED_MAILBOX_MISMATCH — a conta Gmail autenticada não é a caixa dedicada configurada (ACC_RISK_ALERTS_INBOUND_MAILBOX). Fase bloqueada.");
    }
  }
  const gmail = repliesBlocked ? null : gmailClient;
  const mailbox = inbound.ok ? inbound.credentials.mailbox : null;
  const riskStore = createSupabaseRiskAlertStore(supabase);
  if (gmail) summary.replies = { status: "OK", threads: 0, replyToMatches: 0, captured: 0, skippedProjects: [], processed: [] };

  for (const config of gmail ? configs : []) {
    // Override de entrega do projeto precisa ser a própria caixa dedicada —
    // senão as respostas chegariam a uma caixa que este worker não lê.
    const { data: overrideRow } = await supabase.from("project_weekly_schedule_ingestion_configs").select("pilot_delivery_override_email").eq("project_id", config.projectId).maybeSingle();
    const compat = checkOverrideCompatibility(mailbox, overrideRow?.pilot_delivery_override_email ?? null);
    if (!compat.ok) {
      summary.replies.skippedProjects.push({ projectId: config.projectId, status: compat.status });
      console.log(`Projeto ${config.projectId}: respostas ${compat.status} (override de entrega difere da caixa dedicada).`);
      continue;
    }
    // Threads dos alertas já enviados deste projeto.
    const { data: conversations } = await supabase
      .from("alert_email_conversations")
      .select("id,case_id,provider_thread_id")
      .eq("project_id", config.projectId)
      .not("provider_thread_id", "is", null);
    const { data: known } = await supabase.from("alert_email_messages").select("provider_message_id").eq("project_id", config.projectId);
    const knownIds = new Set((known ?? []).map((row) => row.provider_message_id));
    // Índice hash(token do Reply-To) -> conversa (o token em si nunca é
    // persistido; o hash do endereço recebido é comparado com o gravado).
    const { data: outboundTokens } = await supabase
      .from("alert_email_messages")
      .select("reply_token_hash,conversation_id,case_id")
      .eq("project_id", config.projectId)
      .eq("direction", "OUTBOUND")
      .not("reply_token_hash", "is", null);
    const conversationByTokenHash = new Map((outboundTokens ?? []).map((row) => [row.reply_token_hash, { id: row.conversation_id, case_id: row.case_id }]));

    const insertInbound = async (conversation, message) => {
      if (!message.id || knownIds.has(message.id)) return;
      const extracted = extractInboundFromGmail(message, mailbox);
      if (!extracted || extracted.isSentByMailbox) return; // mensagens do próprio ACC nunca viram "resposta"
      const { error } = await supabase.from("alert_email_messages").insert({
        project_id: config.projectId,
        conversation_id: conversation.id,
        case_id: conversation.case_id,
        direction: "INBOUND",
        provider: "GMAIL",
        provider_message_id: extracted.providerMessageId,
        provider_thread_id: extracted.providerThreadId,
        message_id_header: extracted.headers.messageId,
        in_reply_to_header: extracted.headers.inReplyTo,
        references_header: extracted.headers.references.join(" "),
        reply_to_header: extracted.headers.replyTo,
        sender_email: extracted.headers.from,
        recipients: [...extracted.headers.to, ...(extracted.headers.cc ?? [])],
        subject: extracted.headers.subject,
        body_original: extracted.bodyOriginal,
        auto_submitted: Boolean(extracted.headers.autoSubmitted && extracted.headers.autoSubmitted.toLowerCase() !== "no"),
        authentication_results: extracted.headers.authenticationResults,
        status: "RECEIVED",
        received_at: extracted.receivedAt,
      });
      if (!error) {
        knownIds.add(message.id);
        summary.replies.captured += 1;
      } else if (error.code !== "23505") {
        throw new Error(`Falha ao registrar resposta: ${error.message}`);
      }
    };

    // (a) Caminho principal: respostas endereçadas ao Reply-To opaco da
    //     caixa oficial. A busca é por prefixo do plus-address; o token de
    //     cada mensagem é resolvido pelo hash — sem hash conhecido, a
    //     mensagem fica para a correlação por thread (b) ou revisão humana.
    if (conversationByTokenHash.size > 0) {
      const [local] = mailbox.split("@");
      let pageToken;
      do {
        let page;
        try {
          page = await gmail.users.messages.list({ userId: "me", q: `to:${local}+alerta- newer_than:30d -from:me`, maxResults: 100, pageToken });
        } catch {
          break; // busca indisponível — o fallback por thread continua
        }
        for (const stub of page.data.messages ?? []) {
          if (!stub.id || knownIds.has(stub.id)) continue;
          let full;
          try {
            full = await gmail.users.messages.get({ userId: "me", id: stub.id, format: "full" });
          } catch {
            continue;
          }
          const headers = full.data.payload?.headers ?? [];
          const addressed = headers.filter((h) => /^(to|cc|delivered-to)$/i.test(h.name ?? "")).map((h) => h.value ?? "");
          const tokens = extractReplyTokens(addressed.flatMap((v) => v.split(",")));
          const matches = Array.from(new Set(tokens.map((t) => conversationByTokenHash.get(hashReplyToken(t))).filter(Boolean)));
          if (matches.length !== 1) continue; // sem token deste projeto (ou ambíguo): fica para (b)/revisão
          summary.replies.replyToMatches += 1;
          await insertInbound(matches[0], full.data);
        }
        pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    // (b) Fallback: threads dos alertas enviados (In-Reply-To/References).
    for (const conversation of conversations ?? []) {
      summary.replies.threads += 1;
      let thread;
      try {
        thread = await gmail.users.threads.get({ userId: "me", id: conversation.provider_thread_id, format: "full" });
      } catch {
        continue; // thread indisponível — próxima rodada
      }
      for (const message of thread.data.messages ?? []) {
        await insertInbound(conversation, message);
      }
    }
    // Processamento (puro + store): nunca loga corpo — só contagens.
    const outcome = await processAlertReplies(riskStore, config.projectId, new Date().toISOString(), [mailbox]);
    summary.replies.processed.push(outcome);
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
if (summary.replies) {
  console.table([{ status: summary.replies.status ?? "OK", threads: summary.replies.threads, viaReplyTo: summary.replies.replyToMatches, capturadas: summary.replies.captured, projetosPulados: (summary.replies.skippedProjects ?? []).length }]);
  if (summary.replies.processed.length) console.table(summary.replies.processed);
}
// Fase de respostas bloqueada (perfil ≠ caixa dedicada): as demais fases já
// concluíram; o job termina com erro para ficar visível, sem interromper nada.
if (repliesBlocked) process.exitCode = 1;
console.log("");
console.log("INGESTÃO SEMANAL concluída.");
