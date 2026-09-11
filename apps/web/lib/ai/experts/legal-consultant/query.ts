// Orquestra uma consulta conversacional ao Consultor Jurídico IA
// ("Perguntar ao Consultor Jurídico IA"). Reutiliza o context builder
// genérico (build-event-context.ts / build-project-context.ts) sem
// duplicação — nunca cria um segundo sistema de contexto paralelo. Mesmo
// padrão de experts/commercial-director/query.ts.
//
// Escopos suportados nesta fase: PROJECT e EVENT. DOCUMENT, EMAIL e
// MULTI_EXPERT falham explicitamente (fail closed) — nunca simulados.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEventAnalysisContext } from "../../context/build-event-context";
import { buildProjectAnalysisContext } from "../../context/build-project-context";
import {
  adjustConfidenceForGrounding,
  applySafeGroundingCorrection,
  buildGroundingSource,
  buildResponseGroundingSummary,
  NOT_PERFORMED_GROUNDING_SUMMARY,
  validateDraftGrounding,
} from "../../grounding/index";
import { ExpertQuerySafeError } from "../../expert-query-request";
import { resolveAiProviderForExpert } from "../../providers/resolve-provider-for-expert";
import type { ContextDocumentCoverage } from "../../context/types";
import type { AiProvider } from "../../providers/types";
import { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } from "../../query/json-schema";
import { validateExpertQueryResponse } from "../../query/validate-expert-query-response";
import type { ExpertQueryRequest, ExpertQueryResponse, ExpertQueryScope } from "../../query/types";
import {
  LEGAL_CONSULTANT_EXPERT_ID,
  LEGAL_CONSULTANT_INSTRUCTIONS,
  LEGAL_CONSULTANT_NAME,
  LEGAL_CONSULTANT_VERSION,
} from "./identity";
import {
  LEGAL_CONSULTANT_DOCUMENT_QUERY_RESPONSE_JSON_SCHEMA,
  validateLegalClauseComparisons,
} from "./clause-comparison";

const IMPLEMENTED_SCOPES: ExpertQueryScope[] = ["PROJECT", "EVENT"];

export interface LegalConsultantQueryResult {
  response: ExpertQueryResponse;
  /** Cobertura documental calculada no servidor (null fora do fluxo pre-contratual). */
  documentCoverage: ContextDocumentCoverage | null;
  audit: {
    expertId: typeof LEGAL_CONSULTANT_EXPERT_ID;
    expertVersion: typeof LEGAL_CONSULTANT_VERSION;
    providerId: string;
    model: string | null;
    scope: ExpertQueryScope;
    projectId: string;
    eventId: string | null;
    question: string;
    generatedAt: string;
    stopReason: string | null;
    usage: { inputTokens: number | null; outputTokens: number | null } | null;
    /** Metadata do guardrail de grounding — somente contagens, nunca o texto completo das afirmações. */
    grounding: {
      performed: boolean;
      valid: boolean;
      supportedClaimCount: number;
      inferredClaimCount: number;
      unsupportedClaimCount: number;
      humanInputRequiredClaimCount: number;
    };
  };
}

/**
 * Responde uma pergunta do usuário ao Consultor Jurídico IA. Somente
 * leitura: monta contexto (buildEventAnalysisContext ou
 * buildProjectAnalysisContext, ambos genéricos e reutilizados) e chama o
 * provider — nunca escreve, nunca envia nada.
 */
export interface LegalConsultantQueryOptions {
  /**
   * Carrega o texto dos documentos contratuais no contexto e EXIGE que
   * exista pelo menos um legivel. Usado pela analise juridica
   * pre-contratual (/{projectId}/juridico): sem contrato lido, a
   * consulta falha explicitamente em vez de produzir uma resposta
   * generica que pareceria fundamentada.
   *
   * Default `false` para nao alterar o comportamento de quem ja
   * chamava esta funcao (ver ai/curation/run-multi-expert-curation.ts).
   */
  requireContractualDocuments?: boolean;
}

export async function answerLegalConsultantQuery(
  supabase: SupabaseClient,
  request: ExpertQueryRequest,
  provider: AiProvider = resolveAiProviderForExpert(LEGAL_CONSULTANT_EXPERT_ID),
  options: LegalConsultantQueryOptions = {}
): Promise<LegalConsultantQueryResult> {
  if (!IMPLEMENTED_SCOPES.includes(request.scope)) {
    throw new Error(
      `Escopo de consulta "${request.scope}" ainda não implementado nesta fase (somente PROJECT e EVENT). ` +
        "Nunca simular suporte a um escopo inexistente."
    );
  }

  const question = request.question.trim();
  if (!question) {
    throw new Error("Pergunta vazia.");
  }

  const eventContext =
    request.scope === "EVENT"
      ? await (async () => {
          if (!request.eventId) {
            throw new Error("eventId é obrigatório para consulta de escopo EVENT.");
          }
          return buildEventAnalysisContext(supabase, { projectId: request.projectId, eventId: request.eventId });
        })()
      : null;

  const projectContext =
    request.scope === "PROJECT"
      ? await buildProjectAnalysisContext(supabase, {
          projectId: request.projectId,
          includeContractualDocuments: options.requireContractualDocuments === true,
        })
      : null;

  // Fail closed: sem conteudo contratual lido, nenhuma consulta e feita.
  // O provider nem chega a ser chamado - o contrario produziria uma
  // resposta apoiada so em metadados, com aparencia de analise juridica.
  if (options.requireContractualDocuments === true && (projectContext?.contractualDocuments.length ?? 0) === 0) {
    throw new ExpertQuerySafeError(
      "Nenhum documento desta analise pode ser lido. Envie o contrato ou a minuta em PDF, DOCX ou TXT com texto selecionavel antes de consultar o especialista juridico."
    );
  }

  const response = await provider.answerQuery({
    expertId: LEGAL_CONSULTANT_EXPERT_ID,
    expertName: LEGAL_CONSULTANT_NAME,
    expertVersion: LEGAL_CONSULTANT_VERSION,
    instructions: LEGAL_CONSULTANT_INSTRUCTIONS,
    scope: request.scope,
    question,
    eventContext,
    projectContext,
    outputSchema:
      options.requireContractualDocuments === true
        ? LEGAL_CONSULTANT_DOCUMENT_QUERY_RESPONSE_JSON_SCHEMA
        : EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
  });

  const validatedBase = validateExpertQueryResponse(response.output, {
    expertId: LEGAL_CONSULTANT_EXPERT_ID,
    expertName: LEGAL_CONSULTANT_NAME,
    expertVersion: LEGAL_CONSULTANT_VERSION,
    // Escopo confiável desta consulta (nunca lido da saída do provider).
    scope: request.scope,
  });
  const validated: ExpertQueryResponse =
    options.requireContractualDocuments === true
      ? {
          ...validatedBase,
          analiseClausulas: validateLegalClauseComparisons(
            (response.output as Record<string, unknown>).analiseClausulas,
            projectContext?.contractualDocuments ?? []
          ),
        }
      : validatedBase;

  // Guardrail de grounding: só roda para o provider real (Anthropic) —
  // ver commentário equivalente em experts/commercial-director/query.ts.
  let finalResponse = validated;
  let groundingAudit = { performed: false, valid: true, supportedClaimCount: 0, inferredClaimCount: 0, unsupportedClaimCount: 0, humanInputRequiredClaimCount: 0 };

  if (response.providerId === "anthropic" && validated.rascunhoSugerido) {
    const draft = validated.rascunhoSugerido;
    const source = buildGroundingSource({
      eventContext,
      projectContext,
      documentedFacts: validated.fatosDocumentados,
      contractualBasis: validated.baseContratual,
      legalCitations: validated.baseLegal,
    });
    const result = validateDraftGrounding(draft.body, source);

    let correctedDraft = draft;
    let draftSuppressed = false;
    let correctionApplied = false;

    if (!result.valid) {
      const correction = applySafeGroundingCorrection(draft.body, result);
      if (correction.stillRequiresRejection) {
        draftSuppressed = true;
      } else {
        correctedDraft = { ...draft, body: correction.correctedBody };
        correctionApplied = true;
      }
    }

    finalResponse = {
      ...validated,
      confidence: adjustConfidenceForGrounding(validated.confidence, result, { draftSuppressed, correctionApplied }),
      rascunhoSugerido: draftSuppressed ? null : correctedDraft,
      informacoesFaltantes: draftSuppressed
        ? [
            ...validated.informacoesFaltantes,
            "Rascunho de comunicação removido pelo guardrail de grounding: continha afirmação sem suporte no contexto fornecido.",
          ]
        : validated.informacoesFaltantes,
      grounding: buildResponseGroundingSummary(result, { correctionApplied, draftSuppressed }),
    };

    groundingAudit = {
      performed: true,
      valid: result.valid,
      supportedClaimCount: result.supportedClaims.length,
      inferredClaimCount: result.inferredClaims.length,
      unsupportedClaimCount: result.unsupportedClaims.length,
      humanInputRequiredClaimCount: result.humanInputRequiredClaims.length,
    };
  } else {
    finalResponse = { ...validated, grounding: NOT_PERFORMED_GROUNDING_SUMMARY };
  }

  return {
    response: finalResponse,
    documentCoverage: projectContext?.documentCoverage ?? null,
    audit: {
      expertId: LEGAL_CONSULTANT_EXPERT_ID,
      expertVersion: LEGAL_CONSULTANT_VERSION,
      providerId: response.providerId,
      model: response.model,
      scope: request.scope,
      projectId: request.projectId,
      eventId: request.eventId ?? null,
      question,
      generatedAt: new Date().toISOString(),
      stopReason: response.stopReason ?? null,
      usage: response.usage ?? null,
      grounding: groundingAudit,
    },
  };
}
