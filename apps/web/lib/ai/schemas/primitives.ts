// Primitivas de validação reutilizadas por validate-expert-assessment.ts
// e por qualquer outro validador da AI Foundation (ex.:
// query/validate-expert-query-response.ts). Nenhuma lógica de negócio
// aqui — só checagem de forma/tipo, sempre lançando
// ValidationFailure com mensagem descritiva.

export class ValidationFailure extends Error {}

export function fail(message: string): never {
  throw new ValidationFailure(message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`Campo obrigatório ausente ou vazio: ${field}`);
  }
  return value as string;
}

export function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail(`Campo obrigatório deve ser um array de strings: ${field}`);
  }
  return value as string[];
}

export function requireNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    fail(`Campo deve ser string ou null: ${field}`);
  }
  return value as string;
}

export function requireConfidence(value: unknown, field = "confidence"): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    fail(`${field} deve ser um número entre 0 e 1 — recebido: ${String(value)}`);
  }
  return value;
}

/** requiresHumanReview é invariante de segurança: nunca aceito como false/ausente. */
export function requireHumanReviewTrue(value: unknown, field = "requiresHumanReview"): true {
  if (value !== true) {
    fail(
      `${field} deve ser exatamente true nesta fase — recebido: ${JSON.stringify(value)}. Um Expert nunca pode dispensar revisão humana.`
    );
  }
  return true;
}
