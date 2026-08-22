// Fragmentos de JSON Schema reutilizados para instruir providers de IA
// reais (ex.: Anthropic, via tool-use forçado) a produzir saída
// estruturada compatível com os validadores TypeScript já existentes.
//
// IMPORTANTE: este JSON Schema é apenas uma instrução/guia para o
// modelo — a garantia real de correção continua sendo os validadores
// TypeScript (validateExpertAssessment/validateExpertQueryResponse/
// validateCommercialDirectorAssessment), que sempre rodam depois. Nunca
// tratar uma resposta como válida só porque "passou" pela tool-call.

export const NULLABLE_STRING_SCHEMA = { type: ["string", "null"] } as const;
export const STRING_ARRAY_SCHEMA = { type: "array", items: { type: "string" } } as const;

export const CONTRACTUAL_BASIS_REF_SCHEMA = {
  type: "object",
  properties: {
    documentId: NULLABLE_STRING_SCHEMA,
    documentKind: NULLABLE_STRING_SCHEMA,
    clauseId: NULLABLE_STRING_SCHEMA,
    clauseNumber: NULLABLE_STRING_SCHEMA,
    clauseTitle: NULLABLE_STRING_SCHEMA,
    excerpt: NULLABLE_STRING_SCHEMA,
  },
  required: ["documentId", "documentKind", "clauseId", "clauseNumber", "clauseTitle", "excerpt"],
  additionalProperties: false,
} as const;

export const EVIDENCE_REF_SCHEMA = {
  type: "object",
  properties: {
    sourceType: { type: "string", enum: ["DOCUMENT", "CLAUSE", "EVENT", "EMAIL", "SCHEDULE_ACTIVITY"] },
    sourceId: { type: "string" },
    label: { type: "string" },
    locator: NULLABLE_STRING_SCHEMA,
  },
  required: ["sourceType", "sourceId", "label", "locator"],
  additionalProperties: false,
} as const;

export const LEGAL_SOURCE_SCHEMA = {
  type: "object",
  properties: {
    norma: { type: "string" },
    fonte: { type: "string" },
    origem: { type: "string", enum: ["CODIGO_CIVIL"] },
    versaoVigencia: { type: "string" },
    dispositivo: { type: "string" },
    referencia: { type: "string" },
  },
  required: ["norma", "fonte", "origem", "versaoVigencia", "dispositivo", "referencia"],
  additionalProperties: false,
} as const;

export const LEGAL_CITATION_SCHEMA = {
  type: "object",
  properties: {
    source: LEGAL_SOURCE_SCHEMA,
    relationToAnalysis: { type: "string" },
  },
  required: ["source", "relationToAnalysis"],
  additionalProperties: false,
} as const;

/**
 * Espelha CommercialFieldValue<string> (experts/commercial-director/types.ts)
 * — três estados explícitos, nunca um valor opcional solto. `oneOf`
 * garante que o modelo nunca combine `status: "AVAILABLE"` com
 * `value: null`, nem invente `value`/`basis` fora de AVAILABLE.
 */
export function fieldValueSchema() {
  return {
    oneOf: [
      {
        type: "object",
        properties: { status: { const: "AVAILABLE" }, value: { type: "string" }, basis: { type: "string" } },
        required: ["status", "value", "basis"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { status: { const: "UNAVAILABLE" }, value: { type: "null" }, basis: { type: "null" } },
        required: ["status", "value", "basis"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: { const: "REQUIRES_HUMAN_DEFINITION" },
          value: { type: "null" },
          basis: { type: "null" },
        },
        required: ["status", "value", "basis"],
        additionalProperties: false,
      },
    ],
  } as const;
}

/** Espelha CommercialImpactAssessment (experts/commercial-director/types.ts). */
export function impactAssessmentSchema(category: "FINANCIAL" | "SCHEDULE" | "CONTRACTUAL") {
  return {
    type: "object",
    properties: {
      category: { const: category },
      status: { type: "string", enum: ["AVAILABLE", "UNAVAILABLE", "REQUIRES_HUMAN_DEFINITION"] },
      description: NULLABLE_STRING_SCHEMA,
      estimatedValue: { type: ["number", "null"] },
      basis: NULLABLE_STRING_SCHEMA,
    },
    required: ["category", "status", "description", "estimatedValue", "basis"],
    additionalProperties: false,
  } as const;
}
