// JSON Schema completo usado como `input_schema` da tool-call forçada ao
// Anthropic para o confronto fonte-do-cliente x contrato-base
// (generateAssessment, analysisType = CLIENT_SOURCE_CONFRONTATION).
// Espelha ClientSourceConfrontation (./types.ts) — genérico
// (ExpertAssessment) + `confrontation`. A validação real continua em
// ./schema.ts.

import { EXPERT_ASSESSMENT_BASE_PROPERTIES, EXPERT_ASSESSMENT_BASE_REQUIRED } from "../../ai/schemas/expert-assessment-json-schema";

const CLASSIFICATIONS = [
  "COMPATIBLE",
  "ADDITIONAL_REQUIREMENT",
  "CONTRACTUAL_CONFLICT",
  "POSSIBLE_SCOPE_CHANGE",
  "INCORPORATED_CONTRACT_DOCUMENT",
  "INDETERMINATE",
] as const;

const confrontationSchema = {
  type: "object",
  properties: {
    classification: { type: "string", enum: [...CLASSIFICATIONS] },
    precedenceFound: { type: "boolean" },
    precedenceSummary: { type: ["string", "null"] },
  },
  required: ["classification", "precedenceFound", "precedenceSummary"],
  additionalProperties: false,
} as const;

export const CLIENT_SOURCE_CONFRONTATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    ...EXPERT_ASSESSMENT_BASE_PROPERTIES,
    confrontation: confrontationSchema,
  },
  required: [...EXPERT_ASSESSMENT_BASE_REQUIRED, "confrontation"],
  additionalProperties: false,
} as const;
