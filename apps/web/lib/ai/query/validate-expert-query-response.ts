// Validação da resposta de consulta conversacional (ExpertQueryResponse).
// Reutiliza as primitivas de apps/web/lib/ai/schemas/primitives.ts — as
// mesmas usadas por validate-expert-assessment.ts — em vez de duplicar
// checagem de forma/tipo.

import {
  fail,
  isRecord,
  requireConfidence,
  requireHumanReviewTrue,
  requireNullableString,
  requireString,
  requireStringArray,
  ValidationFailure,
} from "../schemas/primitives";
import type { ExpertContractualBasisRef, ExpertId, ExpertSeverity } from "../types";
import type { LegalCitation, LegalSource, LegalSourceOrigin } from "../legal/types";
import type {
  ClassifiedStatement,
  DeclaredContextItem,
  ExpertQueryDraft,
  ExpertQueryDraftType,
  ExpertQueryResponse,
  ExpertQueryScope,
  RequirementSourceKind,
} from "./types";

export { ValidationFailure as ExpertQueryValidationError };

const VALID_SCOPES: ExpertQueryScope[] = ["PROJECT", "EVENT", "DOCUMENT", "EMAIL", "MULTI_EXPERT"];
const VALID_SEVERITIES: ExpertSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const VALID_REQUIREMENT_KINDS: RequirementSourceKind[] = [
  "LEGAL_REQUIREMENT",
  "CONTRACTUAL_REQUIREMENT",
  "NEGOTIATION_PRACTICE",
  "AI_RECOMMENDATION",
];
const VALID_LEGAL_ORIGINS: LegalSourceOrigin[] = ["CODIGO_CIVIL"];
const VALID_DRAFT_TYPES: ExpertQueryDraftType[] = [
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
];

function validateContractualBasis(value: unknown): ExpertContractualBasisRef[] {
  if (!Array.isArray(value)) {
    fail("Campo obrigatório deve ser um array: baseContratual");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`baseContratual[${index}] deve ser um objeto`);
    return {
      documentId: requireNullableString(item.documentId, `baseContratual[${index}].documentId`),
      documentKind: requireNullableString(item.documentKind, `baseContratual[${index}].documentKind`),
      clauseId: requireNullableString(item.clauseId, `baseContratual[${index}].clauseId`),
      clauseNumber: requireNullableString(item.clauseNumber, `baseContratual[${index}].clauseNumber`),
      clauseTitle: requireNullableString(item.clauseTitle, `baseContratual[${index}].clauseTitle`),
      excerpt: requireNullableString(item.excerpt, `baseContratual[${index}].excerpt`),
    };
  });
}

function validateLegalSource(value: unknown, field: string): LegalSource {
  if (!isRecord(value)) fail(`${field} deve ser um objeto`);
  const origem = value.origem;
  if (typeof origem !== "string" || !VALID_LEGAL_ORIGINS.includes(origem as LegalSourceOrigin)) {
    fail(`${field}.origem inválida: ${String(origem)}`);
  }
  return {
    norma: requireString(value.norma, `${field}.norma`),
    fonte: requireString(value.fonte, `${field}.fonte`),
    origem: origem as LegalSourceOrigin,
    versaoVigencia: requireString(value.versaoVigencia, `${field}.versaoVigencia`),
    dispositivo: requireString(value.dispositivo, `${field}.dispositivo`),
    referencia: requireString(value.referencia, `${field}.referencia`),
  };
}

function validateBaseLegal(value: unknown): LegalCitation[] {
  if (!Array.isArray(value)) {
    fail("Campo obrigatório deve ser um array: baseLegal");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`baseLegal[${index}] deve ser um objeto`);
    return {
      source: validateLegalSource(item.source, `baseLegal[${index}].source`),
      relationToAnalysis: requireString(item.relationToAnalysis, `baseLegal[${index}].relationToAnalysis`),
    };
  });
}

function validatePraticasNegociais(value: unknown): ClassifiedStatement[] {
  if (!Array.isArray(value)) {
    fail("Campo obrigatório deve ser um array: praticasNegociais");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`praticasNegociais[${index}] deve ser um objeto`);
    const kind = item.kind;
    if (typeof kind !== "string" || !VALID_REQUIREMENT_KINDS.includes(kind as RequirementSourceKind)) {
      fail(`praticasNegociais[${index}].kind inválido: ${String(kind)} — nunca apresentar prática negocial como obrigação jurídica sem classificação explícita`);
    }
    return {
      kind: kind as RequirementSourceKind,
      statement: requireString(item.statement, `praticasNegociais[${index}].statement`),
    };
  });
}

function validateContextoInternoDeclarado(value: unknown): DeclaredContextItem[] {
  if (!Array.isArray(value)) {
    fail("Campo obrigatório deve ser um array: contextoInternoDeclarado");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`contextoInternoDeclarado[${index}] deve ser um objeto`);
    if (item.status !== "DECLARED_CONTEXT") {
      fail(
        `contextoInternoDeclarado[${index}].status deve ser exatamente "DECLARED_CONTEXT" — recebido: ${JSON.stringify(item.status)}. Anotação de usuário nunca pode ser reclassificada como fato confirmado.`
      );
    }
    return {
      noteId: requireString(item.noteId, `contextoInternoDeclarado[${index}].noteId`),
      category: requireString(item.category, `contextoInternoDeclarado[${index}].category`),
      text: requireString(item.text, `contextoInternoDeclarado[${index}].text`),
      author: requireString(item.author, `contextoInternoDeclarado[${index}].author`),
      createdAt: requireString(item.createdAt, `contextoInternoDeclarado[${index}].createdAt`),
      status: "DECLARED_CONTEXT",
    };
  });
}

function validateRascunhoSugerido(value: unknown): ExpertQueryDraft | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) fail("rascunhoSugerido deve ser um objeto ou null");

  const type = value.type;
  if (typeof type !== "string" || !VALID_DRAFT_TYPES.includes(type as ExpertQueryDraftType)) {
    fail(`rascunhoSugerido.type inválido: ${String(type)}`);
  }

  if (value.status !== "DRAFT_PENDING_REVIEW") {
    fail(
      `rascunhoSugerido.status deve ser exatamente "DRAFT_PENDING_REVIEW" — recebido: ${JSON.stringify(value.status)}. Nenhum rascunho pode ser tratado como enviado.`
    );
  }

  return {
    type: type as ExpertQueryDraftType,
    subject: requireNullableString(value.subject, "rascunhoSugerido.subject"),
    body: requireString(value.body, "rascunhoSugerido.body"),
    status: "DRAFT_PENDING_REVIEW",
  };
}

export interface ExpectedExpertQueryIdentity {
  expertId: ExpertId;
  expertName: string;
  expertVersion: string;
  /**
   * Escopo CONFIÁVEL desta consulta — sempre o `scope` do
   * ExpertQueryRequest já validado no servidor (ver
   * experts/<expert>/query.ts), nunca um valor lido da resposta do
   * provider e nunca um valor livre vindo do navegador.
   *
   * O provider (LLM real) não é fonte de verdade para metadado de
   * requisição: ele não "descobre" o escopo, ele apenas recebe o
   * contexto que o servidor montou a partir dele. Quando o modelo
   * omitia este campo, a resposta inteira era descartada com
   * "scope inválido: undefined" — mesmo estando correta. Aqui o escopo
   * passou a ser derivado do servidor, na mesma linha do que já era
   * feito com `grounding` (nunca lido do provider).
   */
  scope: ExpertQueryScope;
}

/**
 * Mensagem exibida quando nem o servidor consegue determinar o escopo
 * da consulta — nunca expõe "undefined" ao usuário.
 */
export const MISSING_QUERY_SCOPE_MESSAGE =
  "Não foi possível identificar o contexto desta análise. Recarregue a página e tente novamente.";

/**
 * Valida a saída bruta de um provider como ExpertQueryResponse. Lança
 * ValidationFailure descrevendo exatamente o que falhou — nunca
 * "conserta" silenciosamente um campo inválido.
 */
export function validateExpertQueryResponse(
  candidate: unknown,
  expected: ExpectedExpertQueryIdentity
): ExpertQueryResponse {
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

  // Escopo: SEMPRE o do servidor (expected.scope). O que o provider
  // eventualmente devolveu só é usado para detectar contradição — nunca
  // como fonte. Ausência no provider não é erro; divergência é.
  if (!VALID_SCOPES.includes(expected.scope)) {
    fail(MISSING_QUERY_SCOPE_MESSAGE);
  }

  const providerScope = candidate.scope;
  if (providerScope !== undefined && providerScope !== null && providerScope !== expected.scope) {
    fail(
      `scope divergente: o provider respondeu ${JSON.stringify(providerScope)}, mas esta consulta foi montada no ` +
        `escopo "${expected.scope}". Nenhuma resposta é aceita fora do contexto autorizado da consulta.`
    );
  }

  const severity = requireString(candidate.severity, "severity");
  if (!VALID_SEVERITIES.includes(severity as ExpertSeverity)) {
    fail(`severity inválida: "${severity}"`);
  }

  return {
    expertId: expertId as ExpertId,
    expertName,
    expertVersion,
    // Derivado do contexto confiável do servidor, nunca da saída do provider.
    scope: expected.scope,
    question: requireString(candidate.question, "question"),
    fatosDocumentados: requireStringArray(candidate.fatosDocumentados, "fatosDocumentados"),
    contextoInternoDeclarado: validateContextoInternoDeclarado(candidate.contextoInternoDeclarado),
    baseContratual: validateContractualBasis(candidate.baseContratual),
    baseLegal: validateBaseLegal(candidate.baseLegal),
    praticasNegociais: validatePraticasNegociais(candidate.praticasNegociais),
    interpretacao: requireString(candidate.interpretacao, "interpretacao"),
    riscos: requireStringArray(candidate.riscos, "riscos"),
    severity: severity as ExpertSeverity,
    recomendacoes: requireStringArray(candidate.recomendacoes, "recomendacoes"),
    acoesSugeridas: requireStringArray(candidate.acoesSugeridas, "acoesSugeridas"),
    informacoesFaltantes: requireStringArray(candidate.informacoesFaltantes, "informacoesFaltantes"),
    rascunhoSugerido: validateRascunhoSugerido(candidate.rascunhoSugerido),
    confidence: requireConfidence(candidate.confidence),
    requiresHumanReview: requireHumanReviewTrue(candidate.requiresHumanReview),
    // Nunca lido do provider (candidate.grounding é ignorado de propósito).
    // Sempre null aqui; o Expert específico preenche depois de rodar o
    // guardrail determinístico (ver apps/web/lib/ai/grounding/).
    grounding: null,
  };
}
