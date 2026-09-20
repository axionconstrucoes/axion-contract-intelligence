// Planejador dos alertas de risco — puro, determinístico, sem I/O.
// Recebe o estado carregado (casos, ações SLA vinculadas, Matriz,
// destinatários, chaves já existentes na outbox) e devolve o plano:
// casos a gravar, ações SLA a criar, escalonamentos a aplicar, entradas
// da outbox (PENDING ou SUPPRESSED com motivo) e eventos de auditoria.
// Nada aqui envia e-mail; quem envia é run-risk-alert-cycle.ts, sempre
// a partir de uma entrada PENDING da outbox.
//
// Regras (docs/weekly-schedule-email-ingestion.md §9):
//   - LOW/MEDIUM nunca geram e-mail individual: só o consolidado semanal
//     (quarta-feira 07:00 no timezone do projeto), por destinatário.
//   - HIGH/CRITICAL: imediato ao surgir ou ao subir/alterar; escalonamento
//     Nível 1 -> 2 -> 3 pelos prazos da Matriz via computeEscalation
//     (motor existente), destino via resolveEscalationDestination.
//   - Allowlist do piloto por user_id: fora dela => PILOT_RECIPIENT_SUPPRESSED.
//   - Sem Matriz suficiente => CONFIGURATION_REVIEW_REQUIRED, sem envio.
//   - Idempotência: chave por evento × estado × nível × destinatário × janela.

import { slaEscalationLevelLabels } from "@/lib/labels";
import { computeEscalation } from "@/lib/sla/compute-escalation";
import { resolveEscalationDestination } from "@/lib/sla/resolve-escalation-destination";
import { computePolicyDeadlines, matrixPolicySnapshot, type MatrixPolicy } from "@/lib/sla/resolve-matrix-policy";
import type { SlaArea, SlaAreaResponsibles, SlaRiskLevel } from "@/lib/sla/types";

import { caseKeyOf } from "./collect-risk-cases";
import { resolveDigestWindow } from "./digest-window";
import type {
  DigestItem,
  LinkedSlaActionState,
  PlannedCaseUpsert,
  PlannedOutboxEntry,
  PlannedRecipient,
  RecipientProfile,
  RiskAlertPlan,
  RiskAlertProjectConfig,
  RiskCaseInput,
  RiskCaseLevel,
  RiskCaseRecord,
  RiskSuppressionReason,
} from "./types";
import { DEFAULT_PROJECT_TIMEZONE } from "./types";

export const DEFAULT_CORPORATE_EMAIL_DOMAIN = "axion.com.br";

const LEVEL_RANK: Record<RiskCaseLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3, REVIEW_REQUIRED: -1 };
const IMMEDIATE_LEVELS: ReadonlySet<RiskCaseLevel> = new Set(["HIGH", "CRITICAL"]);
const DIGEST_LEVELS: ReadonlySet<RiskCaseLevel> = new Set(["LOW", "MEDIUM"]);

export interface PlanRiskAlertsInput {
  now: string;
  projectId: string;
  projectName: string;
  featureEnabled: boolean;
  providerConfigured: boolean;
  dryRun: boolean;
  config: RiskAlertProjectConfig | null;
  timeZone?: string | null;
  cases: RiskCaseInput[];
  existingCases: RiskCaseRecord[];
  linkedActions: Map<string, LinkedSlaActionState>;
  policyFor: (area: SlaArea, riskLevel: SlaRiskLevel) => MatrixPolicy;
  recipients: Map<string, RecipientProfile>;
  existingIdempotencyKeys: Set<string>;
  previousDigestSentAt: string | null;
  /**
   * Bloqueios de prontidão para envio REAL (pilot-readiness.ts). Quando
   * presentes (e não é dry-run), as entradas ficam SUPPRESSED com o primeiro
   * motivo — o plano continua sendo calculado e auditado.
   */
  readinessBlockers?: RiskSuppressionReason[];
}

function emptyPlan(blockedReason: RiskSuppressionReason | null): RiskAlertPlan {
  return { blockedReason, caseUpserts: [], slaActionCreates: [], escalations: [], outbox: [], audit: [], digestWindow: null };
}

function isSlaRisk(level: RiskCaseLevel): level is SlaRiskLevel {
  return level !== "REVIEW_REQUIRED";
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/** Decisão por destinatário — allowlist do piloto, membership ACTIVE, e-mail corporativo. */
export function evaluateRecipient(
  userId: string,
  config: RiskAlertProjectConfig,
  recipients: Map<string, RecipientProfile>
): PlannedRecipient {
  const profile = recipients.get(userId) ?? null;
  const base = { userId, email: profile?.email ?? null, name: profile?.name ?? null };
  const allowlist = config.pilotRecipientAllowlistUserIds ?? [];
  if (allowlist.length === 0) return { ...base, status: "SUPPRESSED", suppressionReason: "PILOT_ALLOWLIST_MISSING" };
  if (!allowlist.includes(userId)) return { ...base, status: "SUPPRESSED", suppressionReason: "PILOT_RECIPIENT_SUPPRESSED" };
  if (!profile || profile.membershipStatus !== "ACTIVE") return { ...base, status: "SUPPRESSED", suppressionReason: "USER_NOT_ACTIVE" };
  if (!profile.email || !profile.email.includes("@")) return { ...base, status: "SUPPRESSED", suppressionReason: "EMAIL_MISSING" };
  const corporateDomain = (config.senderDomain ?? DEFAULT_CORPORATE_EMAIL_DOMAIN).toLowerCase().replace(/^@/, "");
  if (emailDomain(profile.email) !== corporateDomain) return { ...base, status: "SUPPRESSED", suppressionReason: "EMAIL_NOT_CORPORATE" };
  return { ...base, status: "PENDING", suppressionReason: null };
}

function responsiblesLike(policy: MatrixPolicy): SlaAreaResponsibles {
  return {
    id: "",
    projectId: "",
    area: policy.area,
    responsibleDirectUserId: policy.level1UserId,
    responsibleDirectInvitationId: null,
    responsibleDirectName: null,
    secondaryResponsibleUserId: policy.level1SecondaryUserId,
    secondaryResponsibleInvitationId: null,
    secondaryResponsibleName: null,
    escalation1UserId: policy.level2UserId,
    escalation1InvitationId: null,
    escalation1Name: null,
    escalation2UserId: null,
    escalation2Name: null,
    boardUserId: policy.level3UserId,
    boardInvitationId: null,
    boardName: null,
    updatedAt: "",
  };
}

function levelOneRecipients(policy: MatrixPolicy): string[] {
  return [policy.level1UserId, policy.level1SecondaryUserId].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
}

function detectChange(existing: RiskCaseRecord | null, input: RiskCaseInput): PlannedCaseUpsert["change"] | null {
  if (!existing) return input.closed ? null : "NEW";
  if (existing.status === "CLOSED" && input.closed) return "UNCHANGED";
  if (existing.status === "OPEN" && input.closed) return "CLOSED";
  if (existing.status === "CLOSED" && !input.closed) return "REOPENED";
  if (existing.fingerprint === input.fingerprint && existing.riskLevel === input.riskLevel) return "UNCHANGED";
  const before = LEVEL_RANK[existing.riskLevel];
  const after = LEVEL_RANK[input.riskLevel];
  if (after > before) return "RAISED";
  if (after < before) return "LOWERED";
  return "CHANGED";
}

export function planRiskAlerts(input: PlanRiskAlertsInput): RiskAlertPlan {
  if (!input.featureEnabled) return emptyPlan("FEATURE_DISABLED");
  if (!input.config || !input.config.enabled || !input.config.riskAlertsEnabled) return emptyPlan("PROJECT_DISABLED");
  if (!input.providerConfigured && !input.dryRun) return emptyPlan("PROVIDER_NOT_CONFIGURED");

  const config = input.config;
  const timeZone = input.timeZone || DEFAULT_PROJECT_TIMEZONE;
  const plan: RiskAlertPlan = { ...emptyPlan(null), digestWindow: null };
  const window = resolveDigestWindow(input.now, timeZone);
  plan.digestWindow = { key: window.key, isOpen: window.isOpen };

  const existingByKey = new Map(input.existingCases.map((c) => [caseKeyOf(c), c]));
  const digestCandidates: Array<{ item: DigestItem; recipients: string[] }> = [];

  const readinessBlocker = !input.dryRun && input.readinessBlockers && input.readinessBlockers.length > 0 ? input.readinessBlockers[0] : null;
  const pushEntry = (entry: PlannedOutboxEntry) => {
    if (input.existingIdempotencyKeys.has(entry.idempotencyKey)) return;
    if (plan.outbox.some((e) => e.idempotencyKey === entry.idempotencyKey)) return;
    if (readinessBlocker && entry.recipient.status === "PENDING") {
      entry = { ...entry, recipient: { ...entry.recipient, status: "SUPPRESSED", suppressionReason: readinessBlocker } };
    }
    plan.outbox.push(entry);
  };

  for (const caseInput of input.cases) {
    const caseKey = caseKeyOf(caseInput);
    const existing = existingByKey.get(caseKey) ?? null;
    const change = detectChange(existing, caseInput);
    if (change === null) continue;

    const policy = isSlaRisk(caseInput.riskLevel) ? input.policyFor(caseInput.area, caseInput.riskLevel) : null;
    plan.caseUpserts.push({ caseKey, existingId: existing?.id ?? null, input: caseInput, change, policy, lastDigestWindow: existing?.lastDigestWindow ?? null });

    if (policy && policy.status === "CONFIGURATION_REVIEW_REQUIRED" && change !== "UNCHANGED") {
      plan.audit.push({
        action: "RISK_ALERT_CONFIGURATION_REVIEW_REQUIRED",
        entityType: "RISK_ALERT_CASE",
        entityId: existing?.id ?? caseKey,
        detail: `Matriz insuficiente para ${caseInput.area}/${caseInput.riskLevel}: ${policy.missing.join(", ")}. Nenhum e-mail enviado.`,
      });
    }

    // ---------------- HIGH / CRITICAL: imediato + ação SLA ----------------
    const alertNow = !caseInput.closed && IMMEDIATE_LEVELS.has(caseInput.riskLevel) && ["NEW", "REOPENED", "RAISED", "CHANGED"].includes(change);
    if (alertNow && policy && isSlaRisk(caseInput.riskLevel)) {
      const deadlines = computePolicyDeadlines(policy, input.now);
      const slaActionId = existing?.slaActionId ?? null;
      if (!slaActionId && policy.status === "OK") {
        plan.slaActionCreates.push({
          caseKey,
          title: caseInput.title,
          description: [caseInput.summary, caseInput.impact, caseInput.recommendation].filter(Boolean).join("\n"),
          area: caseInput.area,
          riskLevel: caseInput.riskLevel,
          responsibleUserId: policy.level1UserId ?? policy.level1SecondaryUserId,
          assumeDueAt: deadlines.assumeDueAt,
          respondDueAt: deadlines.respondDueAt,
          completeDueAt: deadlines.completeDueAt,
        });
      }

      if (policy.status === "OK") {
        const linked = slaActionId ? input.linkedActions.get(slaActionId) : undefined;
        const assumeDueAt = linked?.assumeDueAt ?? deadlines.assumeDueAt;
        const recipients = levelOneRecipients(policy);
        for (const userId of recipients) {
          const recipient = policy.notifyByEmail
            ? evaluateRecipient(userId, config, input.recipients)
            : { userId, email: null, name: input.recipients.get(userId)?.name ?? null, status: "SUPPRESSED" as const, suppressionReason: "NOTIFY_BY_EMAIL_DISABLED" as const };
          pushEntry({
            idempotencyKey: `${caseKey}:IMMEDIATE:${caseInput.fingerprint}:${userId}`,
            notificationType: "IMMEDIATE",
            escalationLevel: "RESPONSAVEL",
            riskLevel: caseInput.riskLevel,
            caseKey,
            slaActionId,
            recipient,
            scheduledFor: input.now,
            digestWindow: null,
            matrixRuleSnapshot: matrixPolicySnapshot(policy),
            payloadSummary: { title: caseInput.title, reference: caseInput.reference, change, assumeDueAt, area: caseInput.area },
            content: {
              kind: "IMMEDIATE",
              caseTitle: caseInput.title,
              reference: caseInput.reference,
              riskLevel: caseInput.riskLevel,
              area: caseInput.area,
              summary: caseInput.summary,
              impact: caseInput.impact,
              recommendation: caseInput.recommendation,
              originPath: caseInput.originPath,
              slaActionId,
              levelLabel: slaEscalationLevelLabels.RESPONSAVEL,
              previousLevelLabel: null,
              responsibleName: input.recipients.get(policy.level1UserId ?? "")?.name ?? null,
              deadlineLabel: "Prazo para assumir",
              deadlineAt: assumeDueAt,
              requiresAcknowledgment: policy.requiresAcknowledgmentConfirmation,
              requiresJustification: policy.requiresDelayJustification,
              escalationReason: null,
              changed: change !== "NEW" && change !== "REOPENED",
            },
          });
        }
      }
    }

    // ---------------- Escalonamento pelos prazos da Matriz ----------------
    const linkedId = existing?.slaActionId ?? null;
    const linked = linkedId ? input.linkedActions.get(linkedId) : undefined;
    if (linked && policy && !caseInput.closed && IMMEDIATE_LEVELS.has(caseInput.riskLevel) && isSlaRisk(caseInput.riskLevel)) {
      const result = computeEscalation({
        status: linked.status,
        currentEscalationLevel: linked.currentEscalationLevel,
        assumeDueAt: linked.assumeDueAt,
        respondDueAt: linked.respondDueAt,
        completeDueAt: linked.completeDueAt,
        acknowledgedAt: linked.acknowledgedAt,
        completedAt: linked.completedAt,
        contractualDeadline: linked.contractualDeadline,
        now: input.now,
        rule: policy.rule,
        businessHoursConfig: policy.businessHours,
      });
      if (result.shouldEscalate && result.reason) {
        const destination = resolveEscalationDestination(result.recommendedLevel, responsiblesLike(policy));
        plan.escalations.push({
          slaActionId: linked.id,
          caseKey,
          expectedCurrentLevel: linked.currentEscalationLevel,
          newLevel: destination.level,
          reason: result.reason,
          reasons: result.reasons,
        });
        plan.audit.push({
          action: "RISK_ALERT_DEADLINE_EXPIRED",
          entityType: "SLA_ACTION",
          entityId: linked.id,
          detail: `${result.reasons.join(" ")} Nível ${slaEscalationLevelLabels[linked.currentEscalationLevel]} → ${slaEscalationLevelLabels[destination.level]}.`,
        });
        if (destination.userId) {
          const recipient = policy.notifyByEmail
            ? evaluateRecipient(destination.userId, config, input.recipients)
            : { userId: destination.userId, email: null, name: null, status: "SUPPRESSED" as const, suppressionReason: "NOTIFY_BY_EMAIL_DISABLED" as const };
          pushEntry({
            idempotencyKey: `${caseKey}:ESCALATION:${destination.level}:${destination.userId}`,
            notificationType: "ESCALATION",
            escalationLevel: destination.level,
            riskLevel: caseInput.riskLevel,
            caseKey,
            slaActionId: linked.id,
            recipient,
            scheduledFor: input.now,
            digestWindow: null,
            matrixRuleSnapshot: matrixPolicySnapshot(policy),
            payloadSummary: { title: caseInput.title, reference: caseInput.reference, fromLevel: linked.currentEscalationLevel, toLevel: destination.level, reason: result.reason },
            content: {
              kind: "ESCALATION",
              caseTitle: caseInput.title,
              reference: caseInput.reference,
              riskLevel: caseInput.riskLevel,
              area: caseInput.area,
              summary: caseInput.summary,
              impact: caseInput.impact,
              recommendation: caseInput.recommendation,
              originPath: caseInput.originPath,
              slaActionId: linked.id,
              levelLabel: slaEscalationLevelLabels[destination.level],
              previousLevelLabel: slaEscalationLevelLabels[linked.currentEscalationLevel],
              responsibleName: input.recipients.get(linked.responsibleUserId ?? "")?.name ?? null,
              deadlineLabel: "Prazo vencido",
              deadlineAt: linked.acknowledgedAt ? (linked.completeDueAt ?? linked.respondDueAt) : linked.assumeDueAt,
              requiresAcknowledgment: policy.requiresAcknowledgmentConfirmation,
              requiresJustification: policy.requiresDelayJustification,
              escalationReason: result.reason,
              changed: false,
            },
          });
        } else {
          plan.audit.push({
            action: "RISK_ALERT_CONFIGURATION_REVIEW_REQUIRED",
            entityType: "SLA_ACTION",
            entityId: linked.id,
            detail: `Escalonamento para ${slaEscalationLevelLabels[destination.level]} sem usuário configurado na Matriz (${caseInput.area}). Nenhum e-mail enviado.`,
          });
        }
      }
    }

    // ---------------- LOW / MEDIUM: candidatos ao consolidado ----------------
    const digestLevel = DIGEST_LEVELS.has(caseInput.riskLevel) ? (caseInput.riskLevel as "LOW" | "MEDIUM") : null;
    if (digestLevel && policy) {
      const closedSinceLastDigest =
        change === "CLOSED" || (existing?.status === "CLOSED" && existing.closedAt !== null && (!input.previousDigestSentAt || existing.closedAt > input.previousDigestSentAt));
      const state: DigestItem["state"] | null = caseInput.closed
        ? closedSinceLastDigest
          ? "CLOSED"
          : null
        : change === "NEW" || change === "REOPENED"
          ? "NEW"
          : change === "UNCHANGED"
            ? "OPEN"
            : "CHANGED";
      if (state) {
        const deadlines = computePolicyDeadlines(policy, existing?.firstSeenAt ?? input.now);
        digestCandidates.push({
          item: {
            caseKey,
            riskLevel: digestLevel,
            area: caseInput.area,
            title: caseInput.title,
            reference: caseInput.reference,
            summary: caseInput.summary,
            deadlineAt: deadlines.assumeDueAt,
            responsibleName: input.recipients.get(policy.level1UserId ?? "")?.name ?? null,
            originPath: caseInput.originPath,
            slaActionId: existing?.slaActionId ?? null,
            state,
          },
          recipients: policy.status === "OK" && policy.notifyByEmail ? levelOneRecipients(policy) : [],
        });
      }
    }
  }

  // ---------------- Consolidado semanal (quarta 07:00 local) ----------------
  if (window.isOpen && digestCandidates.length > 0) {
    const byRecipient = new Map<string, DigestItem[]>();
    for (const candidate of digestCandidates) {
      for (const userId of candidate.recipients) {
        byRecipient.set(userId, [...(byRecipient.get(userId) ?? []), candidate.item]);
      }
    }
    const order = (a: DigestItem, b: DigestItem) =>
      (a.riskLevel === "MEDIUM" ? 0 : 1) - (b.riskLevel === "MEDIUM" ? 0 : 1) ||
      (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999") ||
      a.title.localeCompare(b.title, "pt-BR");
    for (const [userId, items] of byRecipient) {
      const open = items.filter((i) => i.state !== "CLOSED").sort(order);
      const mediumItems = open.filter((i) => i.riskLevel === "MEDIUM");
      const lowItems = open.filter((i) => i.riskLevel === "LOW");
      const closedItems = items.filter((i) => i.state === "CLOSED").sort(order);
      if (mediumItems.length + lowItems.length + closedItems.length === 0) continue;
      const recipient = evaluateRecipient(userId, config, input.recipients);
      pushEntry({
        idempotencyKey: `${input.projectId}:DIGEST:${window.key}:${userId}`,
        notificationType: "DIGEST",
        escalationLevel: null,
        riskLevel: "DIGEST",
        caseKey: null,
        slaActionId: null,
        recipient,
        scheduledFor: input.now,
        digestWindow: window.key,
        matrixRuleSnapshot: { timeZone, weekday: "WEDNESDAY", hourLocal: 7 },
        payloadSummary: { window: window.key, medium: mediumItems.length, low: lowItems.length, closed: closedItems.length, caseKeys: items.map((i) => i.caseKey) },
        content: { kind: "DIGEST", window: window.key, mediumItems, lowItems, closedItems },
      });
    }
  }

  for (const entry of plan.outbox) {
    if (entry.recipient.status === "SUPPRESSED") {
      plan.audit.push({
        action: "RISK_ALERT_RECIPIENT_SUPPRESSED",
        entityType: entry.notificationType === "DIGEST" ? "RISK_ALERT_DIGEST" : "RISK_ALERT_CASE",
        entityId: entry.caseKey ?? entry.digestWindow ?? entry.idempotencyKey,
        detail: `Destinatário ${entry.recipient.userId} suprimido (${entry.recipient.suppressionReason}) para ${entry.notificationType}${entry.escalationLevel ? ` ${entry.escalationLevel}` : ""}.`,
      });
    }
  }

  return plan;
}

export function describeSuppression(reason: RiskSuppressionReason): string {
  const labels: Record<RiskSuppressionReason, string> = {
    PILOT_RECIPIENT_SUPPRESSED: "Fora da allowlist do piloto",
    PILOT_ALLOWLIST_MISSING: "Allowlist do piloto não configurada",
    USER_NOT_ACTIVE: "Usuário sem membership ACTIVE",
    EMAIL_MISSING: "E-mail não cadastrado",
    EMAIL_NOT_CORPORATE: "E-mail fora do domínio corporativo",
    MATRIX_AMBIGUOUS: "Matriz ambígua",
    CONFIGURATION_REVIEW_REQUIRED: "Matriz incompleta — revisão de configuração",
    NOTIFY_BY_EMAIL_DISABLED: "E-mail desabilitado na Matriz para este risco",
    FEATURE_DISABLED: "Feature desligada (ACC_WEEKLY_REPORTS_ENABLED)",
    PROJECT_DISABLED: "Alertas desabilitados no projeto",
    PROVIDER_NOT_CONFIGURED: "Provider de e-mail não configurado",
    DRY_RUN: "Simulação (dry-run) — nada enviado",
    PILOT_PROJECT_NOT_CONFIRMED: "Projeto piloto real não confirmado por humano",
    MATRIX_RULES_NOT_EXPLICIT: "Regras da Matriz não salvas explicitamente (defaults não bastam)",
    SEVERITY_MAP_NOT_CONFIGURED: "Severidade dos alertas de ausência não configurada",
    REPLY_MAILBOX_NOT_CONFIGURED: "Caixa inbound oficial (Reply-To) não configurada — resposta por e-mail indisponível",
    RISK_CASE_REQUIRED: "Entrada sem alerta de risco vinculado — fora da outbox de alertas",
    TOP_LEVEL_REACHED: "Nível máximo já atingido — sem novo e-mail",
  };
  return labels[reason];
}
