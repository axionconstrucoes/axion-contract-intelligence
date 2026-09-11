import type { ContextContractualDocument } from "../../context/types";
import { EXPERT_SEVERITIES } from "../../schemas/expert-assessment-json-schema";
import {
  fail,
  isRecord,
  requireConfidence,
  requireNullableString,
  requireString,
} from "../../schemas/primitives";
import { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } from "../../query/json-schema";
import type {
  LegalClauseChangeAction,
  VerifiedLegalClauseComparison,
} from "../../query/types";
import type { ExpertSeverity } from "../../types";

const LEGAL_CLAUSE_ACTIONS: LegalClauseChangeAction[] = ["MODIFY", "REMOVE", "ADD"];

const legalClauseComparisonSchema = {
  type: "object",
  properties: {
    documentId: { type: "string" },
    documentVersionId: { type: "string" },
    clauseNumber: { type: ["string", "null"] },
    clauseTitle: { type: ["string", "null"] },
    originalText: { type: ["string", "null"] },
    proposedText: { type: ["string", "null"] },
    action: { type: "string", enum: [...LEGAL_CLAUSE_ACTIONS] },
    rationale: { type: "string" },
    mitigatedRisk: { type: "string" },
    // Nao existe corpus normativo oficial nesta fase; nunca permitir que
    // memoria do modelo vire fundamento legal exibido ao usuario.
    legalBasis: { type: "null" },
    severity: { type: "string", enum: [...EXPERT_SEVERITIES] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "documentId",
    "documentVersionId",
    "clauseNumber",
    "clauseTitle",
    "originalText",
    "proposedText",
    "action",
    "rationale",
    "mitigatedRisk",
    "legalBasis",
    "severity",
    "confidence",
  ],
  additionalProperties: false,
} as const;

/** Schema exclusivo da pagina pre-contratual, onde o texto esta presente. */
export const LEGAL_CONSULTANT_DOCUMENT_QUERY_RESPONSE_JSON_SCHEMA = {
  ...EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
  properties: {
    ...EXPERT_QUERY_RESPONSE_JSON_SCHEMA.properties,
    analiseClausulas: { type: "array", items: legalClauseComparisonSchema },
  },
  required: [...EXPERT_QUERY_RESPONSE_JSON_SCHEMA.required, "analiseClausulas"],
} as const;

function normalizeSourceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function nullableNonEmpty(value: unknown, field: string): string | null {
  const parsed = requireNullableString(value, field);
  if (parsed !== null && parsed.trim().length === 0) fail(`${field} nao pode ser vazio`);
  return parsed;
}

/**
 * Valida forma E proveniencia. Uma citacao que nao exista na mesma
 * versao carregada e rejeitada; nunca se associa texto inventado a outro
 * projeto/documento apenas porque o provider devolveu um id plausivel.
 */
export function validateLegalClauseComparisons(
  value: unknown,
  documents: ContextContractualDocument[]
): VerifiedLegalClauseComparison[] {
  if (!Array.isArray(value)) fail("Campo obrigatorio deve ser um array: analiseClausulas");

  return value.map((item, index) => {
    const field = `analiseClausulas[${index}]`;
    if (!isRecord(item)) fail(`${field} deve ser um objeto`);

    const documentId = requireString(item.documentId, `${field}.documentId`);
    const documentVersionId = requireString(item.documentVersionId, `${field}.documentVersionId`);
    const document = documents.find(
      (candidate) => candidate.documentId === documentId && candidate.documentVersionId === documentVersionId
    );
    if (!document) {
      fail(`${field} referencia documento ou versao fora do contexto autorizado desta consulta`);
    }

    const action = requireString(item.action, `${field}.action`) as LegalClauseChangeAction;
    if (!LEGAL_CLAUSE_ACTIONS.includes(action)) fail(`${field}.action invalida: ${action}`);

    const originalText = nullableNonEmpty(item.originalText, `${field}.originalText`);
    const proposedText = nullableNonEmpty(item.proposedText, `${field}.proposedText`);

    if (action === "ADD") {
      if (originalText !== null || proposedText === null) {
        fail(`${field}: ADD exige originalText null e proposedText preenchido`);
      }
    } else {
      if (originalText === null) fail(`${field}: ${action} exige originalText preenchido`);
      if (action === "MODIFY" && proposedText === null) fail(`${field}: MODIFY exige proposedText preenchido`);
      if (action === "REMOVE" && proposedText !== null) fail(`${field}: REMOVE exige proposedText null`);

      const normalizedDocument = normalizeSourceText(document.text);
      const normalizedOriginal = normalizeSourceText(originalText);
      if (!normalizedDocument.includes(normalizedOriginal)) {
        fail(`${field}.originalText nao foi localizado na versao documental indicada`);
      }
    }

    const severity = requireString(item.severity, `${field}.severity`) as ExpertSeverity;
    if (!EXPERT_SEVERITIES.includes(severity)) fail(`${field}.severity invalida: ${severity}`);

    const legalBasis = nullableNonEmpty(item.legalBasis, `${field}.legalBasis`);
    if (legalBasis !== null) fail(`${field}.legalBasis deve ser null sem corpus normativo oficial no contexto`);

    return {
      documentId,
      documentVersionId,
      documentTitle: document.title,
      versionLabel: document.versionLabel,
      clauseNumber: nullableNonEmpty(item.clauseNumber, `${field}.clauseNumber`),
      clauseTitle: nullableNonEmpty(item.clauseTitle, `${field}.clauseTitle`),
      originalText,
      proposedText,
      action,
      rationale: requireString(item.rationale, `${field}.rationale`),
      mitigatedRisk: requireString(item.mitigatedRisk, `${field}.mitigatedRisk`),
      legalBasis,
      severity,
      confidence: requireConfidence(item.confidence, `${field}.confidence`),
      sourceVerified: true,
    };
  });
}
