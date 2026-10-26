// Despachante servidor: especialidade → Expert JÁ existente (provider, grounding e validação
// continuam os do Expert). Somente leitura; a chave do provider vive só no servidor.

import type { SupabaseClient } from "@supabase/supabase-js";

import { ExpertQuerySafeError } from "../expert-query-request";
import { answerEsgDirectorQuery } from "../experts/esg-director/query";
import { answerLegalConsultantQuery } from "../experts/legal-consultant/query";
import { answerPlanningDirectorQuery } from "../experts/planning-director/query";
import { scheduleSourceBlockingMessage } from "../experts/planning-director/schedule-source-guard";
import type { AiProvider } from "../providers/types";
import type { ExpertQueryRequest, ExpertQueryResponse } from "../query/types";
import type { ExpertId } from "../types";

export interface AlertConsultExpertRun {
  response: ExpertQueryResponse;
  audit: { providerId: string; model: string | null };
}

// Mensagens de bloqueio do guard de prazo são redigidas para a tela — podem ser exibidas.
const PLANNING_BLOCKING_MESSAGES: readonly string[] = [
  scheduleSourceBlockingMessage("MISSING_MPP"),
  scheduleSourceBlockingMessage("MPP_PRESENT_NOT_EXTRACTED"),
];

/**
 * `provider` só é informado por testes (provedor simulado); em produção cada Expert resolve o seu
 * (resolveAiProviderForExpert) — nunca um fallback silencioso para "fake" por erro de configuração.
 */
export async function runAlertConsultExpert(
  supabase: SupabaseClient,
  expertId: ExpertId,
  request: ExpertQueryRequest,
  userQuestion: string,
  provider?: AiProvider
): Promise<AlertConsultExpertRun> {
  switch (expertId) {
    case "legal-consultant":
      return answerLegalConsultantQuery(supabase, request, provider);
    case "esg-director":
      return answerEsgDirectorQuery(supabase, request, provider);
    case "planning-director":
      try {
        return await answerPlanningDirectorQuery(supabase, request, provider, { guardQuestion: userQuestion });
      } catch (error) {
        if (error instanceof Error && PLANNING_BLOCKING_MESSAGES.includes(error.message)) {
          throw new ExpertQuerySafeError(error.message);
        }
        throw error;
      }
    default:
      // commercial-director/ceo não são especialidades desta caixa — nunca simular.
      throw new Error(`Especialista "${expertId}" não disponível para consulta de alertas.`);
  }
}
