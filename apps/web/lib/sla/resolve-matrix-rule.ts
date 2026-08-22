// Resolve qual regra de matriz aplicar a uma combinação risco/área — puro,
// sem I/O. Prioridade: regra do projeto específica da área > regra do
// projeto geral (area = null) > default hardcoded (DEFAULT_SLA_MATRIX).
// Nunca inventa uma regra — os DEFAULTs são os únicos valores usados
// quando o projeto não configurou nada (seção 2: "Esses valores são
// DEFAULTS. Cada projeto deve poder alterá-los").

import { DEFAULT_SLA_MATRIX } from "./default-matrix";
import { AXION_DEFAULT_BUSINESS_HOURS_CONFIG, type SlaBusinessHoursConfig } from "./time-units";
import type { SlaArea, SlaMatrixRule, SlaProjectSettings, SlaRiskLevel } from "./types";

export interface ResolvedSlaMatrixRule {
  timeUnit: SlaMatrixRule["timeUnit"];
  assumeDeadlineValue: number;
  respondDeadlineValue: number | null;
  completeDeadlineValue: number | null;
  escalation2AfterValue: number;
  boardAfterValue: number;
  notifyByEmail: boolean;
  requiresAcknowledgmentConfirmation: boolean;
  requiresDelayJustification: boolean;
  isDefault: boolean;
}

function fromRow(row: SlaMatrixRule): ResolvedSlaMatrixRule {
  return {
    timeUnit: row.timeUnit,
    assumeDeadlineValue: row.assumeDeadlineValue,
    respondDeadlineValue: row.respondDeadlineValue,
    completeDeadlineValue: row.completeDeadlineValue,
    escalation2AfterValue: row.escalation2AfterValue,
    boardAfterValue: row.boardAfterValue,
    notifyByEmail: row.notifyByEmail,
    requiresAcknowledgmentConfirmation: row.requiresAcknowledgmentConfirmation,
    requiresDelayJustification: row.requiresDelayJustification,
    isDefault: false,
  };
}

function fromDefault(riskLevel: SlaRiskLevel): ResolvedSlaMatrixRule {
  const fallback = DEFAULT_SLA_MATRIX[riskLevel];
  return {
    timeUnit: fallback.timeUnit,
    assumeDeadlineValue: fallback.assumeDeadlineValue,
    respondDeadlineValue: fallback.respondDeadlineValue,
    completeDeadlineValue: fallback.completeDeadlineValue,
    escalation2AfterValue: fallback.escalation2AfterValue,
    boardAfterValue: fallback.boardAfterValue,
    notifyByEmail: fallback.notifyByEmail,
    requiresAcknowledgmentConfirmation: fallback.requiresAcknowledgmentConfirmation,
    requiresDelayJustification: fallback.requiresDelayJustification,
    isDefault: true,
  };
}

/** Resolve para uma ação real (tem área definida): área-específica > geral do projeto > default. */
export function resolveMatrixRule(
  projectRules: SlaMatrixRule[],
  riskLevel: SlaRiskLevel,
  area: SlaArea
): ResolvedSlaMatrixRule {
  const activeRules = projectRules.filter((r) => r.active && r.riskLevel === riskLevel);

  const areaSpecific = activeRules.find((r) => r.area === area);
  const generic = activeRules.find((r) => r.area === null);
  const match = areaSpecific ?? generic;

  return match ? fromRow(match) : fromDefault(riskLevel);
}

/**
 * Resolve a regra GERAL do projeto para um risco (ignora overrides por
 * área) — usada pela tela de configuração (seção 17), cuja tabela é só
 * "RISCO → prazos", sem coluna de área.
 */
export function resolveGenericMatrixRule(projectRules: SlaMatrixRule[], riskLevel: SlaRiskLevel): ResolvedSlaMatrixRule {
  const generic = projectRules.find((r) => r.active && r.riskLevel === riskLevel && r.area === null);
  return generic ? fromRow(generic) : fromDefault(riskLevel);
}

/**
 * Resolve o timezone/expediente do projeto — configuração do projeto
 * quando existir, senão o default institucional AXION
 * (America/Sao_Paulo, 08:00–18:00). Nunca UTC como horário comercial.
 */
export function resolveBusinessHoursConfig(settings: SlaProjectSettings | null): SlaBusinessHoursConfig {
  if (!settings) {
    return AXION_DEFAULT_BUSINESS_HOURS_CONFIG;
  }
  return {
    timeZone: settings.timezone,
    businessDayStartHour: settings.businessDayStartHour,
    businessDayEndHour: settings.businessDayEndHour,
  };
}
