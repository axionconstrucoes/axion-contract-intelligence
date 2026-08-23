// Orquestra o confronto de uma fonte do cliente (RECEBIDOS CLIENTE /
// planilha do cliente) contra o contrato-base — seção 5/6 do requisito.
// Reutiliza generateAssessment (mesma chamada já usada pelo Diretor
// Comercial IA) — nunca uma segunda arquitetura de chamada de IA.
// Somente leitura: nunca escreve em contract_events/documents; quem
// persiste o resultado como finding é ../findings/persist-finding.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventAnalysisContext } from "../../ai/context/types";
import { LEGAL_CONSULTANT_EXPERT_ID, LEGAL_CONSULTANT_NAME } from "../../ai/experts/legal-consultant/identity";
import { resolveAiProviderForExpert } from "../../ai/providers/resolve-provider-for-expert";
import type { AiProvider } from "../../ai/providers/types";
import { getContractBaseClauses } from "./get-contract-base-clauses";
import { CLIENT_SOURCE_CONFRONTATION_INSTRUCTIONS, CLIENT_SOURCE_CONFRONTATION_VERSION } from "./identity";
import { CLIENT_SOURCE_CONFRONTATION_JSON_SCHEMA } from "./json-schema";
import { validateClientSourceConfrontation } from "./schema";
import type { ClientSourceConfrontation } from "./types";

export interface RunClientSourceConfrontationInput {
  projectId: string;
  /** Rótulo do que está sendo confrontado — ex.: "Planilha de quantitativos do cliente — AXN CP 621". */
  sourceLabel: string;
  /** Conteúdo/resumo real da fonte do cliente — nunca o binário do arquivo, sempre texto já extraído. */
  sourceSummary: string;
}

export interface ClientSourceConfrontationResult {
  confrontation: ClientSourceConfrontation;
  audit: {
    expertId: typeof LEGAL_CONSULTANT_EXPERT_ID;
    expertVersion: typeof CLIENT_SOURCE_CONFRONTATION_VERSION;
    providerId: string;
    model: string | null;
    projectId: string;
    generatedAt: string;
  };
}

export async function runClientSourceConfrontation(
  supabase: SupabaseClient,
  input: RunClientSourceConfrontationInput,
  provider: AiProvider = resolveAiProviderForExpert(LEGAL_CONSULTANT_EXPERT_ID)
): Promise<ClientSourceConfrontationResult> {
  const relatedClauses = await getContractBaseClauses(supabase, input.projectId);

  const context: EventAnalysisContext = {
    projectId: input.projectId,
    eventId: `client-source-confrontation:${input.sourceLabel}`,
    focusCandidateId: null,
    event: {
      id: `client-source-confrontation:${input.sourceLabel}`,
      projectId: input.projectId,
      title: `Confronto de fonte do cliente — ${input.sourceLabel}`,
      description: input.sourceSummary,
      occurredAt: new Date().toISOString(),
      sourceType: "CONTRATO",
      status: "NOVO",
    },
    evidence: [],
    relatedClauses,
    relatedEmails: [],
    confrontationCandidates: [],
    eventNotes: [],
  };

  const response = await provider.generateAssessment({
    expertId: LEGAL_CONSULTANT_EXPERT_ID,
    expertName: LEGAL_CONSULTANT_NAME,
    expertVersion: CLIENT_SOURCE_CONFRONTATION_VERSION,
    instructions: CLIENT_SOURCE_CONFRONTATION_INSTRUCTIONS,
    analysisType: "CLIENT_SOURCE_CONFRONTATION",
    context,
    outputSchema: CLIENT_SOURCE_CONFRONTATION_JSON_SCHEMA,
  });

  // O fake provider nunca produz interpretação real (ver
  // providers/fake-provider.ts) — classification é sempre INDETERMINATE,
  // nunca uma classificação real inventada por lógica determinística.
  const rawOutput =
    response.providerId === "fake" && typeof response.output === "object" && response.output !== null
      ? {
          ...(response.output as Record<string, unknown>),
          confrontation: { classification: "INDETERMINATE", precedenceFound: false, precedenceSummary: null },
        }
      : response.output;

  const confrontation = validateClientSourceConfrontation(rawOutput, {
    expertId: LEGAL_CONSULTANT_EXPERT_ID,
    expertName: LEGAL_CONSULTANT_NAME,
    expertVersion: CLIENT_SOURCE_CONFRONTATION_VERSION,
  });

  return {
    confrontation,
    audit: {
      expertId: LEGAL_CONSULTANT_EXPERT_ID,
      expertVersion: CLIENT_SOURCE_CONFRONTATION_VERSION,
      providerId: response.providerId,
      model: response.model,
      projectId: input.projectId,
      generatedAt: new Date().toISOString(),
    },
  };
}
