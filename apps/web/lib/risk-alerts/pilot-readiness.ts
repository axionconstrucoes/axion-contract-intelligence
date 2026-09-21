// Prontidão para ENVIO REAL — puro. Todas as condições precisam valer;
// qualquer bloqueio => nenhum e-mail real (as entradas da outbox ficam
// SUPPRESSED com o motivo). Em simulação (dry-run) o plano é calculado
// normalmente, e `usingDefaultRule` só aparece como informação.
//
// Condições: feature ligada; projeto enabled + risk_alerts_enabled;
// provider configurado; regras EXPLÍCITAS da Matriz salvas para LOW,
// MEDIUM, HIGH e CRITICAL (defaults institucionais NÃO bastam no piloto
// real); Matriz sem CONFIGURATION_REVIEW_REQUIRED nas áreas em uso;
// allowlist válida; projeto piloto confirmado por humano; Google
// Workspace (mailbox remetente) configurado; severidade dos alertas de
// ausência configurada por projeto; caixa inbound OFICIAL configurada
// (GOOGLE_GMAIL_INBOUND_MAILBOX) — a resposta pelo corpo do e-mail é
// requisito obrigatório, então sem Reply-To válido não há envio real.

import type { SlaRiskLevel } from "@/lib/sla/types";

import type { IngestionAlertSeverityMap, PilotReadinessBlocker, PilotReadinessInput, RiskSuppressionReason } from "./types";

export const REQUIRED_EXPLICIT_RULE_LEVELS: SlaRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// Dois grupos formalmente separados:
//   A. ALERTAS DE AUSÊNCIA (weekly_schedule_ingestion_alerts) — não têm
//      classificação própria; a severidade vem EXCLUSIVAMENTE do mapa do
//      projeto (risk_alert_severity_map). Só os tipos efetivamente
//      produzidos por create-absence-alerts.ts entram aqui.
//   B. CLASSIFICADOS PELO MOTOR — comparações de cronograma e abas do
//      relatório (dimensões S_CURVE_MPP_DIVERGENCE_PP,
//      BASELINE_SHEET_DIVERGENCE_DAYS etc.): a severidade vem do motor
//      (thresholds) e o mapa NUNCA a altera (nem rebaixa, nem eleva).
//      Esses nomes ainda existem no CHECK de `kind` do banco, mas nenhum
//      produtor cria alerta de ausência com eles — são reservados e não
//      podem constar do mapa.
export const ABSENCE_ALERT_KINDS = ["MISSING_WEEKLY_SCHEDULE", "MISSING_WEEKLY_REPORT_WORKBOOK", "MISSING_S_CURVE"] as const;
export const ENGINE_CLASSIFIED_KINDS = ["S_CURVE_MPP_DIVERGENCE", "BASELINE_SHEET_DIVERGENCE"] as const;
export type AbsenceAlertKind = (typeof ABSENCE_ALERT_KINDS)[number];
/** @deprecated compatibilidade — o readiness exige apenas ABSENCE_ALERT_KINDS. */
export const INGESTION_ALERT_KINDS = ABSENCE_ALERT_KINDS;

const VALID_LEVELS: readonly string[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Sugestão (NÃO ativa): só vira regra quando gravada em risk_alert_severity_map. */
export const SUGGESTED_INGESTION_ALERT_SEVERITY: Record<AbsenceAlertKind, SlaRiskLevel> = {
  MISSING_WEEKLY_SCHEDULE: "HIGH",
  MISSING_WEEKLY_REPORT_WORKBOOK: "HIGH",
  MISSING_S_CURVE: "MEDIUM",
};

export type SeverityMapProblem =
  | { kind: string; problem: "MISSING" }
  | { kind: string; problem: "INVALID_LEVEL" }
  | { kind: string; problem: "ENGINE_CLASSIFIED_NOT_ALLOWED" }
  | { kind: string; problem: "UNKNOWN_KIND" };

/** Valida o mapa: todos os tipos de ausência produzidos, níveis válidos, nenhuma entrada para tipos do motor ou desconhecidos. */
export function validateSeverityMap(map: IngestionAlertSeverityMap | null): SeverityMapProblem[] {
  const problems: SeverityMapProblem[] = [];
  if (!map) return ABSENCE_ALERT_KINDS.map((kind) => ({ kind, problem: "MISSING" as const }));
  for (const kind of ABSENCE_ALERT_KINDS) {
    const level = map[kind];
    if (level === undefined || level === null) problems.push({ kind, problem: "MISSING" });
    else if (!VALID_LEVELS.includes(level)) problems.push({ kind, problem: "INVALID_LEVEL" });
  }
  for (const kind of Object.keys(map)) {
    if ((ENGINE_CLASSIFIED_KINDS as readonly string[]).includes(kind)) problems.push({ kind, problem: "ENGINE_CLASSIFIED_NOT_ALLOWED" });
    else if (!(ABSENCE_ALERT_KINDS as readonly string[]).includes(kind)) problems.push({ kind, problem: "UNKNOWN_KIND" });
  }
  return problems;
}

export function isSeverityMapComplete(map: IngestionAlertSeverityMap | null): boolean {
  return validateSeverityMap(map).length === 0;
}

export function evaluatePilotReadiness(input: PilotReadinessInput): { ready: boolean; blockers: PilotReadinessBlocker[] } {
  const blockers: PilotReadinessBlocker[] = [];
  if (!input.featureEnabled) blockers.push("FEATURE_DISABLED");
  if (!input.config || !input.config.enabled || !input.config.riskAlertsEnabled) blockers.push("PROJECT_DISABLED");
  if (!input.providerConfigured) blockers.push("PROVIDER_NOT_CONFIGURED");
  if (REQUIRED_EXPLICIT_RULE_LEVELS.some((level) => !input.explicitRuleLevels.includes(level))) blockers.push("MATRIX_RULES_NOT_EXPLICIT");
  if (input.matrixStatuses.some((m) => m.status !== "OK")) blockers.push("CONFIGURATION_REVIEW_REQUIRED");
  if (!input.allowlistValid) blockers.push("PILOT_ALLOWLIST_MISSING");
  if (!input.projectConfirmed) blockers.push("PILOT_PROJECT_NOT_CONFIRMED");
  if (!input.workspaceConfigured) blockers.push("WORKSPACE_NOT_CONFIGURED");
  if (!input.severityMapConfigured) blockers.push("SEVERITY_MAP_NOT_CONFIGURED");
  if (!input.replyMailboxConfigured) blockers.push("REPLY_MAILBOX_NOT_CONFIGURED");
  // Override de entrega do piloto: as respostas precisam voltar à MESMA caixa
  // que recebe os alertas — o override só é válido quando é a caixa inbound oficial.
  if (input.deliveryOverrideEmail && input.replyMailbox && input.deliveryOverrideEmail !== input.replyMailbox) blockers.push("DELIVERY_OVERRIDE_REPLY_MAILBOX_MISMATCH");
  return { ready: blockers.length === 0, blockers };
}

/** Bloqueio de prontidão => motivo de supressão na outbox (o primeiro bloqueio manda). */
export function blockerToSuppressionReason(blocker: PilotReadinessBlocker): RiskSuppressionReason {
  switch (blocker) {
    case "WORKSPACE_NOT_CONFIGURED":
      return "PROVIDER_NOT_CONFIGURED";
    case "DELIVERY_OVERRIDE_REPLY_MAILBOX_MISMATCH":
      return "REPLY_MAILBOX_NOT_CONFIGURED";
    default:
      return blocker;
  }
}

export const PILOT_READINESS_LABELS: Record<PilotReadinessBlocker, string> = {
  FEATURE_DISABLED: "Feature ACC_WEEKLY_REPORTS_ENABLED desligada",
  PROJECT_DISABLED: "Alertas desabilitados no projeto (enabled / risk_alerts_enabled)",
  PROVIDER_NOT_CONFIGURED: "Provider de e-mail real não configurado (AXION_EMAIL_PROVIDER=gmail)",
  MATRIX_RULES_NOT_EXPLICIT: "Regras da Matriz não salvas explicitamente para BAIXO, MÉDIO, ALTO e CRÍTICO (defaults não bastam)",
  CONFIGURATION_REVIEW_REQUIRED: "Matriz incompleta (Nível 1/Nível 3 ausentes ou legado ambíguo)",
  PILOT_ALLOWLIST_MISSING: "Allowlist do piloto (por usuário) não configurada/válida",
  PILOT_PROJECT_NOT_CONFIRMED: "Projeto piloto real não confirmado por humano",
  WORKSPACE_NOT_CONFIGURED: "Google Workspace (mailbox remetente) não configurado",
  SEVERITY_MAP_NOT_CONFIGURED: "Severidade dos alertas de ausência não configurada para o projeto",
  REPLY_MAILBOX_NOT_CONFIGURED: "Caixa inbound oficial do ACC (GOOGLE_GMAIL_INBOUND_MAILBOX) não configurada no worker — sem Reply-To/resposta por e-mail",
  DELIVERY_OVERRIDE_REPLY_MAILBOX_MISMATCH: "Override de entrega do piloto diferente da caixa inbound oficial — respostas não voltariam à caixa que recebe os alertas",
};
