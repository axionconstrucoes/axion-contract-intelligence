// Orquestra uma consulta conversacional ao Diretor de ESG IA ("Perguntar
// ao Diretor de ESG IA"). Reutiliza o context builder genérico
// (build-event-context.ts / build-project-context.ts, este já estendido
// com esgObligations) sem duplicação — nunca cria um segundo sistema de
// contexto paralelo. Mesmo padrão de
// experts/commercial-director/query.ts.
//
// Escopos suportados nesta fase: PROJECT e EVENT. DOCUMENT, EMAIL e
// MULTI_EXPERT falham explicitamente (fail closed) — nunca simulados.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEventAnalysisContext } from "../../context/build-event-context";
import { buildProjectAnalysisContext } from "../../context/build-project-context";
import { getAiProvider } from "../../providers/get-ai-provider";
import type { AiProvider } from "../../providers/types";
import { validateExpertQueryResponse } from "../../query/validate-expert-query-response";
import type { ExpertQueryRequest, ExpertQueryResponse, ExpertQueryScope } from "../../query/types";
import { deriveFakeEsgQueryEnrichment } from "./fake-esg-query-enrichment";
import {
  ESG_DIRECTOR_EXPERT_ID,
  ESG_DIRECTOR_INSTRUCTIONS,
  ESG_DIRECTOR_NAME,
  ESG_DIRECTOR_VERSION,
} from "./identity";

const IMPLEMENTED_SCOPES: ExpertQueryScope[] = ["PROJECT", "EVENT"];

export interface EsgDirectorQueryResult {
  response: ExpertQueryResponse;
  audit: {
    expertId: typeof ESG_DIRECTOR_EXPERT_ID;
    expertVersion: typeof ESG_DIRECTOR_VERSION;
    providerId: string;
    model: string | null;
    scope: ExpertQueryScope;
    projectId: string;
    eventId: string | null;
    question: string;
    generatedAt: string;
  };
}

/**
 * Responde uma pergunta do usuário ao Diretor de ESG IA. Somente leitura:
 * monta contexto (buildEventAnalysisContext ou buildProjectAnalysisContext,
 * ambos genéricos e reutilizados) e chama o provider — nunca escreve,
 * nunca envia nada, nunca altera status de obrigação/comprovação.
 */
export async function answerEsgDirectorQuery(
  supabase: SupabaseClient,
  request: ExpertQueryRequest,
  provider: AiProvider = getAiProvider()
): Promise<EsgDirectorQueryResult> {
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
    expertId: ESG_DIRECTOR_EXPERT_ID,
    expertName: ESG_DIRECTOR_NAME,
    expertVersion: ESG_DIRECTOR_VERSION,
    instructions: ESG_DIRECTOR_INSTRUCTIONS,
    scope: request.scope,
    question,
    eventContext,
    projectContext,
  });

  let rawOutput: unknown = response.output;

  if (response.providerId === "fake" && typeof response.output === "object" && response.output !== null) {
    const baseOutput = response.output as Record<string, unknown>;
    const enrichment = deriveFakeEsgQueryEnrichment(question, projectContext, eventContext);

    // Concatena com os fatos/riscos genéricos já produzidos pelo provider
    // (ex.: derivados de eventContext) — nunca substitui, apenas soma o
    // que é específico de ESG/SSMA. Um spread simples aqui apagaria os
    // fatos do evento em consultas de escopo EVENT (onde a parte
    // ESG-específica fica vazia, já que obrigações são de nível PROJECT).
    rawOutput = {
      ...baseOutput,
      fatosDocumentados: [
        ...(Array.isArray(baseOutput.fatosDocumentados) ? baseOutput.fatosDocumentados : []),
        ...enrichment.fatosDocumentados,
      ],
      riscos: [...(Array.isArray(baseOutput.riscos) ? baseOutput.riscos : []), ...enrichment.riscos],
      acoesSugeridas: enrichment.acoesSugeridas,
      rascunhoSugerido: enrichment.rascunhoSugerido,
    };
  }

  const validated = validateExpertQueryResponse(rawOutput, {
    expertId: ESG_DIRECTOR_EXPERT_ID,
    expertName: ESG_DIRECTOR_NAME,
    expertVersion: ESG_DIRECTOR_VERSION,
  });

  return {
    response: validated,
    audit: {
      expertId: ESG_DIRECTOR_EXPERT_ID,
      expertVersion: ESG_DIRECTOR_VERSION,
      providerId: response.providerId,
      model: response.model,
      scope: request.scope,
      projectId: request.projectId,
      eventId: request.eventId ?? null,
      question,
      generatedAt: new Date().toISOString(),
    },
  };
}
