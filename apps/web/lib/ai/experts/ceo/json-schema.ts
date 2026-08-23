// JSON Schema da saída de consolidação executiva (ExecutiveCuration —
// ./types.ts), usado como `input_schema` da tool-call forçada ao
// Anthropic. A validação real e definitiva continua em ./schema.ts; este
// schema só melhora a taxa de acerto do modelo, nunca a substitui.

import { STRING_ARRAY_SCHEMA } from "../../schemas/json-schema-fragments";
import { EXPERT_SEVERITIES } from "../../schemas/expert-assessment-json-schema";

const executiveCurationPositionSchema = {
  type: "object",
  properties: {
    expertId: { type: "string" },
    expertName: { type: "string" },
    severity: { type: "string", enum: [...EXPERT_SEVERITIES] },
    summary: { type: "string" },
  },
  required: ["expertId", "expertName", "severity", "summary"],
  additionalProperties: false,
} as const;

const executiveCurationConflictSchema = {
  type: "object",
  properties: {
    topic: { type: "string" },
    positions: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        properties: {
          expertId: { type: "string" },
          expertName: { type: "string" },
          position: { type: "string" },
        },
        required: ["expertId", "expertName", "position"],
        additionalProperties: false,
      },
    },
    probableReason: { type: "string" },
  },
  required: ["topic", "positions", "probableReason"],
  additionalProperties: false,
} as const;

export const EXECUTIVE_CURATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    situacao: { type: "string" },
    fatosPrincipais: STRING_ARRAY_SCHEMA,
    posicoes: { type: "array", items: executiveCurationPositionSchema },
    divergencias: { type: "array", items: executiveCurationConflictSchema },
    riscos: STRING_ARRAY_SCHEMA,
    overallSeverity: { type: "string", enum: [...EXPERT_SEVERITIES] },
    alternativas: STRING_ARRAY_SCHEMA,
    recomendacao: { type: "string" },
    decisoesHumanasNecessarias: STRING_ARRAY_SCHEMA,
    requiresHumanReview: { const: true },
  },
  required: [
    "situacao",
    "fatosPrincipais",
    "posicoes",
    "divergencias",
    "riscos",
    "overallSeverity",
    "alternativas",
    "recomendacao",
    "decisoesHumanasNecessarias",
    "requiresHumanReview",
  ],
  additionalProperties: false,
} as const;
