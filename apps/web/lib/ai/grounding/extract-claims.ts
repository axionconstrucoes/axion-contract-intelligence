// Extração determinística de "afirmações candidatas" (frases) de um
// draft, e classificação de categoria por padrão textual — nunca por
// embeddings/LLM. Ver docs/ai/grounding-and-citation-guardrails.md,
// seção "Limitações", para o que esta abordagem não cobre.

import type { ClaimCategory } from "./types";

/** Divide um texto em frases candidatas — heurística simples por pontuação/quebra de linha. */
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8); // descarta fragmentos triviais (saudações curtas, linhas em branco)
}

/** Números de cláusula no formato "5.2", "10.1.3" etc. */
export const CLAUSE_NUMBER_REGEX = /\b\d{1,3}(?:\.\d{1,3}){1,3}\b/g;

/** Valores monetários — "R$ 1.234,56", "R$1000". */
export const CURRENCY_REGEX = /R\$\s?[\d.,]+/g;

/** Percentuais — "5%", "5,5 %". */
export const PERCENT_REGEX = /\d+(?:[.,]\d+)?\s?%/g;

/** Datas — "10/03/2026", "10-03-2026". */
export const DATE_REGEX = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;

const LEGAL_MARKERS = [
  "art.", "artigo", "lei n", "lei nº", "lei no", "código civil", "codigo civil",
  "súmula", "sumula", "jurisprudência", "jurisprudencia", "cpc", "cdc",
];

const CONTRACTUAL_KEYWORDS = [
  "cláusula", "clausula", "percentual", "prazo", "multa", "retenção", "retencao",
  "obrigação", "obrigacao", "direito", "condição de pagamento", "condicao de pagamento",
  "reajuste", "garantia",
];

/** Termos que, quando presentes junto de um número não localizado, sinalizam "depende de definição humana" em vez de "número inventado". */
export const HUMAN_LIMIT_KEYWORDS = [
  "desconto", "margem", "limite", "mínimo", "minimo", "máximo", "maximo", "autorizado", "autorização", "autorizacao",
];

/** Marcadores de interpretação/hedge — uma afirmação que já se apresenta como interpretação, nunca como fato. */
export const INFERENCE_MARKERS = [
  "relacionado", "relacionada", "pode ser", "poderia", "sugere", "sugerem", "indica", "indicam",
  "aparenta", "aparentemente", "possivelmente", "provavelmente", "tende a", "parece", "parece que",
  "é possível que", "e possivel que", "presumivelmente",
];

function containsAny(normalized: string, markers: string[]): boolean {
  return markers.some((marker) => normalized.includes(marker));
}

export function extractCurrencyValues(text: string): string[] {
  return Array.from(text.matchAll(CURRENCY_REGEX)).map((m) => m[0]);
}

export function extractPercentValues(text: string): string[] {
  return Array.from(text.matchAll(PERCENT_REGEX)).map((m) => m[0]);
}

export function extractDateValues(text: string): string[] {
  return Array.from(text.matchAll(DATE_REGEX)).map((m) => m[0]);
}

/**
 * Números de cláusula no formato "5.2", "10.1.3" etc. Exclui candidatos
 * que na verdade fazem parte de um valor monetário/percentual/data já
 * extraído (ex.: o "10.000" de "R$ 10.000,00" nunca pode ser lido como
 * cláusula "10.000") — sem esse filtro, o separador de milhar brasileiro
 * ("." ) colide com o formato de número de cláusula.
 */
export function extractClauseNumbers(text: string): string[] {
  const excludedSpans = [...extractCurrencyValues(text), ...extractPercentValues(text), ...extractDateValues(text)];
  const raw = Array.from(text.matchAll(CLAUSE_NUMBER_REGEX)).map((m) => m[0]);
  return raw.filter((candidate) => !excludedSpans.some((span) => span.includes(candidate)));
}

export function hasLegalMarker(normalizedText: string): boolean {
  return containsAny(normalizedText, LEGAL_MARKERS);
}

export function hasContractualKeyword(normalizedText: string): boolean {
  return containsAny(normalizedText, CONTRACTUAL_KEYWORDS);
}

export function hasHumanLimitKeyword(normalizedText: string): boolean {
  return containsAny(normalizedText, HUMAN_LIMIT_KEYWORDS);
}

export function hasInferenceMarker(normalizedText: string): boolean {
  return containsAny(normalizedText, INFERENCE_MARKERS);
}

/**
 * Categoria primária de uma frase — prioridade LEGAL > CONTRACTUAL >
 * NUMERIC > FACTUAL (a mais específica/rígida vence; cada frase recebe
 * exatamente uma categoria para manter a avaliação previsível). Usa
 * `.matchAll`/funções `extract*` (nunca `.test` com regex `/g`, que
 * mantém estado entre chamadas via `lastIndex` — uma fonte clássica de
 * bug sutil evitada aqui de propósito).
 */
export function classifyPrimaryCategory(normalizedText: string): ClaimCategory {
  if (hasLegalMarker(normalizedText)) return "LEGAL";
  if (hasContractualKeyword(normalizedText) || extractClauseNumbers(normalizedText).length > 0) {
    return "CONTRACTUAL";
  }
  if (
    extractCurrencyValues(normalizedText).length > 0 ||
    extractPercentValues(normalizedText).length > 0 ||
    extractDateValues(normalizedText).length > 0
  ) {
    return "NUMERIC";
  }
  return "FACTUAL";
}
