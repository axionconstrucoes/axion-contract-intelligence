// Card ADICIONAIS (seção 13) — contagem por status real do pipeline de
// project_additional_proposals. "Contratados com formalização pendente"
// é um subconjunto de CONTRACTED (documentalState), nunca um status
// próprio inventado.
//
// Puro, sem I/O.

import type { AdditionalProposal } from "@/lib/additionals/types";

export interface AdditionalProposalsSummary {
  possible: number;
  underAnalysis: number;
  inNegotiation: number;
  contracted: number;
  contractedWithPendingFormalization: number;
}

export function computeAdditionalProposalsSummary(proposals: AdditionalProposal[]): AdditionalProposalsSummary {
  let possible = 0;
  let underAnalysis = 0;
  let inNegotiation = 0;
  let contracted = 0;
  let contractedWithPendingFormalization = 0;

  for (const proposal of proposals) {
    if (proposal.status === "POSSIBLE_ADDITIONAL") possible += 1;
    else if (proposal.status === "UNDER_ANALYSIS") underAnalysis += 1;
    else if (proposal.status === "IN_NEGOTIATION") inNegotiation += 1;
    else if (proposal.status === "CONTRACTED") {
      contracted += 1;
      if (proposal.documentalState === "CONTRATADO_DOCUMENTACAO_PENDENTE") contractedWithPendingFormalization += 1;
    }
  }

  return { possible, underAnalysis, inNegotiation, contracted, contractedWithPendingFormalization };
}
