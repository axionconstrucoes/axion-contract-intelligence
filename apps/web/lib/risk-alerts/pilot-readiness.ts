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

export const INGESTION_ALERT_KINDS = [
  "MISSING_WEEKLY_SCHEDULE",
  "MISSING_WEEKLY_REPORT_WORKBOOK",
  "MISSING_S_CURVE",
  "S_CURVE_MPP_DIVERGENCE",
  "BASELINE_SHEET_DIVERGENCE",
] as const;

/** Sugestão (NÃO ativa): só vira regra quando gravada em risk_alert_severity_map. */
export const SUGGESTED_INGESTION_ALERT_SEVERITY: Required<IngestionAlertSeverityMap> = {
  MISSING_WEEKLY_SCHEDULE: "HIGH",
  MISSING_WEEKLY_REPORT_WORKBOOK: "HIGH",
  MISSING_S_CURVE: "MEDIUM",
  S_CURVE_MPP_DIVERGENCE: "MEDIUM",
  BASELINE_SHEET_DIVERGENCE: "MEDIUM",
};

export function isSeverityMapComplete(map: IngestionAlertSeverityMap | null): boolean {
  if (!map) return false;
  return INGESTION_ALERT_KINDS.every((kind) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(map[kind] ?? ""));
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
  return { ready: blockers.length === 0, blockers };
}

/** Bloqueio de prontidão => motivo de supressão na outbox (o primeiro bloqueio manda). */
export function blockerToSuppressionReason(blocker: PilotReadinessBlocker): RiskSuppressionReason {
  switch (blocker) {
    case "WORKSPACE_NOT_CONFIGURED":
      return "PROVIDER_NOT_CONFIGURED";
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
};
