// Validação da parte específica do Diretor Comercial IA (`negotiation`).
// Reutiliza validateExpertAssessment para a parte genérica — nunca
// reimplementa aquelas checagens aqui.

import { ExpertAssessmentValidationError, validateExpertAssessment, type ExpectedExpertIdentity } from "../../schemas/validate-expert-assessment";
import type {
  CommercialDirectorAssessment,
  CommercialDraftCommunication,
  CommercialDraftCommunicationType,
  CommercialFieldValue,
  CommercialImpactAssessment,
  CommercialImpactCategory,
  CommercialNegotiationAnalysis,
} from "./types";

const VALID_FIELD_STATUSES = ["AVAILABLE", "UNAVAILABLE", "REQUIRES_HUMAN_DEFINITION"] as const;
const VALID_DRAFT_TYPES: CommercialDraftCommunicationType[] = [
  "EMAIL",
  "PROPOSAL",
  "COUNTER_PROPOSAL",
  "LETTER",
  "MEETING_AGENDA",
  "NEGOTIATION_SCRIPT",
  "MEMO",
  "AMENDMENT_TEXT",
  "INFORMATION_REQUEST",
  "CLAIM_RESPONSE",
];

function fail(message: string): never {
  throw new ExpertAssessmentValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail(`Campo obrigatório deve ser um array de strings: ${field}`);
  }
  return value as string[];
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    fail(`Campo deve ser string ou null: ${field}`);
  }
  return value as string;
}

function validateFieldValue(value: unknown, field: string): CommercialFieldValue<string> {
  if (!isRecord(value)) {
    fail(`Campo obrigatório ausente ou inválido: ${field}`);
  }
  const status = value.status;
  if (typeof status !== "string" || !VALID_FIELD_STATUSES.includes(status as (typeof VALID_FIELD_STATUSES)[number])) {
    fail(`${field}.status inválido: ${String(status)}`);
  }

  if (status === "AVAILABLE") {
    if (typeof value.value !== "string" || value.value.trim().length === 0) {
      fail(`${field}.value é obrigatório e não pode ser vazio quando status é AVAILABLE`);
    }
    if (typeof value.basis !== "string" || value.basis.trim().length === 0) {
      fail(`${field}.basis é obrigatório quando status é AVAILABLE — nunca um valor sem fundamento citado`);
    }
    return { status: "AVAILABLE", value: value.value, basis: value.basis };
  }

  if (value.value !== null || value.basis !== null) {
    fail(`${field}.value e ${field}.basis devem ser null quando status não é AVAILABLE (nunca inventar valor)`);
  }

  return { status: status as "UNAVAILABLE" | "REQUIRES_HUMAN_DEFINITION", value: null, basis: null };
}

function validateImpactAssessment(
  value: unknown,
  field: string,
  expectedCategory: CommercialImpactCategory
): CommercialImpactAssessment {
  if (!isRecord(value)) {
    fail(`Campo obrigatório ausente ou inválido: ${field}`);
  }

  if (value.category !== expectedCategory) {
    fail(`${field}.category deve ser "${expectedCategory}" — recebido: ${String(value.category)}`);
  }

  const status = value.status;
  if (typeof status !== "string" || !VALID_FIELD_STATUSES.includes(status as (typeof VALID_FIELD_STATUSES)[number])) {
    fail(`${field}.status inválido: ${String(status)}`);
  }

  const estimatedValue = value.estimatedValue;
  if (estimatedValue !== null && typeof estimatedValue !== "number") {
    fail(`${field}.estimatedValue deve ser number ou null`);
  }
  if (status !== "AVAILABLE" && estimatedValue !== null) {
    fail(`${field}.estimatedValue deve ser null quando status não é AVAILABLE — nunca um número inventado`);
  }

  return {
    category: expectedCategory,
    status: status as CommercialImpactAssessment["status"],
    description: requireNullableString(value.description, `${field}.description`),
    estimatedValue: estimatedValue,
    basis: requireNullableString(value.basis, `${field}.basis`),
  };
}

function validateDraftCommunication(value: unknown): CommercialDraftCommunication | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    fail("negotiation.draftCommunication deve ser um objeto ou null");
  }

  const type = value.type;
  if (typeof type !== "string" || !VALID_DRAFT_TYPES.includes(type as CommercialDraftCommunicationType)) {
    fail(`negotiation.draftCommunication.type inválido: ${String(type)}`);
  }

  if (typeof value.body !== "string" || value.body.trim().length === 0) {
    fail("negotiation.draftCommunication.body é obrigatório e não pode ser vazio");
  }

  // Invariante de segurança, igual a requiresHumanReview: nunca aceitar um
  // status diferente — é o que garante em nível de tipo que nenhum rascunho
  // é tratado como enviado.
  if (value.status !== "DRAFT_PENDING_REVIEW") {
    fail(
      `negotiation.draftCommunication.status deve ser exatamente "DRAFT_PENDING_REVIEW" — recebido: ${JSON.stringify(value.status)}. Nenhuma comunicação pode ser marcada como enviada por este Expert.`
    );
  }

  return {
    type: type as CommercialDraftCommunicationType,
    subject: requireNullableString(value.subject, "negotiation.draftCommunication.subject"),
    body: value.body,
    status: "DRAFT_PENDING_REVIEW",
  };
}

function validateNegotiation(value: unknown): CommercialNegotiationAnalysis {
  if (!isRecord(value)) {
    fail("Campo obrigatório ausente ou inválido: negotiation");
  }

  return {
    negotiationObjective: requireNullableString(value.negotiationObjective, "negotiation.negotiationObjective"),
    currentPosition: requireNullableString(value.currentPosition, "negotiation.currentPosition"),
    targetPosition: requireNullableString(value.targetPosition, "negotiation.targetPosition"),
    minimumAcceptablePosition: validateFieldValue(value.minimumAcceptablePosition, "negotiation.minimumAcceptablePosition"),
    nonNegotiableItems: requireStringArray(value.nonNegotiableItems, "negotiation.nonNegotiableItems"),
    negotiableItems: requireStringArray(value.negotiableItems, "negotiation.negotiableItems"),
    possibleConcessions: requireStringArray(value.possibleConcessions, "negotiation.possibleConcessions"),
    requiredCounterparts: requireStringArray(value.requiredCounterparts, "negotiation.requiredCounterparts"),
    counterpartyLikelyInterests: requireStringArray(value.counterpartyLikelyInterests, "negotiation.counterpartyLikelyInterests"),
    recommendedStrategy: requireNullableString(value.recommendedStrategy, "negotiation.recommendedStrategy"),
    arguments: requireStringArray(value.arguments, "negotiation.arguments"),
    anticipatedObjections: requireStringArray(value.anticipatedObjections, "negotiation.anticipatedObjections"),
    suggestedResponses: requireStringArray(value.suggestedResponses, "negotiation.suggestedResponses"),
    recommendedSequence: requireStringArray(value.recommendedSequence, "negotiation.recommendedSequence"),
    commercialRisks: requireStringArray(value.commercialRisks, "negotiation.commercialRisks"),
    financialImpact: validateImpactAssessment(value.financialImpact, "negotiation.financialImpact", "FINANCIAL"),
    scheduleImpact: validateImpactAssessment(value.scheduleImpact, "negotiation.scheduleImpact", "SCHEDULE"),
    contractualImpact: validateImpactAssessment(value.contractualImpact, "negotiation.contractualImpact", "CONTRACTUAL"),
    draftCommunication: validateDraftCommunication(value.draftCommunication),
  };
}

/**
 * Valida a saída bruta de um provider como CommercialDirectorAssessment:
 * primeiro a parte genérica (validateExpertAssessment), depois `negotiation`.
 */
export function validateCommercialDirectorAssessment(
  candidate: unknown,
  expected: ExpectedExpertIdentity
): CommercialDirectorAssessment {
  const generic = validateExpertAssessment(candidate, expected);

  const negotiationSource = isRecord(candidate) ? candidate.negotiation : undefined;

  return {
    ...generic,
    negotiation: validateNegotiation(negotiationSource),
  };
}
