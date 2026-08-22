// JSON Schema genérico para ExpertQueryResponse (./types.ts) — usado
// como `input_schema` da tool-call forçada ao Anthropic (ou qualquer
// provider real futuro) em qualquer consulta conversacional. Genérico
// por design (nenhum campo específico de um Expert) — reutilizável por
// qualquer Expert que implemente answerQuery. A validação real e
// definitiva continua em validate-expert-query-response.ts; este schema
// só melhora a taxa de acerto do modelo, nunca a substitui.

import { CONTRACTUAL_BASIS_REF_SCHEMA, LEGAL_CITATION_SCHEMA, STRING_ARRAY_SCHEMA } from "../schemas/json-schema-fragments";
import { EXPERT_SEVERITIES } from "../schemas/expert-assessment-json-schema";

const QUERY_SCOPES = ["PROJECT", "EVENT", "DOCUMENT", "EMAIL", "MULTI_EXPERT"] as const;
const REQUIREMENT_KINDS = ["LEGAL_REQUIREMENT", "CONTRACTUAL_REQUIREMENT", "NEGOTIATION_PRACTICE", "AI_RECOMMENDATION"] as const;
const DRAFT_TYPES = [
  "EMAIL",
  "PROPOSAL",
  "COUNTER_PROPOSAL",
  "LETTER",
  "NOTIFICATION",
  "COMMERCIAL_RESPONSE",
  "MEETING_AGENDA",
  "NEGOTIATION_SCRIPT",
  "MEMO",
  "INFORMATION_REQUEST",
  "AMENDMENT_TEXT",
] as const;

const declaredContextItemSchema = {
  type: "object",
  properties: {
    noteId: { type: "string" },
    category: { type: "string" },
    text: { type: "string" },
    author: { type: "string" },
    createdAt: { type: "string" },
    status: { const: "DECLARED_CONTEXT" },
  },
  required: ["noteId", "category", "text", "author", "createdAt", "status"],
  additionalProperties: false,
} as const;

const classifiedStatementSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...REQUIREMENT_KINDS] },
    statement: { type: "string" },
  },
  required: ["kind", "statement"],
  additionalProperties: false,
} as const;

const queryDraftSchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        type: { type: "string", enum: [...DRAFT_TYPES] },
        subject: { type: ["string", "null"] },
        body: { type: "string" },
        status: { const: "DRAFT_PENDING_REVIEW" },
      },
      required: ["type", "subject", "body", "status"],
      additionalProperties: false,
    },
  ],
} as const;

export const EXPERT_QUERY_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    expertId: { type: "string" },
    expertName: { type: "string" },
    expertVersion: { type: "string" },
    scope: { type: "string", enum: [...QUERY_SCOPES] },
    question: { type: "string" },
    fatosDocumentados: STRING_ARRAY_SCHEMA,
    contextoInternoDeclarado: { type: "array", items: declaredContextItemSchema },
    baseContratual: { type: "array", items: CONTRACTUAL_BASIS_REF_SCHEMA },
    baseLegal: { type: "array", items: LEGAL_CITATION_SCHEMA },
    praticasNegociais: { type: "array", items: classifiedStatementSchema },
    interpretacao: { type: "string" },
    riscos: STRING_ARRAY_SCHEMA,
    severity: { type: "string", enum: [...EXPERT_SEVERITIES] },
    recomendacoes: STRING_ARRAY_SCHEMA,
    acoesSugeridas: STRING_ARRAY_SCHEMA,
    informacoesFaltantes: STRING_ARRAY_SCHEMA,
    rascunhoSugerido: queryDraftSchema,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    requiresHumanReview: { const: true },
  },
  required: [
    "expertId",
    "expertName",
    "expertVersion",
    "scope",
    "question",
    "fatosDocumentados",
    "contextoInternoDeclarado",
    "baseContratual",
    "baseLegal",
    "praticasNegociais",
    "interpretacao",
    "riscos",
    "severity",
    "recomendacoes",
    "acoesSugeridas",
    "informacoesFaltantes",
    "rascunhoSugerido",
    "confidence",
    "requiresHumanReview",
  ],
  additionalProperties: false,
} as const;
