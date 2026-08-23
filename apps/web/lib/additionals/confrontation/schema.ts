// Validação da parte específica do confronto (`confrontation`).
// Reutiliza validateExpertAssessment para a parte genérica — nunca
// reimplementa aquelas checagens aqui (mesmo padrão de
// experts/commercial-director/schema.ts).

import {
  ExpertAssessmentValidationError,
  validateExpertAssessment,
  type ExpectedExpertIdentity,
} from "../../ai/schemas/validate-expert-assessment";
import type { ClientSourceConfrontation, ClientSourceConfrontationAnalysis, ClientSourceConfrontationClassification } from "./types";

const VALID_CLASSIFICATIONS: ClientSourceConfrontationClassification[] = [
  "COMPATIBLE",
  "ADDITIONAL_REQUIREMENT",
  "CONTRACTUAL_CONFLICT",
  "POSSIBLE_SCOPE_CHANGE",
  "INCORPORATED_CONTRACT_DOCUMENT",
  "INDETERMINATE",
];

function fail(message: string): never {
  throw new ExpertAssessmentValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateConfrontation(value: unknown): ClientSourceConfrontationAnalysis {
  if (!isRecord(value)) fail("Campo obrigatório ausente ou inválido: confrontation");

  const classification = value.classification;
  if (typeof classification !== "string" || !VALID_CLASSIFICATIONS.includes(classification as ClientSourceConfrontationClassification)) {
    fail(
      `confrontation.classification inválida: ${String(classification)} — "NOVA EXIGÊNCIA DO CLIENTE" nunca é automaticamente "OBRIGAÇÃO CONTRATUAL", classifique explicitamente.`
    );
  }

  if (typeof value.precedenceFound !== "boolean") {
    fail("confrontation.precedenceFound deve ser boolean");
  }

  const precedenceSummary = value.precedenceSummary;
  if (precedenceSummary !== null && typeof precedenceSummary !== "string") {
    fail("confrontation.precedenceSummary deve ser string ou null");
  }
  if (value.precedenceFound === false && precedenceSummary !== null) {
    fail("confrontation.precedenceSummary deve ser null quando precedenceFound é false — nunca inventar uma regra de precedência inexistente.");
  }
  if (value.precedenceFound === true && (typeof precedenceSummary !== "string" || precedenceSummary.trim().length === 0)) {
    fail("confrontation.precedenceSummary é obrigatório e não pode ser vazio quando precedenceFound é true.");
  }

  return {
    classification: classification as ClientSourceConfrontationClassification,
    precedenceFound: value.precedenceFound,
    precedenceSummary: precedenceSummary,
  };
}

/**
 * Valida a saída bruta de um provider como ClientSourceConfrontation:
 * primeiro a parte genérica (validateExpertAssessment), depois
 * `confrontation`.
 */
export function validateClientSourceConfrontation(candidate: unknown, expected: ExpectedExpertIdentity): ClientSourceConfrontation {
  const generic = validateExpertAssessment(candidate, expected);
  const confrontationSource = isRecord(candidate) ? candidate.confrontation : undefined;

  return {
    ...generic,
    confrontation: validateConfrontation(confrontationSource),
  };
}
