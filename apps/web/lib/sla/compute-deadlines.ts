// Calcula os três prazos do Relógio B (SLA interno) no momento da
// criação de uma ação, a partir da regra de matriz já resolvida
// (resolve-matrix-rule.ts). Puro, sem I/O. Os valores calculados são
// armazenados na ação (nunca recalculados "para trás" se a matriz mudar
// depois — ver migration, colunas assume_due_at/respond_due_at/
// complete_due_at).

import { addTimeUnits, AXION_DEFAULT_BUSINESS_HOURS_CONFIG, type SlaBusinessHoursConfig } from "./time-units";
import type { ResolvedSlaMatrixRule } from "./resolve-matrix-rule";

export interface ComputedSlaDeadlines {
  assumeDueAt: string;
  respondDueAt: string | null;
  completeDueAt: string | null;
}

export function computeSlaDeadlines(
  createdAt: string,
  rule: ResolvedSlaMatrixRule,
  businessHoursConfig: SlaBusinessHoursConfig = AXION_DEFAULT_BUSINESS_HOURS_CONFIG
): ComputedSlaDeadlines {
  const start = new Date(createdAt);

  return {
    assumeDueAt: addTimeUnits(start, rule.assumeDeadlineValue, rule.timeUnit, businessHoursConfig).toISOString(),
    respondDueAt:
      rule.respondDeadlineValue !== null
        ? addTimeUnits(start, rule.respondDeadlineValue, rule.timeUnit, businessHoursConfig).toISOString()
        : null,
    completeDueAt:
      rule.completeDeadlineValue !== null
        ? addTimeUnits(start, rule.completeDeadlineValue, rule.timeUnit, businessHoursConfig).toISOString()
        : null,
  };
}
