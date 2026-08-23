// Orquestra uma consulta conversacional individual ao CEO IA ("Perguntar
// ao CEO IA") — distinta da consolidação multi-Expert (ver
// ./consolidate.ts e apps/web/lib/ai/curation/). Reutiliza o context
// builder genérico sem duplicação, mesmo padrão de
// experts/commercial-director/query.ts.
//
// Escopos suportados nesta fase: PROJECT e EVENT. DOCUMENT, EMAIL e
// MULTI_EXPERT falham explicitamente (fail closed) — nunca simulados.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEventAnalysisContext } from "../../context/build-event-context";
import { buildProjectAnalysisContext } from "../../context/build-project-context";
import { resolveAiProviderForExpert } from "../../providers/resolve-provider-for-expert";
import type { AiProvider } from "../../providers/types";
import { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } from "../../query/json-schema";
import { validateExpertQueryResponse } from "../../query/validate-expert-query-response";
import type { ExpertQueryRequest, ExpertQueryResponse, ExpertQueryScope } from "../../query/types";
import { CEO_EXPERT_ID, CEO_INSTRUCTIONS, CEO_NAME, CEO_VERSION } from "./identity";

const IMPLEMENTED_SCOPES: ExpertQueryScope[] = ["PROJECT", "EVENT"];

export interface CeoQueryResult {
  response: ExpertQueryResponse;
  audit: {
    expertId: typeof CEO_EXPERT_ID;
    expertVersion: typeof CEO_VERSION;
    providerId: string;
    model: string | null;
    scope: ExpertQueryScope;
    projectId: string;
    eventId: string | null;
    question: string;
    generatedAt: string;
    stopReason: string | null;
    usage: { inputTokens: number | null; outputTokens: number | null } | null;
  };
}

/**
 * Responde uma pergunta pontual do usuário ao CEO IA — sem consolidar
 * outros Experts (ver runExecutiveCuration para isso). Somente leitura:
 * monta contexto e chama o provider. O CEO IA nunca produz rascunho de
 * comunicação, então nenhum guardrail de grounding de draft se aplica
 * aqui (rascunhoSugerido é sempre validado/aceito como null nesta
 * consulta — ver schema genérico em query/validate-expert-query-response.ts).
 */
export async function answerCeoQuery(
  supabase: SupabaseClient,
  request: ExpertQueryRequest,
  provider: AiProvider = resolveAiProviderForExpert(CEO_EXPERT_ID)
): Promise<CeoQueryResult> {
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
    request.scope === "PROJECT" ? await buildProjectAnalysisContext(supabase, { projectId: request.projectId }) : null;

  const response = await provider.answerQuery({
    expertId: CEO_EXPERT_ID,
    expertName: CEO_NAME,
    expertVersion: CEO_VERSION,
    instructions: CEO_INSTRUCTIONS,
    scope: request.scope,
    question,
    eventContext,
    projectContext,
    outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
  });

  const validated = validateExpertQueryResponse(response.output, {
    expertId: CEO_EXPERT_ID,
    expertName: CEO_NAME,
    expertVersion: CEO_VERSION,
  });

  return {
    response: validated,
    audit: {
      expertId: CEO_EXPERT_ID,
      expertVersion: CEO_VERSION,
      providerId: response.providerId,
      model: response.model,
      scope: request.scope,
      projectId: request.projectId,
      eventId: request.eventId ?? null,
      question,
      generatedAt: new Date().toISOString(),
      stopReason: response.stopReason ?? null,
      usage: response.usage ?? null,
    },
  };
}
