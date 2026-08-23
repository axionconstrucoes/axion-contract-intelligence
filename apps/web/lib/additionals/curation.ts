// Curadoria multiagente para propostas/adicionais (seção "CURADORIA" do
// requisito): Diretor Comercial IA + Diretor de Planejamento IA +
// Consultor Jurídico IA — sempre estes três (nunca ESG, fora do escopo
// de adicionais) — consolidados pelo CEO IA. Reutiliza inteiramente a
// mesma fundação de apps/web/lib/ai/ (query framework + provider +
// grounding) — nunca uma segunda arquitetura de IA. Distinto do roteador
// por palavra-chave de apps/web/lib/ai/curation/ (que serve o Event
// Ledger em geral): aqui os três especialistas SEMPRE são consultados,
// porque o requisito já define explicitamente o remit de cada um para
// este tema, sem precisar de classificação.

import type { SupabaseClient } from "@supabase/supabase-js";
import { answerCommercialDirectorQuery } from "../ai/experts/commercial-director/query";
import { runExecutiveCuration } from "../ai/experts/ceo/consolidate";
import type { ExecutiveCuration } from "../ai/experts/ceo/types";
import { answerLegalConsultantQuery } from "../ai/experts/legal-consultant/query";
import { answerPlanningDirectorQuery } from "../ai/experts/planning-director/query";
import type { OfficialExpertId } from "../ai/expert-definitions/types";
import type { AiProviderExpertPosition } from "../ai/providers/types";
import type { ExpertQueryResponse } from "../ai/query/types";
import type { AdditionalProposal } from "./types";

export interface AdditionalProposalCurationResult {
  proposal: Pick<AdditionalProposal, "id" | "proposalNumber" | "title">;
  expertResults: { expertId: OfficialExpertId; response: ExpertQueryResponse }[];
  executiveCuration: ExecutiveCuration;
}

function buildSituationSummary(proposal: AdditionalProposal): string {
  return (
    `Proposta de adicional ${proposal.proposalNumber} — "${proposal.title}" (status: ${proposal.status}). ` +
    `${proposal.description || "Sem descrição adicional."}`
  );
}

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
 * Executa a curadoria de uma proposta de adicional: Comercial (valor,
 * condição comercial, exposição financeira) + Planejamento (impacto de
 * cronograma, folga, extensão) + Jurídico (escopo base x adicional,
 * formalização, ressalvas) — sempre os três, uma vez cada — e consolida
 * via CEO IA. Somente leitura: nenhuma escrita em
 * project_additional_proposals nem em nenhuma outra tabela.
 */
export async function runAdditionalProposalCuration(
  supabase: SupabaseClient,
  proposal: AdditionalProposal
): Promise<AdditionalProposalCurationResult> {
  const question = buildSituationSummary(proposal);

  const [commercial, planning, legal] = await Promise.all([
    answerCommercialDirectorQuery(supabase, { scope: "PROJECT", projectId: proposal.projectId, question }),
    answerPlanningDirectorQuery(supabase, { scope: "PROJECT", projectId: proposal.projectId, question }),
    answerLegalConsultantQuery(supabase, { scope: "PROJECT", projectId: proposal.projectId, question }),
  ]);

  const expertResults: { expertId: OfficialExpertId; response: ExpertQueryResponse }[] = [
    { expertId: "commercial-director", response: commercial.response },
    { expertId: "planning-director", response: planning.response },
    { expertId: "legal-consultant", response: legal.response },
  ];

  const positions = expertResults.map((r) => toPosition(r.expertId, r.response));
  const { curation } = await runExecutiveCuration(question, positions);

  return {
    proposal: { id: proposal.id, proposalNumber: proposal.proposalNumber, title: proposal.title },
    expertResults,
    executiveCuration: curation,
  };
}
