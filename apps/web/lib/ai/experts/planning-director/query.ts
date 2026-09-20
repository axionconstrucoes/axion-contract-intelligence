// Orquestra uma consulta conversacional ao Diretor de Planejamento IA
// ("Perguntar ao Diretor de Planejamento IA"). Reutiliza o context
// builder genérico sem duplicação — nunca cria um segundo sistema de
// contexto paralelo. Mesmo padrão de
// experts/commercial-director/query.ts e experts/legal-consultant/query.ts.
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
import { resolveAiProviderForExpert } from "../../providers/resolve-provider-for-expert";
import type { AiProvider } from "../../providers/types";
import { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } from "../../query/json-schema";
import { validateExpertQueryResponse } from "../../query/validate-expert-query-response";
import type { ExpertQueryRequest, ExpertQueryResponse, ExpertQueryScope } from "../../query/types";
import {
  PLANNING_DIRECTOR_EXPERT_ID,
  PLANNING_DIRECTOR_INSTRUCTIONS,
  PLANNING_DIRECTOR_NAME,
  PLANNING_DIRECTOR_VERSION,
} from "./identity";
import {
  isFormalScheduleAssessmentQuestion,
  resolveScheduleSourceStatus,
  scheduleSourceBlockingMessage,
} from "./schedule-source-guard";
import { loadExtractedScheduleContext } from "./schedule-context";

const IMPLEMENTED_SCOPES: ExpertQueryScope[] = ["PROJECT", "EVENT"];

export interface PlanningDirectorQueryResult {
  response: ExpertQueryResponse;
  audit: {
    expertId: typeof PLANNING_DIRECTOR_EXPERT_ID;
    expertVersion: typeof PLANNING_DIRECTOR_VERSION;
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
 * Responde uma pergunta do usuário ao Diretor de Planejamento IA.
 * Somente leitura: monta contexto (buildEventAnalysisContext ou
 * buildProjectAnalysisContext, ambos genéricos e reutilizados) e chama o
 * provider — nunca escreve, nunca envia nada, nunca altera cronograma.
 */
export async function answerPlanningDirectorQuery(
  supabase: SupabaseClient,
  request: ExpertQueryRequest,
  provider: AiProvider = resolveAiProviderForExpert(PLANNING_DIRECTOR_EXPERT_ID)
): Promise<PlanningDirectorQueryResult> {
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

  // Avaliação formal de prazo/cronograma é fail-closed. O arquivo oficial
  // precisa ser um Microsoft Project .mpp REAL (extensão do original, não
  // apenas um kind atribuído manualmente). Nesta fase o MPP é armazenado,
  // mas ainda não possui extração estruturada; por isso, mesmo quando
  // localizado, não chamamos o modelo para inventar atividades/vínculos.
  const isFormalScheduleAssessment =
    isFormalScheduleAssessmentQuestion(question);

  let scheduleContext = null;

  if (isFormalScheduleAssessment) {
    const scheduleSourceStatus = await resolveScheduleSourceStatus(
      supabase,
      request.projectId
    );

    if (scheduleSourceStatus !== "MPP_EXTRACTED") {
      throw new Error(scheduleSourceBlockingMessage(scheduleSourceStatus));
    }

    scheduleContext = await loadExtractedScheduleContext(
      supabase,
      request.projectId
    );

    if (!scheduleContext || scheduleContext.versions.length === 0) {
      throw new Error(
        "Cronograma MPP marcado como extraido, mas os dados estruturados nao puderam ser carregados."
      );
    }
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
    request.scope === "PROJECT" ? await buildProjectAnalysisContext(supabase, { projectId: request.projectId }) : null;

  const eventContextWithSchedule = eventContext
    ? { ...eventContext, schedule: scheduleContext }
    : null;

  const projectContextWithSchedule = projectContext
    ? { ...projectContext, schedule: scheduleContext }
    : null;

  const response = await provider.answerQuery({
    expertId: PLANNING_DIRECTOR_EXPERT_ID,
    expertName: PLANNING_DIRECTOR_NAME,
    expertVersion: PLANNING_DIRECTOR_VERSION,
    instructions: PLANNING_DIRECTOR_INSTRUCTIONS,
    scope: request.scope,
    question,
    eventContext: eventContextWithSchedule,
    projectContext: projectContextWithSchedule,
    outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
  });

  const validated = validateExpertQueryResponse(response.output, {
    expertId: PLANNING_DIRECTOR_EXPERT_ID,
    expertName: PLANNING_DIRECTOR_NAME,
    expertVersion: PLANNING_DIRECTOR_VERSION,
    // Escopo confiável desta consulta (nunca lido da saída do provider).
    scope: request.scope,
  });

  // Resumo estrutural determinístico do MPP: quando o contexto estruturado
  // está presente, a resposta sempre informa contagem de atividades e
  // relações, independentemente de o provider mencionar esses números.
  // Isso evita omissões em perguntas de resumo e mantém a informação
  // diretamente ancorada nos dados já carregados do banco.
  const scheduleSummaryFact = scheduleContext
    ? (() => {
        const activityCount = scheduleContext.versions.reduce(
          (total, version) => total + version.activities.length,
          0
        );
        const relationCount = scheduleContext.versions.reduce(
          (total, version) => total + version.relations.length,
          0
        );
        return `Cronograma MPP estruturado: ${activityCount} atividades e ${relationCount} relações de precedência extraídas.`;
      })()
    : null;

  const validatedWithScheduleSummary = scheduleSummaryFact
    ? {
        ...validated,
        fatosDocumentados: [
          scheduleSummaryFact,
          ...validated.fatosDocumentados.filter(
            (fact) => !/atividades e .*relações de precedência extraídas/i.test(fact)
          ),
        ],
      }
    : validated;

  // Guardrail de grounding: só roda para o provider real (Anthropic) —
  // ver commentário equivalente em experts/commercial-director/query.ts.
  let finalResponse = validatedWithScheduleSummary;
  let groundingAudit = { performed: false, valid: true, supportedClaimCount: 0, inferredClaimCount: 0, unsupportedClaimCount: 0, humanInputRequiredClaimCount: 0 };

  if (response.providerId === "anthropic" && validatedWithScheduleSummary.rascunhoSugerido) {
    const draft = validatedWithScheduleSummary.rascunhoSugerido;
    const source = buildGroundingSource({
      eventContext: eventContextWithSchedule,
      projectContext: projectContextWithSchedule,
      documentedFacts: validatedWithScheduleSummary.fatosDocumentados,
      contractualBasis: validatedWithScheduleSummary.baseContratual,
      legalCitations: validatedWithScheduleSummary.baseLegal,
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
      ...validatedWithScheduleSummary,
      confidence: adjustConfidenceForGrounding(validatedWithScheduleSummary.confidence, result, { draftSuppressed, correctionApplied }),
      rascunhoSugerido: draftSuppressed ? null : correctedDraft,
      informacoesFaltantes: draftSuppressed
        ? [
            ...validatedWithScheduleSummary.informacoesFaltantes,
            "Rascunho de comunicação removido pelo guardrail de grounding: continha afirmação sem suporte no contexto fornecido.",
          ]
        : validatedWithScheduleSummary.informacoesFaltantes,
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
    finalResponse = { ...validatedWithScheduleSummary, grounding: NOT_PERFORMED_GROUNDING_SUMMARY };
  }

  return {
    response: finalResponse,
    audit: {
      expertId: PLANNING_DIRECTOR_EXPERT_ID,
      expertVersion: PLANNING_DIRECTOR_VERSION,
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
