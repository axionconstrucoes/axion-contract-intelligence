// Validação da saída estruturada de qualquer AI Expert do ACC. Nenhum
// provider (fake ou real) tem sua saída aceita sem passar por aqui —
// "Não permitir saída textual livre como única resposta".
//
// requiresHumanReview é tratado como invariante de segurança: se o
// candidato não trouxer exatamente `true`, a validação falha (nunca
// normaliza silenciosamente um `false`/ausente para `true`).

import type {
  ExpertAnalysisType,
  ExpertAssessment,
  ExpertContractualBasisRef,
  ExpertEvidenceRef,
  ExpertEvidenceSourceType,
  ExpertFinding,
  ExpertId,
  ExpertSeverity,
} from "../types";

export class ExpertAssessmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpertAssessmentValidationError";
  }
}

const VALID_SEVERITIES: ExpertSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const VALID_ANALYSIS_TYPES: ExpertAnalysisType[] = [
  "EVENT_CONTRACTUAL_ANALYSIS",
  "CLAUSE_CONFRONTATION_REVIEW",
  "SCOPE_CHANGE_ASSESSMENT",
  "RISK_ASSESSMENT",
  "COMMERCIAL_NEGOTIATION_STRATEGY",
  "COMMERCIAL_COMMUNICATION_DRAFT",
];
const VALID_EVIDENCE_SOURCE_TYPES: ExpertEvidenceSourceType[] = [
  "DOCUMENT",
  "CLAUSE",
  "EVENT",
  "EMAIL",
  "SCHEDULE_ACTIVITY",
];

function fail(message: string): never {
  throw new ExpertAssessmentValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`Campo obrigatório ausente ou vazio: ${field}`);
  }
  return value as string;
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

function validateFinding(value: unknown): ExpertFinding {
  if (!isRecord(value)) {
    fail("Campo obrigatório ausente ou inválido: finding");
  }
  return {
    facts: requireStringArray(value.facts, "finding.facts"),
    interpretation: requireString(value.interpretation, "finding.interpretation"),
  };
}

function validateContractualBasis(value: unknown): ExpertContractualBasisRef[] {
  if (!Array.isArray(value)) {
    fail("Campo obrigatório deve ser um array: contractualBasis");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      fail(`contractualBasis[${index}] deve ser um objeto`);
    }
    return {
      documentId: requireNullableString(item.documentId, `contractualBasis[${index}].documentId`),
      documentKind: requireNullableString(item.documentKind, `contractualBasis[${index}].documentKind`),
      clauseId: requireNullableString(item.clauseId, `contractualBasis[${index}].clauseId`),
      clauseNumber: requireNullableString(item.clauseNumber, `contractualBasis[${index}].clauseNumber`),
      clauseTitle: requireNullableString(item.clauseTitle, `contractualBasis[${index}].clauseTitle`),
      excerpt: requireNullableString(item.excerpt, `contractualBasis[${index}].excerpt`),
    };
  });
}

function validateEvidenceRefs(value: unknown): ExpertEvidenceRef[] {
  if (!Array.isArray(value)) {
    fail("Campo obrigatório deve ser um array: evidenceRefs");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      fail(`evidenceRefs[${index}] deve ser um objeto`);
    }
    const sourceType = item.sourceType;
    if (typeof sourceType !== "string" || !VALID_EVIDENCE_SOURCE_TYPES.includes(sourceType as ExpertEvidenceSourceType)) {
      fail(`evidenceRefs[${index}].sourceType inválido: ${String(sourceType)}`);
    }
    return {
      sourceType: sourceType as ExpertEvidenceSourceType,
      sourceId: requireString(item.sourceId, `evidenceRefs[${index}].sourceId`),
      label: requireString(item.label, `evidenceRefs[${index}].label`),
      locator: requireNullableString(item.locator, `evidenceRefs[${index}].locator`),
    };
  });
}

export interface ExpectedExpertIdentity {
  expertId: ExpertId;
  expertName: string;
  expertVersion: string;
}

/**
 * Valida e normaliza a saída bruta de um provider como ExpertAssessment.
 * Lança ExpertAssessmentValidationError descrevendo exatamente o que
 * falhou — nunca "conserta" silenciosamente um campo inválido.
 */
export function validateExpertAssessment(candidate: unknown, expected: ExpectedExpertIdentity): ExpertAssessment {
  if (!isRecord(candidate)) {
    fail("Saída do provider não é um objeto — saída textual livre não é aceita.");
  }

  const expertId = requireString(candidate.expertId, "expertId");
  if (expertId !== expected.expertId) {
    fail(`expertId inesperado: "${expertId}" (esperado "${expected.expertId}")`);
  }

  const expertName = requireString(candidate.expertName, "expertName");
  if (expertName !== expected.expertName) {
    fail(`expertName inesperado: "${expertName}" (esperado "${expected.expertName}")`);
  }

  const expertVersion = requireString(candidate.expertVersion, "expertVersion");
  if (expertVersion !== expected.expertVersion) {
    fail(`expertVersion inesperado: "${expertVersion}" (esperado "${expected.expertVersion}")`);
  }

  const analysisType = requireString(candidate.analysisType, "analysisType");
  if (!VALID_ANALYSIS_TYPES.includes(analysisType as ExpertAnalysisType)) {
    fail(`analysisType inválido: "${analysisType}"`);
  }

  const severity = requireString(candidate.severity, "severity");
  if (!VALID_SEVERITIES.includes(severity as ExpertSeverity)) {
    fail(`severity inválida: "${severity}" (permitidas: ${VALID_SEVERITIES.join(", ")})`);
  }

  const confidence = candidate.confidence;
  if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    fail(`confidence deve ser um número entre 0 e 1 — recebido: ${String(confidence)}`);
  }

  if (candidate.requiresHumanReview !== true) {
    fail(
      `requiresHumanReview deve ser exatamente true nesta fase — recebido: ${JSON.stringify(candidate.requiresHumanReview)}. ` +
        "Um Expert nunca pode dispensar revisão humana."
    );
  }

  return {
    expertId: expertId as ExpertId,
    expertName,
    expertVersion,
    analysisType: analysisType as ExpertAnalysisType,
    finding: validateFinding(candidate.finding),
    severity: severity as ExpertSeverity,
    confidence,
    executiveSummary: requireString(candidate.executiveSummary, "executiveSummary"),
    contractualBasis: validateContractualBasis(candidate.contractualBasis),
    eventBasis: requireStringArray(candidate.eventBasis, "eventBasis"),
    evidenceRefs: validateEvidenceRefs(candidate.evidenceRefs),
    possibleImpacts: requireStringArray(candidate.possibleImpacts, "possibleImpacts"),
    recommendedActions: requireStringArray(candidate.recommendedActions, "recommendedActions"),
    uncertainties: requireStringArray(candidate.uncertainties, "uncertainties"),
    requiresHumanReview: true,
    // Nunca lido do provider (candidate.grounding é ignorado de propósito —
    // um provider nunca pode se autodeclarar "grounded"). Sempre null aqui;
    // o Expert específico preenche depois de rodar o guardrail determinístico
    // (ver apps/web/lib/ai/grounding/).
    grounding: null,
  };
}
