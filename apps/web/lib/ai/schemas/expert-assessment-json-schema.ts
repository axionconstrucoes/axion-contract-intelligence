// Base JSON Schema dos campos genéricos de ExpertAssessment (../types.ts)
// — reutilizada por qualquer Expert real que implemente generateAssessment
// (hoje, somente commercial-director). Mantida sincronizada manualmente
// com ExpertAssessment/validateExpertAssessment; qualquer alteração de
// campo ali deve ser refletida aqui. A validação real continua sendo
// validate-expert-assessment.ts — este schema só orienta o modelo.

import { CONTRACTUAL_BASIS_REF_SCHEMA, EVIDENCE_REF_SCHEMA, STRING_ARRAY_SCHEMA } from "./json-schema-fragments";

export const EXPERT_ANALYSIS_TYPES = [
  "EVENT_CONTRACTUAL_ANALYSIS",
  "CLAUSE_CONFRONTATION_REVIEW",
  "SCOPE_CHANGE_ASSESSMENT",
  "RISK_ASSESSMENT",
  "COMMERCIAL_NEGOTIATION_STRATEGY",
  "COMMERCIAL_COMMUNICATION_DRAFT",
] as const;

export const EXPERT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const EXPERT_ASSESSMENT_BASE_PROPERTIES = {
  expertId: { type: "string" },
  expertName: { type: "string" },
  expertVersion: { type: "string" },
  analysisType: { type: "string", enum: [...EXPERT_ANALYSIS_TYPES] },
  finding: {
    type: "object",
    properties: {
      facts: STRING_ARRAY_SCHEMA,
      interpretation: { type: "string" },
    },
    required: ["facts", "interpretation"],
    additionalProperties: false,
  },
  severity: { type: "string", enum: [...EXPERT_SEVERITIES] },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  executiveSummary: { type: "string" },
  contractualBasis: { type: "array", items: CONTRACTUAL_BASIS_REF_SCHEMA },
  eventBasis: STRING_ARRAY_SCHEMA,
  evidenceRefs: { type: "array", items: EVIDENCE_REF_SCHEMA },
  possibleImpacts: STRING_ARRAY_SCHEMA,
  recommendedActions: STRING_ARRAY_SCHEMA,
  uncertainties: STRING_ARRAY_SCHEMA,
  requiresHumanReview: { const: true },
} as const;

export const EXPERT_ASSESSMENT_BASE_REQUIRED = [
  "expertId",
  "expertName",
  "expertVersion",
  "analysisType",
  "finding",
  "severity",
  "confidence",
  "executiveSummary",
  "contractualBasis",
  "eventBasis",
  "evidenceRefs",
  "possibleImpacts",
  "recommendedActions",
  "uncertainties",
  "requiresHumanReview",
] as const;
