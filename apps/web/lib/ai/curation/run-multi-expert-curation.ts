// Orquestrador da fundação de curadoria IA multiagente (seção 5 do
// requisito): SOURCE → ROUTER → SPECIALIST(S) → NORMALIZAÇÃO → CEO IA →
// HUMANO. Máximo uma rodada de especialistas + uma consolidação CEO
// nesta fase (seção 9) — nunca uma conversa infinita agente↔agente.
// Nenhum scheduler é criado aqui — chamado sempre sob demanda (script,
// Server Action ou teste).

import type { SupabaseClient } from "@supabase/supabase-js";
import { answerCommercialDirectorQuery } from "../experts/commercial-director/query";
import { runExecutiveCuration } from "../experts/ceo/consolidate";
import { answerEsgDirectorQuery } from "../experts/esg-director/query";
import { answerLegalConsultantQuery } from "../experts/legal-consultant/query";
import { answerPlanningDirectorQuery } from "../experts/planning-director/query";
import type { OfficialExpertId } from "../expert-definitions/types";
import type { AiProviderExpertPosition } from "../providers/types";
import type { ExpertQueryResponse, ExpertQueryScope } from "../query/types";
import { decideExpertRouting } from "./route-experts";
import type { CurationInput, ExpertCurationResult, MultiExpertCuration } from "./types";

/**
 * Um Expert por scope de consulta — usada para executar cada Expert
 * roteado sem duplicar a lógica de "monta contexto e chama o provider"
 * (essa lógica já vive inteira dentro de cada answerXQuery). "ceo" nunca
 * aparece aqui: o CEO IA nunca é executado como especialista nesta
 * rodada — ele é sempre a consolidação final (ver runExecutiveCuration).
 */
const SPECIALIST_QUERY_FUNCTIONS: Partial<
  Record<
    OfficialExpertId,
    (
      supabase: SupabaseClient,
      request: { scope: ExpertQueryScope; projectId: string; eventId?: string; question: string }
    ) => Promise<{ response: ExpertQueryResponse }>
  >
> = {
  "commercial-director": answerCommercialDirectorQuery,
  "esg-director": answerEsgDirectorQuery,
  "legal-consultant": answerLegalConsultantQuery,
  "planning-director": answerPlanningDirectorQuery,
};

function toPosition(expertId: OfficialExpertId, response: ExpertQueryResponse): AiProviderExpertPosition {
  return {
    expertId,
    expertName: response.expertName,
    severity: response.severity,
    interpretacao: response.interpretacao,
    riscos: response.riscos,
    recomendacoes: response.recomendacoes,
    informacoesFaltantes: response.informacoesFaltantes,
  };
}

/**
 * Executa uma rodada completa de curadoria multiagente para `input`:
 * roteia, executa cada Expert especializado roteado (uma única vez cada
 * — nunca em loop, nunca reexecutado), normaliza as posições e consolida
 * via CEO IA. `expertResults` reflete exatamente quem foi consultado —
 * nunca inclui um Expert que a rota não selecionou.
 */
export async function runMultiExpertCuration(supabase: SupabaseClient, input: CurationInput): Promise<MultiExpertCuration> {
  const routing = await decideExpertRouting(supabase, input);

  const routedExpertIds = Array.from(new Set([...routing.primaryExpertIds, ...routing.supportingExpertIds])).filter(
    (expertId): expertId is Exclude<OfficialExpertId, "ceo"> => expertId !== "ceo"
  );

  const scope: ExpertQueryScope = input.eventId ? "EVENT" : "PROJECT";
  const question = input.description;

  const expertResults: ExpertCurationResult[] = [];
  for (const expertId of routedExpertIds) {
    const queryFn = SPECIALIST_QUERY_FUNCTIONS[expertId];
    if (!queryFn) continue;

    const result = await queryFn(supabase, {
      scope,
      projectId: input.projectId,
      eventId: input.eventId,
      question,
    });
    expertResults.push({ expertId, response: result.response });
  }

  const positions = expertResults.map((result) => toPosition(result.expertId, result.response));
  const { curation } = await runExecutiveCuration(input.description, positions);

  return {
    input,
    routing,
    expertResults,
    executiveCuration: curation,
    audit: {
      projectId: input.projectId,
      eventId: input.eventId ?? null,
      topic: routing.topic,
      consultedExpertIds: expertResults.map((r) => r.expertId),
      generatedAt: new Date().toISOString(),
    },
  };
}
