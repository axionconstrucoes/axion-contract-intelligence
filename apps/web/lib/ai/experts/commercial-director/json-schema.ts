// JSON Schema completo usado como `input_schema` da tool-call forçada
// ao Anthropic para o Diretor Comercial IA (generateAssessment).
// Espelha CommercialDirectorAssessment (./types.ts) — genérico
// (ExpertAssessment) + `negotiation`. Qualquer alteração de campo em
// ./types.ts deve ser refletida aqui. A validação real e definitiva
// continua em ./schema.ts (validateCommercialDirectorAssessment); este
// schema só melhora a taxa de acerto do modelo, nunca a substitui.

import { EXPERT_ASSESSMENT_BASE_PROPERTIES, EXPERT_ASSESSMENT_BASE_REQUIRED } from "../../schemas/expert-assessment-json-schema";
import { fieldValueSchema, impactAssessmentSchema, STRING_ARRAY_SCHEMA } from "../../schemas/json-schema-fragments";

const DRAFT_COMMUNICATION_TYPES = [
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
] as const;

const draftCommunicationSchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        type: { type: "string", enum: [...DRAFT_COMMUNICATION_TYPES] },
        subject: { type: ["string", "null"] },
        body: { type: "string" },
        status: { const: "DRAFT_PENDING_REVIEW" },
      },
      required: ["type", "subject", "body", "status"],
      additionalProperties: false,
    },
  ],
} as const;

const negotiationSchema = {
  type: "object",
  properties: {
    negotiationObjective: { type: ["string", "null"] },
    currentPosition: { type: ["string", "null"] },
    targetPosition: { type: ["string", "null"] },
    minimumAcceptablePosition: fieldValueSchema(),
    nonNegotiableItems: STRING_ARRAY_SCHEMA,
    negotiableItems: STRING_ARRAY_SCHEMA,
    possibleConcessions: STRING_ARRAY_SCHEMA,
    requiredCounterparts: STRING_ARRAY_SCHEMA,
    counterpartyLikelyInterests: STRING_ARRAY_SCHEMA,
    recommendedStrategy: { type: ["string", "null"] },
    arguments: STRING_ARRAY_SCHEMA,
    anticipatedObjections: STRING_ARRAY_SCHEMA,
    suggestedResponses: STRING_ARRAY_SCHEMA,
    recommendedSequence: STRING_ARRAY_SCHEMA,
    commercialRisks: STRING_ARRAY_SCHEMA,
    financialImpact: impactAssessmentSchema("FINANCIAL"),
    scheduleImpact: impactAssessmentSchema("SCHEDULE"),
    contractualImpact: impactAssessmentSchema("CONTRACTUAL"),
    draftCommunication: draftCommunicationSchema,
  },
  required: [
    "negotiationObjective",
    "currentPosition",
    "targetPosition",
    "minimumAcceptablePosition",
    "nonNegotiableItems",
    "negotiableItems",
    "possibleConcessions",
    "requiredCounterparts",
    "counterpartyLikelyInterests",
    "recommendedStrategy",
    "arguments",
    "anticipatedObjections",
    "suggestedResponses",
    "recommendedSequence",
    "commercialRisks",
    "financialImpact",
    "scheduleImpact",
    "contractualImpact",
    "draftCommunication",
  ],
  additionalProperties: false,
} as const;

export const COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    ...EXPERT_ASSESSMENT_BASE_PROPERTIES,
    negotiation: negotiationSchema,
  },
  required: [...EXPERT_ASSESSMENT_BASE_REQUIRED, "negotiation"],
  additionalProperties: false,
} as const;
