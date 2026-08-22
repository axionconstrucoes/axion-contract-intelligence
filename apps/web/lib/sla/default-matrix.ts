// Matriz DEFAULT (seção 2 do requisito) — usada quando um projeto ainda
// não configurou sua própria regra para um nível de risco. Puro, sem
// I/O. Valores exatamente como especificados; campos não especificados
// (prazo para responder/concluir) ficam null — nunca inventados.

import type { SlaMatrixRule, SlaRiskLevel } from "./types";

export type DefaultSlaMatrixRule = Omit<
  SlaMatrixRule,
  "id" | "projectId" | "area" | "isDefault" | "active"
> & { isDefault: true };

// CRÍTICO usa CLOCK_HOURS (não "horas úteis", diferente de ALTO) — o
// requisito descreve "1 hora"/"até 2 horas" sem o qualificador "útil"
// usado explicitamente para BAIXO/MÉDIO/ALTO; risco crítico não deveria
// esperar o expediente.
export const DEFAULT_SLA_MATRIX: Record<SlaRiskLevel, DefaultSlaMatrixRule> = {
  LOW: {
    riskLevel: "LOW",
    timeUnit: "BUSINESS_DAYS",
    assumeDeadlineValue: 3,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 3,
    boardAfterValue: 2,
    notifyByEmail: true,
    requiresAcknowledgmentConfirmation: false,
    requiresDelayJustification: true,
    isDefault: true,
  },
  MEDIUM: {
    riskLevel: "MEDIUM",
    timeUnit: "BUSINESS_DAYS",
    assumeDeadlineValue: 1,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 1,
    boardAfterValue: 1,
    notifyByEmail: true,
    requiresAcknowledgmentConfirmation: false,
    requiresDelayJustification: true,
    isDefault: true,
  },
  HIGH: {
    riskLevel: "HIGH",
    timeUnit: "BUSINESS_HOURS",
    assumeDeadlineValue: 4,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 4,
    boardAfterValue: 4,
    notifyByEmail: true,
    requiresAcknowledgmentConfirmation: true,
    requiresDelayJustification: true,
    isDefault: true,
  },
  CRITICAL: {
    riskLevel: "CRITICAL",
    timeUnit: "CLOCK_HOURS",
    assumeDeadlineValue: 1,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 1,
    boardAfterValue: 2,
    notifyByEmail: true,
    requiresAcknowledgmentConfirmation: true,
    requiresDelayJustification: true,
    isDefault: true,
  },
};
