// Helper CENTRAL de política por (projeto, área, risco) — a Matriz de
// responsabilidades e prazos é a ÚNICA fonte. Puro, sem I/O: recebe as
// linhas já carregadas (sla_matrix_rules, sla_area_responsibles,
// sla_project_settings) e devolve, sem inventar nada:
//   - unidade e prazos para assumir / responder / concluir;
//   - intervalos de escalonamento (Nível 2 e Nível 3);
//   - usuários de Nível 1 (responsável + corresponsável), Nível 2 e Nível 3;
//   - e-mail habilitado, confirmação obrigatória, justificativa obrigatória;
//   - timezone/expediente do projeto.
// Sem configuração suficiente => CONFIGURATION_REVIEW_REQUIRED (lista o
// que falta) — quem chama não envia nada nesse estado.
//
// Mapeamento oficial UI ↔ banco (o mesmo de resolve-user-responsibility-tier.ts):
//   Nível 1 Responsável    = responsible_direct_user_id
//   Nível 1 Corresponsável = secondary_responsible_user_id
//   Nível 2 Gerência       = escalation_1_user_id
//   Nível 3 Diretoria      = board_user_id
//   escalation_2_user_id   = legado (ambíguo quando preenchido).

import { computeSlaDeadlines, type ComputedSlaDeadlines } from "./compute-deadlines";
import { resolveBusinessHoursConfig, resolveMatrixRule, type ResolvedSlaMatrixRule } from "./resolve-matrix-rule";
import type { SlaBusinessHoursConfig } from "./time-units";
import type { SlaArea, SlaAreaResponsibles, SlaMatrixRule, SlaProjectSettings, SlaRiskLevel, SlaTimeUnit } from "./types";

export type MatrixPolicyStatus = "OK" | "CONFIGURATION_REVIEW_REQUIRED";

export type MatrixPolicyMissing =
  | "AREA_RESPONSIBLES_NOT_CONFIGURED"
  | "LEVEL_1_MISSING"
  | "LEVEL_2_MISSING"
  | "LEVEL_3_MISSING"
  | "LEGACY_LEVEL_2_AMBIGUOUS";

export interface MatrixPolicy {
  status: MatrixPolicyStatus;
  missing: MatrixPolicyMissing[];
  area: SlaArea;
  riskLevel: SlaRiskLevel;
  timeUnit: SlaTimeUnit;
  assumeDeadlineValue: number;
  respondDeadlineValue: number | null;
  completeDeadlineValue: number | null;
  escalation2AfterValue: number;
  boardAfterValue: number;
  notifyByEmail: boolean;
  requiresAcknowledgmentConfirmation: boolean;
  requiresDelayJustification: boolean;
  /** true quando o projeto não gravou regra própria e o DEFAULT institucional da Matriz foi usado. */
  usingDefaultRule: boolean;
  level1UserId: string | null;
  level1SecondaryUserId: string | null;
  level2UserId: string | null;
  level3UserId: string | null;
  businessHours: SlaBusinessHoursConfig;
  rule: ResolvedSlaMatrixRule;
}

export interface ResolveMatrixPolicyInput {
  rules: SlaMatrixRule[];
  responsibles: SlaAreaResponsibles[];
  settings: SlaProjectSettings | null;
  area: SlaArea;
  riskLevel: SlaRiskLevel;
}

export function resolveMatrixPolicy(input: ResolveMatrixPolicyInput): MatrixPolicy {
  const rule = resolveMatrixRule(input.rules, input.riskLevel, input.area);
  const businessHours = resolveBusinessHoursConfig(input.settings);
  const row = input.responsibles.find((r) => r.area === input.area) ?? null;
  const missing: MatrixPolicyMissing[] = [];

  if (!row) {
    missing.push("AREA_RESPONSIBLES_NOT_CONFIGURED");
  } else {
    // Cada nível ausente é listado explicitamente — nunca inventado nem
    // "emprestado" de outro nível. Nível 2 ausente não bloqueia (a regra
    // existente escala direto ao Nível 3), mas é informado.
    if (!row.responsibleDirectUserId && !row.secondaryResponsibleUserId) missing.push("LEVEL_1_MISSING");
    if (!row.escalation1UserId) missing.push("LEVEL_2_MISSING");
    if (!row.boardUserId) missing.push("LEVEL_3_MISSING");
    if (row.escalation2UserId && row.escalation2UserId !== row.escalation1UserId && row.escalation2UserId !== row.boardUserId) {
      missing.push("LEGACY_LEVEL_2_AMBIGUOUS");
    }
  }

  const blocking = missing.filter((m) => m !== "LEVEL_2_MISSING");
  return {
    status: blocking.length === 0 ? "OK" : "CONFIGURATION_REVIEW_REQUIRED",
    missing,
    area: input.area,
    riskLevel: input.riskLevel,
    timeUnit: rule.timeUnit,
    assumeDeadlineValue: rule.assumeDeadlineValue,
    respondDeadlineValue: rule.respondDeadlineValue,
    completeDeadlineValue: rule.completeDeadlineValue,
    escalation2AfterValue: rule.escalation2AfterValue,
    boardAfterValue: rule.boardAfterValue,
    notifyByEmail: rule.notifyByEmail,
    requiresAcknowledgmentConfirmation: rule.requiresAcknowledgmentConfirmation,
    requiresDelayJustification: rule.requiresDelayJustification,
    usingDefaultRule: rule.isDefault,
    level1UserId: row?.responsibleDirectUserId ?? null,
    level1SecondaryUserId: row?.secondaryResponsibleUserId ?? null,
    level2UserId: row?.escalation1UserId ?? null,
    level3UserId: row?.boardUserId ?? null,
    businessHours,
    rule,
  };
}

/** Prazos concretos (assumir/responder/concluir) a partir de um instante, na unidade e expediente da política. */
export function computePolicyDeadlines(policy: MatrixPolicy, fromIso: string): ComputedSlaDeadlines {
  return computeSlaDeadlines(fromIso, policy.rule, policy.businessHours);
}

/** Snapshot serializável da regra aplicada — gravado na outbox para auditoria (nunca usado como fonte de prazo). */
export function matrixPolicySnapshot(policy: MatrixPolicy): Record<string, unknown> {
  return {
    area: policy.area,
    riskLevel: policy.riskLevel,
    timeUnit: policy.timeUnit,
    assumeDeadlineValue: policy.assumeDeadlineValue,
    respondDeadlineValue: policy.respondDeadlineValue,
    completeDeadlineValue: policy.completeDeadlineValue,
    escalation2AfterValue: policy.escalation2AfterValue,
    boardAfterValue: policy.boardAfterValue,
    notifyByEmail: policy.notifyByEmail,
    requiresAcknowledgmentConfirmation: policy.requiresAcknowledgmentConfirmation,
    requiresDelayJustification: policy.requiresDelayJustification,
    usingDefaultRule: policy.usingDefaultRule,
    level1UserId: policy.level1UserId,
    level1SecondaryUserId: policy.level1SecondaryUserId,
    level2UserId: policy.level2UserId,
    level3UserId: policy.level3UserId,
    timeZone: policy.businessHours.timeZone,
    businessDayStartHour: policy.businessHours.businessDayStartHour,
    businessDayEndHour: policy.businessHours.businessDayEndHour,
    status: policy.status,
    missing: policy.missing,
  };
}
