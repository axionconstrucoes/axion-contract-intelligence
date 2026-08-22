// Avaliação determinística de uma única afirmação (frase) contra um
// GroundingSource — dispatch por categoria (LEGAL > CONTRACTUAL >
// NUMERIC > FACTUAL). Nunca usa embeddings/LLM; ver
// docs/ai/grounding-and-citation-guardrails.md, seção "Limitações".

import {
  classifyPrimaryCategory,
  extractClauseNumbers,
  extractCurrencyValues,
  extractDateValues,
  extractPercentValues,
  hasHumanLimitKeyword,
  hasInferenceMarker,
} from "./extract-claims";
import { buildVocabulary, normalizeText, significantTokens, vocabularyHasToken } from "./tokenize";
import type { GroundedClaim } from "./types";

/**
 * Acima deste percentual de tokens "novos" (não presentes no
 * vocabulário-fonte), uma afirmação factual sem hedge é considerada
 * UNSUPPORTED em vez de INFERENCE. Constante simples e documentada —
 * não é uma fórmula complexa (seção 13/17 do requisito).
 */
const FACTUAL_UNSUPPORTED_NOVEL_RATIO = 0.3;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textContainsSubstring(sourceTexts: string[], needle: string): boolean {
  const normalizedNeedle = normalizeWhitespace(normalizeText(needle));
  return sourceTexts.some((text) => normalizeWhitespace(normalizeText(text)).includes(normalizedNeedle));
}

function evaluateLegalClaim(sentence: string, availableLegalReferences: string[]): GroundedClaim {
  if (availableLegalReferences.length === 0) {
    return {
      text: sentence,
      category: "LEGAL",
      supportStatus: "UNSUPPORTED",
      evidenceRefs: [],
      contractualBasisRefs: [],
      legalSourceRefs: [],
      reasoningNote: 'Citação legal sem LegalSource oficial no contexto — "NÃO DISPONÍVEL — FONTE LEGAL OFICIAL NÃO FORNECIDA NO CONTEXTO."',
    };
  }

  const normalizedSentence = normalizeText(sentence);
  const matched = availableLegalReferences.filter((ref) => normalizedSentence.includes(normalizeText(ref)));

  if (matched.length > 0) {
    return {
      text: sentence,
      category: "LEGAL",
      supportStatus: "SUPPORTED",
      evidenceRefs: [],
      contractualBasisRefs: [],
      legalSourceRefs: matched,
      reasoningNote: `Suportado por fonte legal já citada: ${matched.join(", ")}.`,
    };
  }

  return {
    text: sentence,
    category: "LEGAL",
    supportStatus: "UNSUPPORTED",
    evidenceRefs: [],
    contractualBasisRefs: [],
    legalSourceRefs: [],
    reasoningNote: "Citação legal não corresponde a nenhuma LegalSource oficial disponível no contexto — nunca validar por memória do modelo.",
  };
}

function evaluateContractualClaim(sentence: string, availableClauseNumbers: string[], sourceTexts: string[]): GroundedClaim {
  const cited = extractClauseNumbers(sentence);

  if (cited.length > 0) {
    const missing = cited.filter((clause) => !availableClauseNumbers.includes(clause));
    if (missing.length === 0) {
      return {
        text: sentence,
        category: "CONTRACTUAL",
        supportStatus: "SUPPORTED",
        evidenceRefs: [],
        contractualBasisRefs: cited,
        legalSourceRefs: [],
        reasoningNote: `Cláusula(s) citada(s) presente(s) na base contratual: ${cited.join(", ")}.`,
      };
    }
    return {
      text: sentence,
      category: "CONTRACTUAL",
      supportStatus: "UNSUPPORTED",
      evidenceRefs: [],
      contractualBasisRefs: [],
      legalSourceRefs: [],
      reasoningNote: `Cláusula(s) citada(s) ausente(s) do contexto autorizado: ${missing.join(", ")} — nunca citar cláusula não presente na base contratual.`,
    };
  }

  // Termo contratual (multa, retenção, reajuste, garantia...) sem número de cláusula explícito, mas
  // com valor numérico (R$/%/data) — a checagem numérica é mais precisa que o overlap de vocabulário.
  const hasNumericValue =
    extractCurrencyValues(sentence).length > 0 || extractPercentValues(sentence).length > 0 || extractDateValues(sentence).length > 0;
  if (hasNumericValue) {
    const numericResult = evaluateNumericClaim(sentence, sourceTexts);
    return { ...numericResult, category: "CONTRACTUAL" };
  }

  // Termo contratual sem cláusula nem valor numérico — checagem por vocabulário.
  return evaluateFactualClaim(sentence, sourceTexts, "CONTRACTUAL");
}

function evaluateNumericClaim(sentence: string, sourceTexts: string[]): GroundedClaim {
  const values = [...extractCurrencyValues(sentence), ...extractPercentValues(sentence), ...extractDateValues(sentence)];
  const missing = values.filter((value) => !textContainsSubstring(sourceTexts, value));

  if (missing.length === 0) {
    return {
      text: sentence,
      category: "NUMERIC",
      supportStatus: "SUPPORTED",
      evidenceRefs: values,
      contractualBasisRefs: [],
      legalSourceRefs: [],
      reasoningNote: values.length > 0 ? `Valor(es) numérico(s) localizado(s) no contexto: ${values.join(", ")}.` : "Sem valor numérico extraído.",
    };
  }

  const normalizedSentence = normalizeText(sentence);
  if (hasHumanLimitKeyword(normalizedSentence)) {
    return {
      text: sentence,
      category: "NUMERIC",
      supportStatus: "HUMAN_INPUT_REQUIRED",
      evidenceRefs: [],
      contractualBasisRefs: [],
      legalSourceRefs: [],
      reasoningNote: `Valor comercial (${missing.join(", ")}) não presente no contexto — "NÃO DISPONÍVEL — NECESSÁRIA DEFINIÇÃO HUMANA."`,
    };
  }

  return {
    text: sentence,
    category: "NUMERIC",
    supportStatus: "UNSUPPORTED",
    evidenceRefs: [],
    contractualBasisRefs: [],
    legalSourceRefs: [],
    reasoningNote: `Valor numérico não localizado no contexto: ${missing.join(", ")} — nunca inventar número.`,
  };
}

function evaluateFactualClaim(
  sentence: string,
  sourceTexts: string[],
  category: "FACTUAL" | "CONTRACTUAL" = "FACTUAL"
): GroundedClaim {
  const vocabulary = buildVocabulary(sourceTexts);
  const tokens = significantTokens(sentence);
  const novelTokens = tokens.filter((token) => !vocabularyHasToken(vocabulary, token));
  const normalizedSentence = normalizeText(sentence);
  const hedge = hasInferenceMarker(normalizedSentence);

  if (tokens.length === 0 || novelTokens.length === 0) {
    return {
      text: sentence,
      category,
      supportStatus: "SUPPORTED",
      evidenceRefs: [],
      contractualBasisRefs: [],
      legalSourceRefs: [],
      reasoningNote: "Termos da afirmação presentes no contexto fornecido.",
    };
  }

  if (hedge) {
    return {
      text: sentence,
      category,
      supportStatus: "INFERENCE",
      evidenceRefs: [],
      contractualBasisRefs: [],
      legalSourceRefs: [],
      reasoningNote: `Inferência (linguagem condicional detectada) — termo(s) não presente(s) diretamente na fonte: ${novelTokens.join(", ")}.`,
    };
  }

  const novelRatio = novelTokens.length / tokens.length;
  if (novelRatio >= FACTUAL_UNSUPPORTED_NOVEL_RATIO) {
    return {
      text: sentence,
      category,
      supportStatus: "UNSUPPORTED",
      evidenceRefs: [],
      contractualBasisRefs: [],
      legalSourceRefs: [],
      reasoningNote: `Afirmação introduz termo(s) não presente(s) na fonte: ${novelTokens.join(", ")} — fonte não afirma isso diretamente.`,
    };
  }

  return {
    text: sentence,
    category,
    supportStatus: "INFERENCE",
    evidenceRefs: [],
    contractualBasisRefs: [],
    legalSourceRefs: [],
    reasoningNote: `Interpretação razoável, com termo(s) adicional(is) não presente(s) diretamente na fonte: ${novelTokens.join(", ")}.`,
  };
}

export function evaluateClaimGrounding(
  sentence: string,
  source: { sourceTexts: string[]; availableClauseNumbers: string[]; availableLegalReferences: string[] }
): GroundedClaim {
  const normalizedSentence = normalizeText(sentence);
  const category = classifyPrimaryCategory(normalizedSentence);

  switch (category) {
    case "LEGAL":
      return evaluateLegalClaim(sentence, source.availableLegalReferences);
    case "CONTRACTUAL":
      return evaluateContractualClaim(sentence, source.availableClauseNumbers, source.sourceTexts);
    case "NUMERIC":
      return evaluateNumericClaim(sentence, source.sourceTexts);
    case "FACTUAL":
    default:
      return evaluateFactualClaim(sentence, source.sourceTexts);
  }
}
