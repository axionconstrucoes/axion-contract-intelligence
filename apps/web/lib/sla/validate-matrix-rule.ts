// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// Validação determinística da Matriz de SLA (Ações e Escalonamentos —
// Parte 6): nenhum prazo pode ser negativo/zero, e a ordem de
// escalonamento precisa ser coerente (2º escalão só depois do prazo de
// assumir; Diretoria só depois do 2º escalão) — nunca depende só de
// `min`/`required` do HTML, que o navegador pode contornar.

export interface SlaMatrixRuleValues {
  assumeDeadlineValue: number;
  respondDeadlineValue: number | null;
  completeDeadlineValue: number | null;
  escalation2AfterValue: number;
  boardAfterValue: number;
}

export interface SlaMatrixRuleValidationResult {
  valid: boolean;
  error: string | null;
}

export function validateSlaMatrixRuleValues(values: SlaMatrixRuleValues): SlaMatrixRuleValidationResult {
  const numericFields: [string, number | null][] = [
    ["Prazo assumir", values.assumeDeadlineValue],
    ["Prazo responder", values.respondDeadlineValue],
    ["Prazo concluir", values.completeDeadlineValue],
    ["Até 2º escalão", values.escalation2AfterValue],
    ["Até Diretoria", values.boardAfterValue],
  ];

  for (const [label, value] of numericFields) {
    if (value === null) continue;
    if (!Number.isFinite(value)) {
      return { valid: false, error: `${label}: valor numérico inválido.` };
    }
    if (value <= 0) {
      return { valid: false, error: `${label} não pode ser negativo nem zero.` };
    }
  }

  if (values.escalation2AfterValue <= values.assumeDeadlineValue) {
    return {
      valid: false,
      error: "Ordem de escalonamento incoerente: \"Até 2º escalão\" precisa ser maior que \"Prazo assumir\".",
    };
  }

  if (values.boardAfterValue <= values.escalation2AfterValue) {
    return {
      valid: false,
      error: "Ordem de escalonamento incoerente: \"Até Diretoria\" precisa ser maior que \"Até 2º escalão\".",
    };
  }

  return { valid: true, error: null };
}

// Auditoria com valores anterior/novo — nunca só "regra alterada" sem
// dizer o quê. `previous` null cobre a primeira configuração explícita
// deste projeto/risco (antes disso, o default institucional era usado,
// nunca uma linha em sla_matrix_rules).
export function formatSlaMatrixRuleAuditDetail(
  riskLevel: string,
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>
): string {
  if (!previous) {
    return `Regra de SLA (risco ${riskLevel}) configurada pela primeira vez neste projeto (antes usava o default institucional). Novo: ${JSON.stringify(next)}`;
  }
  return `Regra de SLA (risco ${riskLevel}) alterada. Anterior: ${JSON.stringify(previous)} | Novo: ${JSON.stringify(next)}`;
}
