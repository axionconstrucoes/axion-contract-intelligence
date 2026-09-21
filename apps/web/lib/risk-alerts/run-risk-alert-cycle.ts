// Ciclo do worker de alertas de risco (horário). Server-only: usa o
// admin client, o provider de e-mail real/fake, os Experts e a assinatura ACC.
// Sequência por projeto habilitado:
//   snapshot -> prontidão (pilot-readiness) -> planRiskAlerts (puro) ->
//   persistir (casos, ações SLA, escalonamentos, outbox, auditoria) ->
//   timeouts de encaminhamento -> consultas a Expert -> enviar PENDING
//   (planejadas neste ciclo + manuais/ações/retries) -> marcar.
// Toda entrega passa pela outbox (única fonte de idempotência).
// Condições para envio REAL: ver pilot-readiness.ts — qualquer bloqueio
// mantém as entradas SUPPRESSED com o motivo. dryRun: nenhuma escrita.

import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { answerCeoQuery } from "@/lib/ai/experts/ceo/query";
import { answerCommercialDirectorQuery } from "@/lib/ai/experts/commercial-director/query";
import { answerEsgDirectorQuery } from "@/lib/ai/experts/esg-director/query";
import { answerLegalConsultantQuery } from "@/lib/ai/experts/legal-consultant/query";
import { answerPlanningDirectorQuery } from "@/lib/ai/experts/planning-director/query";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { appendAccEmailSignature } from "@/lib/email/branding/acc-email-signature";
import { loadAccLogoInlineImage } from "@/lib/email/branding/load-acc-logo-inline-image";
import { EmailSendError, type EmailProvider } from "@/lib/email/email-provider";
import { FakeEmailProvider } from "@/lib/email/fake-email-provider";
import { getEmailProvider } from "@/lib/email/get-email-provider";
import { resolveEmailProviderName } from "@/lib/email/gmail-auth";
import { issueEmailAlertActionButtons } from "@/lib/email-actions/issue-tokens";
import { isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { slaEscalationLevelLabels } from "@/lib/labels";
import { resolveMatrixPolicy, type MatrixPolicy } from "@/lib/sla/resolve-matrix-policy";
import type { SlaArea, SlaEscalationLevel, SlaRiskLevel } from "@/lib/sla/types";

import { actionLinkExpiry, buildActionLink, EMAIL_ACTION_TYPES, generateActionToken, hashActionToken } from "./action-links";
import { applyForwardTimeout, applyScheduledTopLevel } from "./alert-state-machine";
import { buildAlertFollowUpEmail, buildImmediateRiskAlertEmail, buildRiskDigestEmail, formatDateTimeBR, type BuiltEmail } from "./build-risk-alert-emails";
import { evaluatePilotReadiness, blockerToSuppressionReason, isSeverityMapComplete } from "./pilot-readiness";
import { evaluateRecipient, planRiskAlerts } from "./plan-risk-alerts";
import { resolveDeliveryAddress } from "@/lib/email/pilot-delivery-override";

import { buildOpaqueReplyTo, generateReplyToken, hashReplyToken } from "./replies/reply-pipeline";
import type { PendingOutboxRow, RiskAlertProjectSnapshot, RiskAlertStore } from "./store";
import { createSupabaseRiskAlertStore, sanitizeError } from "./supabase-store";
import type { AlertActionType, ExpertId, ImmediateAlertContent, PlannedOutboxEntry, RiskAlertPlan } from "./types";
import { DEFAULT_PROJECT_TIMEZONE } from "./types";

export interface RiskAlertCycleProjectResult {
  projectId: string;
  blockedReason: string | null;
  readinessBlockers: string[];
  cases: number;
  slaActionsCreated: number;
  escalationsApplied: number;
  planned: number;
  suppressed: number;
  sent: number;
  failed: number;
  skipped: number;
  forwardsReturned: number;
  topLevelReached: number;
  expertAnswers: number;
  digestWindow: { key: string; isOpen: boolean } | null;
  dryRunPreview?: Array<Record<string, unknown>>;
}

export interface RiskAlertCycleResult {
  ranAt: string;
  featureEnabled: boolean;
  dryRun: boolean;
  provider: string;
  projects: RiskAlertCycleProjectResult[];
}

/** Porta do Expert (injeção nos testes; real = Experts existentes). Só recomenda. */
export interface ExpertConsultant {
  answer(input: { expertId: ExpertId; projectId: string; question: string }): Promise<{ answerText: string; confidence: number; requiresHumanReview: boolean }>;
}

export interface RunRiskAlertCycleOptions {
  now?: Date;
  dryRun?: boolean;
  projectId?: string | null;
  store?: RiskAlertStore;
  provider?: EmailProvider;
  expert?: ExpertConsultant;
}

function createDefaultExpertConsultant(): ExpertConsultant {
  const client = createSupabaseAdminClient();
  return {
    async answer({ expertId, projectId, question }) {
      const request = { scope: "PROJECT" as const, projectId, question };
      const fn = {
        "planning-director": answerPlanningDirectorQuery,
        "commercial-director": answerCommercialDirectorQuery,
        "esg-director": answerEsgDirectorQuery,
        "legal-consultant": answerLegalConsultantQuery,
        ceo: answerCeoQuery,
      }[expertId];
      const result = await fn(client, request);
      const r = result.response;
      const answerText = [
        r.interpretacao,
        r.riscos.length ? `Riscos: ${r.riscos.join("; ")}` : null,
        r.recomendacoes.length ? `Recomendações: ${r.recomendacoes.join("; ")}` : null,
        r.fatosDocumentados.length ? `Evidências: ${r.fatosDocumentados.slice(0, 5).join("; ")}` : null,
        r.informacoesFaltantes.length ? `Informações faltantes: ${r.informacoesFaltantes.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      return { answerText, confidence: r.confidence, requiresHumanReview: true };
    },
  };
}

export async function runRiskAlertCycle(options: RunRiskAlertCycleOptions = {}): Promise<RiskAlertCycleResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const dryRun = options.dryRun ?? false;
  const featureEnabled = isWeeklyReportsEnabled();
  const providerName = resolveEmailProviderName();

  const result: RiskAlertCycleResult = { ranAt: nowIso, featureEnabled, dryRun, provider: dryRun ? "FAKE(dry-run)" : providerName, projects: [] };
  if (!featureEnabled) return result; // nenhuma consulta ao banco

  const store = options.store ?? createSupabaseRiskAlertStore(createSupabaseAdminClient());
  const provider = dryRun ? new FakeEmailProvider() : (options.provider ?? getEmailProvider());
  const providerConfigured = providerName === "gmail" || Boolean(options.provider);
  const baseUrl = getAppBaseUrl();
  const inlineLogo = loadAccLogoInlineImage();
  const expert = options.expert ?? (dryRun ? null : createDefaultExpertConsultant());

  const projectIds = options.projectId ? [options.projectId] : await store.listEnabledProjectIds();

  for (const projectId of projectIds) {
    const snapshot = await store.loadProjectSnapshot(projectId);
    const timeZone = snapshot.settings?.timezone ?? DEFAULT_PROJECT_TIMEZONE;
    const policyFor = (area: SlaArea, riskLevel: SlaRiskLevel) =>
      resolveMatrixPolicy({ rules: snapshot.matrixRules, responsibles: snapshot.areaResponsibles, settings: snapshot.settings, area, riskLevel });

    const areasInUse = Array.from(new Set(snapshot.cases.map((c) => c.area)));
    const readiness = evaluatePilotReadiness({
      featureEnabled,
      config: snapshot.config,
      providerConfigured,
      explicitRuleLevels: Array.from(new Set(snapshot.matrixRules.filter((r) => r.active).map((r) => r.riskLevel))),
      matrixStatuses: areasInUse.map((area) => {
        const policy = policyFor(area, "HIGH");
        return { area, status: policy.status, missing: policy.missing };
      }),
      allowlistValid: Boolean(snapshot.config?.pilotRecipientAllowlistUserIds?.length),
      projectConfirmed: Boolean(snapshot.config?.pilotProjectConfirmedAt),
      workspaceConfigured: Boolean(snapshot.senderMailbox) || Boolean(options.provider),
      severityMapConfigured: isSeverityMapComplete(snapshot.config?.severityMap ?? null),
      replyMailboxConfigured: Boolean(snapshot.replyMailbox),
      replyMailbox: snapshot.replyMailbox,
      deliveryOverrideEmail: snapshot.config?.pilotDeliveryOverrideEmail ?? null,
    });

    const plan: RiskAlertPlan = planRiskAlerts({
      now: nowIso,
      projectId,
      projectName: snapshot.projectName,
      featureEnabled,
      providerConfigured,
      dryRun,
      config: snapshot.config,
      timeZone,
      cases: snapshot.cases,
      existingCases: snapshot.existingCases,
      linkedActions: snapshot.linkedActions,
      policyFor,
      recipients: snapshot.recipients,
      existingIdempotencyKeys: snapshot.existingIdempotencyKeys,
      previousDigestSentAt: snapshot.previousDigestSentAt,
      readinessBlockers: readiness.blockers.map(blockerToSuppressionReason),
    });

    const projectResult: RiskAlertCycleProjectResult = {
      projectId,
      blockedReason: plan.blockedReason,
      readinessBlockers: readiness.blockers,
      cases: plan.caseUpserts.length,
      slaActionsCreated: 0,
      escalationsApplied: 0,
      planned: plan.outbox.length,
      suppressed: plan.outbox.filter((e) => e.recipient.status === "SUPPRESSED").length,
      sent: 0,
      failed: 0,
      skipped: 0,
      forwardsReturned: 0,
      topLevelReached: 0,
      expertAnswers: 0,
      digestWindow: plan.digestWindow,
    };

    if (plan.blockedReason) {
      result.projects.push(projectResult);
      continue;
    }

    if (dryRun) {
      projectResult.dryRunPreview = plan.outbox.map((entry) => ({
        idempotencyKey: entry.idempotencyKey,
        type: entry.notificationType,
        level: entry.escalationLevel,
        riskLevel: entry.riskLevel,
        recipientUserId: entry.recipient.userId,
        recipientStatus: entry.recipient.status,
        suppressionReason: entry.recipient.suppressionReason ?? "DRY_RUN",
        summary: entry.payloadSummary,
      }));
      projectResult.slaActionsCreated = plan.slaActionCreates.length;
      projectResult.escalationsApplied = plan.escalations.length;
      result.projects.push(projectResult);
      continue;
    }

    // ---- persistência do plano ----
    const caseIds = await store.upsertCases(
      projectId,
      plan.caseUpserts.map((u) => ({
        caseKey: u.caseKey,
        existingId: u.existingId,
        input: u.input,
        change: u.change,
        policyStatus: u.policy?.status ?? "OK",
        policyMissing: u.policy?.missing ?? [],
        previousRiskLevel: snapshot.existingCases.find((c) => c.id === u.existingId)?.riskLevel ?? null,
        now: nowIso,
      }))
    );
    const slaActionIds = await store.createSlaActions(projectId, plan.slaActionCreates, caseIds);
    projectResult.slaActionsCreated = slaActionIds.size;
    const escalation = await store.applyEscalations(projectId, plan.escalations);
    projectResult.escalationsApplied = escalation.applied;
    const persisted = await store.enqueue(projectId, plan.outbox, caseIds, slaActionIds);
    await store.audit(projectId, [
      ...plan.audit,
      ...(readiness.blockers.length
        ? [{ action: "RISK_ALERT_NOT_READY_FOR_REAL_SEND", entityType: "PROJECT", entityId: projectId, detail: `Envio real bloqueado: ${readiness.blockers.join(", ")}.` }]
        : []),
      ...plan.outbox.map((entry) => ({
        action: "RISK_ALERT_PLANNED",
        entityType: entry.notificationType === "DIGEST" ? "RISK_ALERT_DIGEST" : "RISK_ALERT_CASE",
        entityId: entry.caseKey ? (caseIds.get(entry.caseKey) ?? entry.caseKey) : (entry.digestWindow ?? entry.idempotencyKey),
        detail: `Alerta ${entry.notificationType}${entry.escalationLevel ? ` (${entry.escalationLevel})` : ""} para ${entry.recipient.userId}: ${entry.recipient.status}${entry.recipient.suppressionReason ? ` (${entry.recipient.suppressionReason})` : ""}. Chave ${entry.idempotencyKey}.`,
      })),
    ]);

    // ---- prazo da Diretoria vencido: limite de escalonamento (uma vez, sem e-mail) ----
    for (const item of plan.topLevelReached) {
      const caseId = caseIds.get(item.caseKey);
      if (!caseId) continue;
      const loaded = await store.loadCaseSnapshotForAction(caseId);
      if (!loaded) continue;
      const transition = applyScheduledTopLevel({ now: nowIso, snapshot: loaded.snapshot, reasons: item.reasons });
      if (!transition) continue;
      try {
        await store.applyTransition(caseId, transition, null);
        projectResult.topLevelReached += 1;
      } catch {
        // Já registrado pelo caminho imediato (chave única) ou ação humana concorrente — nada a repetir.
      }
    }

    // ---- encaminhamentos sem ação: devolver ao remetente ----
    for (const forward of await store.listActiveForwards(projectId)) {
      const loaded = await store.loadCaseSnapshotForAction(forward.caseId);
      if (!loaded || !snapshot.config) continue;
      const policy = policyFor(loaded.record.area, loaded.snapshot.riskLevel);
      const transition = applyForwardTimeout({ now: nowIso, snapshot: loaded.snapshot, policy, config: snapshot.config, recipients: snapshot.recipients });
      if (!transition) continue;
      try {
        await store.applyTransition(forward.caseId, transition, null);
        projectResult.forwardsReturned += 1;
      } catch {
        // Concorrência (ação humana no meio) — próximo ciclo reavalia.
      }
    }

    // ---- consultas a Expert pendentes (só recomenda; nunca resolve) ----
    if (expert) {
      for (const consultation of await store.listPendingExpertConsultations(projectId)) {
        try {
          const answer = await expert.answer({ expertId: consultation.expertId, projectId, question: consultation.question });
          await store.recordExpertAnswer({ ...consultation, ...answer, requiresHumanReview: true });
          projectResult.expertAnswers += 1;
          // Resposta na mesma thread ao solicitante (allowlist do piloto aplicada).
          if (consultation.askedByUserId && snapshot.config) {
            const recipient = evaluateRecipient(consultation.askedByUserId, snapshot.config, snapshot.recipients);
            await store.enqueue(
              projectId,
              [
                {
                  idempotencyKey: `${consultation.caseId}:EXPERT_ANSWER:${consultation.eventId}:${consultation.askedByUserId}`,
                  notificationType: "EXPERT_ANSWER",
                  escalationLevel: null,
                  riskLevel: "HIGH",
                  caseKey: null,
                  slaActionId: null,
                  recipient: readiness.blockers.length && recipient.status === "PENDING" ? { ...recipient, status: "SUPPRESSED", suppressionReason: blockerToSuppressionReason(readiness.blockers[0]) } : recipient,
                  scheduledFor: nowIso,
                  digestWindow: null,
                  matrixRuleSnapshot: {},
                  payloadSummary: { expertId: consultation.expertId, eventId: consultation.eventId, caseId: consultation.caseId, answerPreview: answer.answerText.slice(0, 300), confidence: answer.confidence },
                  content: { kind: "DIGEST", window: "", mediumItems: [], lowItems: [], closedItems: [] },
                },
              ],
              new Map(),
              new Map()
            );
          }
        } catch (error) {
          await store.audit(projectId, [{ action: "RISK_ALERT_EXPERT_FAILED", entityType: "RISK_ALERT_CASE", entityId: consultation.caseId, detail: `Consulta ao Expert ${consultation.expertId} falhou: ${sanitizeError(error)}` }]);
        }
      }
    }

    // ---- envio: entradas planejadas neste ciclo ----
    const ctx: SendContext = { store, provider, projectId, projectName: snapshot.projectName, baseUrl, timeZone, nowIso, inlineLogo, caseIds, snapshot, policyFor, deliveredKeys: new Set() };
    const sentKeys = new Set<string>();
    for (const item of persisted) {
      if (item.entry.recipient.status !== "PENDING") continue;
      sentKeys.add(item.entry.idempotencyKey);
      const outcome = await sendPlanned(item.id, item.caseId, item.entry, ctx);
      if (outcome === "SENT") projectResult.sent += 1;
      else if (outcome === "FAILED") projectResult.failed += 1;
      else projectResult.skipped += 1;
    }

    // ---- envio: pendentes de outras origens (manual, ação humana, Expert, retry) ----
    for (const row of await store.listPendingRows(projectId)) {
      if (sentKeys.has(row.idempotencyKey)) continue;
      const outcome = await sendPendingRow(row, ctx);
      if (outcome === "SENT") projectResult.sent += 1;
      else if (outcome === "FAILED") projectResult.failed += 1;
      else projectResult.skipped += 1;
    }

    result.projects.push(projectResult);
  }

  return result;
}

interface SendContext {
  store: RiskAlertStore;
  provider: EmailProvider;
  projectId: string;
  projectName: string;
  baseUrl: string;
  timeZone: string;
  nowIso: string;
  inlineLogo: ReturnType<typeof loadAccLogoInlineImage>;
  caseIds: Map<string, string>;
  snapshot: RiskAlertProjectSnapshot;
  policyFor: (area: SlaArea, riskLevel: SlaRiskLevel) => MatrixPolicy;
  /** Deduplicação por evento × endereço efetivo (override do piloto): nunca dois e-mails iguais no mesmo ciclo. */
  deliveredKeys: Set<string>;
}

/** Links das 5 ações (token curto/expirável, só hash persistido). */
async function issueActionLinks(ctx: SendContext, caseId: string, recipientUserId: string): Promise<Partial<Record<AlertActionType, string>>> {
  const links: Partial<Record<AlertActionType, string>> = {};
  const rows: Array<{ action: AlertActionType; tokenHash: string; expiresAt: string }> = [];
  for (const action of EMAIL_ACTION_TYPES) {
    const token = generateActionToken();
    links[action] = buildActionLink(ctx.baseUrl, ctx.projectId, caseId, action, token);
    rows.push({ action, tokenHash: hashActionToken(token), expiresAt: actionLinkExpiry(ctx.nowIso) });
  }
  await ctx.store.createActionLinks(ctx.projectId, caseId, recipientUserId, rows);
  return links;
}

async function deliver(ctx: SendContext, outboxId: string, caseId: string | null, recipientUserId: string, recipientEmail: string, built: BuiltEmail, notificationType: string, escalationLevel: string | null, idempotencyKey: string): Promise<"SENT" | "FAILED" | "SKIPPED"> {
  // Override de ENTREGA do piloto: só o To muda (nunca CC/BCC); o destinatário
  // lógico (recipientUserId/recipientEmail) permanece na outbox e na auditoria.
  const delivery = resolveDeliveryAddress({
    logicalEmail: recipientEmail,
    overrideEmail: ctx.snapshot.config?.pilotDeliveryOverrideEmail ?? null,
    eventKey: `${caseId ?? idempotencyKey}:${notificationType}:${escalationLevel ?? "-"}`,
  });
  if (delivery.overridden && ctx.deliveredKeys.has(delivery.dedupKey)) {
    await ctx.store.markSkipped(outboxId, `Deduplicado pelo override de entrega do piloto (mesmo evento já entregue em ${delivery.deliveryEmail} neste ciclo).`);
    return "SKIPPED";
  }
  try {
    const conversation = caseId ? await ctx.store.ensureConversation(ctx.projectId, caseId) : null;
    // Reply-To = caixa inbound OFICIAL (+alerta-<token>), só em mensagens
    // de conversa de alerta e com o contexto que o guard global exige;
    // fora disso (ex.: consolidado sem caso) não há Reply-To — a
    // correlação segue por In-Reply-To/References/código visível.
    const replyToken = generateReplyToken();
    const replyTo = conversation && ctx.snapshot.replyMailbox ? buildOpaqueReplyTo(ctx.snapshot.replyMailbox, replyToken) : undefined;
    const signed = appendAccEmailSignature({ text: built.text, html: built.html }, ctx.inlineLogo !== null);
    const sent = await ctx.provider.send({
      to: delivery.deliveryEmail,
      subject: built.subject,
      text: signed.text,
      html: signed.html,
      inlineImages: ctx.inlineLogo ? [ctx.inlineLogo] : undefined,
      replyTo,
      replyToContext: conversation && replyTo ? { kind: "RISK_ALERT_CONVERSATION", outboxId, conversationId: conversation.id } : undefined,
      inReplyTo: conversation?.rootMessageIdHeader ?? undefined,
      references: conversation?.rootMessageIdHeader ? [conversation.rootMessageIdHeader] : undefined,
      correlationId: crypto.randomUUID(),
    });
    const emailId = await ctx.store.recordEmail(ctx.projectId, { from: sent.from, to: delivery.deliveryEmail, subject: built.subject, sentAt: sent.sentAt, snippet: built.text });
    await ctx.store.markSent(outboxId, { recipientEmail: delivery.deliveryEmail, provider: sent.provider, providerMessageId: sent.providerMessageId, emailId, sentAt: sent.sentAt, messageIdHeader: sent.messageIdHeader, conversationId: conversation?.id ?? null });
    ctx.deliveredKeys.add(delivery.dedupKey);
    if (conversation) {
      if (!conversation.rootMessageIdHeader) await ctx.store.setConversationRoot(conversation.id, sent.messageIdHeader, sent.providerThreadId);
      await ctx.store.recordOutboundMessage({
        projectId: ctx.projectId,
        caseId,
        conversationId: conversation.id,
        outboxId,
        provider: sent.provider,
        providerMessageId: sent.providerMessageId,
        providerThreadId: sent.providerThreadId,
        messageIdHeader: sent.messageIdHeader,
        inReplyTo: conversation.rootMessageIdHeader,
        references: conversation.rootMessageIdHeader ? [conversation.rootMessageIdHeader] : [],
        replyTokenHash: replyTo ? hashReplyToken(replyToken) : null,
        recipients: [delivery.deliveryEmail],
        subject: built.subject,
        sentAt: sent.sentAt,
      });
    }
    await ctx.store.audit(ctx.projectId, [
      {
        action: "RISK_ALERT_EMAIL_SENT",
        entityType: caseId ? "RISK_ALERT_CASE" : "RISK_ALERT_DIGEST",
        entityId: caseId ?? idempotencyKey,
        detail: `E-mail ${notificationType}${escalationLevel ? ` (${escalationLevel})` : ""} enviado ao usuário ${recipientUserId} via ${sent.provider} (${sent.providerMessageId}). Chave ${idempotencyKey}.${delivery.overridden ? " Override de entrega do piloto: entregue na caixa institucional configurada (destinatário lógico preservado)." : ""}`,
      },
    ]);
    return "SENT";
  } catch (error) {
    const message = error instanceof EmailSendError ? error.message : sanitizeError(error);
    await ctx.store.markFailed(outboxId, sanitizeError(message));
    await ctx.store.audit(ctx.projectId, [{ action: "RISK_ALERT_EMAIL_FAILED", entityType: "RISK_ALERT_OUTBOX", entityId: outboxId, detail: `Falha de envio (${idempotencyKey}): ${sanitizeError(message)}` }]);
    return "FAILED";
  }
}

async function sendPlanned(outboxId: string, caseId: string | null, entry: PlannedOutboxEntry, ctx: SendContext): Promise<"SENT" | "FAILED" | "SKIPPED"> {
  const recipientEmail = entry.recipient.email;
  if (!recipientEmail) {
    await ctx.store.markFailed(outboxId, "Destinatário sem e-mail no momento do envio.");
    return "FAILED";
  }
  const record = caseId ? await ctx.store.loadCaseRecord(caseId) : null;
  let built: BuiltEmail;
  if (entry.content.kind === "DIGEST") {
    built = buildRiskDigestEmail({ content: entry.content, projectId: ctx.projectId, projectName: ctx.projectName, recipientName: entry.recipient.name, baseUrl: ctx.baseUrl, timeZone: ctx.timeZone, generatedAt: ctx.nowIso });
  } else {
    built = buildImmediateRiskAlertEmail({
      content: entry.content,
      projectId: ctx.projectId,
      projectName: ctx.projectName,
      recipientName: entry.recipient.name,
      baseUrl: ctx.baseUrl,
      timeZone: ctx.timeZone,
      generatedAt: ctx.nowIso,
      actionButtons: entry.slaActionId
        ? await issueEmailAlertActionButtons({ projectId: ctx.projectId, alertKind: "SLA_ACTION", alertId: entry.slaActionId, intendedRecipientEmail: recipientEmail }).catch(() => [])
        : [],
      actionLinks: caseId ? await issueActionLinks(ctx, caseId, entry.recipient.userId) : undefined,
      visibleCode: record?.visibleCode ?? null,
    });
  }
  const outcome = await deliver(ctx, outboxId, caseId, entry.recipient.userId, recipientEmail, built, entry.notificationType, entry.escalationLevel, entry.idempotencyKey);
  if (outcome === "SENT" && entry.content.kind === "DIGEST") {
    const caseKeys = (entry.payloadSummary.caseKeys as string[] | undefined) ?? [];
    await ctx.store.markDigestWindow(caseKeys.map((key) => ctx.caseIds.get(key)).filter((id): id is string => Boolean(id)), entry.content.window);
  }
  return outcome;
}

/** Entradas de outras origens (MANUAL, WEB_ACTION, EMAIL_REPLY, Expert, retry): conteúdo reconstruído do caso. */
async function sendPendingRow(row: PendingOutboxRow, ctx: SendContext): Promise<"SENT" | "FAILED" | "SKIPPED"> {
  const config = ctx.snapshot.config;
  if (!config) {
    await ctx.store.markSkipped(row.id, "Projeto sem configuração.");
    return "SKIPPED";
  }
  const record = row.caseId ? await ctx.store.loadCaseRecord(row.caseId) : null;
  if (!record) {
    // Delimitação da outbox: sem risk_alert_case nada é enviado por aqui
    // (ações SLA comuns permanecem no fluxo antigo).
    await ctx.store.markSkipped(row.id, "RISK_CASE_REQUIRED: entrada sem alerta de risco vinculado — fora da outbox de alertas (fluxo antigo permanece).");
    return "SKIPPED";
  }
  if (record.status === "CLOSED" && row.notificationType !== "ACTION_CONFIRMATION") {
    await ctx.store.markSkipped(row.id, "Caso encerrado antes do envio.");
    return "SKIPPED";
  }
  const recipient = evaluateRecipient(row.recipientUserId, config, ctx.snapshot.recipients);
  const forwardException = row.notificationType === "FORWARD" && Boolean(row.payloadSummary.pilotException);
  if (recipient.status === "SUPPRESSED" && !(forwardException && recipient.suppressionReason === "PILOT_RECIPIENT_SUPPRESSED")) {
    await ctx.store.markSkipped(row.id, `Destinatário não elegível no envio (${recipient.suppressionReason}).`);
    return "SKIPPED";
  }
  if (!recipient.email) {
    await ctx.store.markFailed(row.id, "Destinatário sem e-mail.");
    return "FAILED";
  }
  const riskLevel = (record.riskLevel === "REVIEW_REQUIRED" ? "MEDIUM" : record.riskLevel) as SlaRiskLevel;
  const policy = ctx.policyFor(record.area, riskLevel);
  const nameOf = (id: string | null) => (id ? (ctx.snapshot.recipients.get(id)?.name ?? null) : null);
  let built: BuiltEmail;
  if (row.notificationType === "ESCALATION") {
    const level = (row.escalationLevel ?? record.currentLevel) as SlaEscalationLevel;
    const content: ImmediateAlertContent = {
      kind: "ESCALATION",
      caseTitle: record.title,
      reference: record.reference,
      riskLevel,
      area: record.area,
      summary: record.summary,
      impact: record.impact,
      recommendation: record.recommendation,
      originPath: record.originPath || "documentos?tab=registro-email",
      slaActionId: record.slaActionId,
      levelLabel: slaEscalationLevelLabels[level],
      previousLevelLabel: row.payloadSummary.fromLevel ? slaEscalationLevelLabels[row.payloadSummary.fromLevel as SlaEscalationLevel] : null,
      responsibleName: nameOf(record.currentResponsibleUserId),
      deadlineLabel: "Escalonado em",
      deadlineAt: ctx.nowIso,
      requiresAcknowledgment: policy.requiresAcknowledgmentConfirmation,
      requiresJustification: policy.requiresDelayJustification,
      escalationReason: (row.payloadSummary.trigger as string | undefined) ? `Escalonamento imediato por ação ${row.payloadSummary.trigger}` : row.origin === "MANUAL" ? "Escalonamento manual (Processar escalonamentos)" : "Prazo da Matriz vencido",
      changed: false,
    };
    built = buildImmediateRiskAlertEmail({ content, projectId: ctx.projectId, projectName: ctx.projectName, recipientName: recipient.name, baseUrl: ctx.baseUrl, timeZone: ctx.timeZone, generatedAt: ctx.nowIso, actionButtons: [], actionLinks: await issueActionLinks(ctx, record.id, row.recipientUserId), visibleCode: record.visibleCode });
  } else {
    const kind = (["FORWARD", "RETURNED", "EXPERT_ANSWER", "ACTION_CONFIRMATION"] as const).find((k) => k === row.notificationType) ?? "ACTION_CONFIRMATION";
    const rows: Array<[string, string | null]> = [];
    const paragraphs: string[] = [];
    if (kind === "FORWARD") {
      rows.push(["Encaminhado por", nameOf((row.payloadSummary.forwardedBy as string) ?? null)], ["Instrução", (row.payloadSummary.instruction as string) || null], ["Prazo para assumir", formatDateTimeBR((row.payloadSummary.assumeDueAt as string) ?? null, ctx.timeZone)], ["Responsável anterior", nameOf(record.previousResponsibleUserId)], ["Responsável atual", nameOf(record.currentResponsibleUserId)]);
      if (row.payloadSummary.pilotException) rows.push(["Piloto", "Você recebe apenas este alerta (exceção manual registrada)."]);
    } else if (kind === "RETURNED") {
      rows.push(["Motivo", "Encaminhado sem ação até o prazo para assumir"], ["Encaminhado para", nameOf((row.payloadSummary.forwardedTo as string) ?? null)], ["Prazo expirado em", formatDateTimeBR((row.payloadSummary.timeoutAt as string) ?? null, ctx.timeZone)], ["Responsável atual", nameOf(record.currentResponsibleUserId)]);
    } else if (kind === "EXPERT_ANSWER") {
      rows.push(["Expert", (row.payloadSummary.expertId as string) ?? null], ["Confiança", row.payloadSummary.confidence !== undefined ? String(row.payloadSummary.confidence) : null]);
      paragraphs.push((row.payloadSummary.answerPreview as string) ?? "");
    }
    built = buildAlertFollowUpEmail({ kind, projectId: ctx.projectId, projectName: ctx.projectName, recipientName: recipient.name, baseUrl: ctx.baseUrl, timeZone: ctx.timeZone, generatedAt: ctx.nowIso, caseId: record.id, caseTitle: record.title, riskLevel, visibleCode: record.visibleCode, rows, paragraphs, requiresHumanReview: kind === "EXPERT_ANSWER", actionLinks: kind === "FORWARD" ? await issueActionLinks(ctx, record.id, row.recipientUserId) : undefined });
  }
  const outcome = await deliver(ctx, row.id, record.id, row.recipientUserId, recipient.email, built, row.notificationType, row.escalationLevel, row.idempotencyKey);
  return outcome;
}
