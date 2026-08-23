// Cards ADITIVOS CONTRATUAIS (seção 13) e VALOR CONTRATUAL (seção 11) —
// a única fonte real de instrumentos que alteram valor contratual é
// project_additional_proposals com status=CONTRACTED E
// formalizationType=ADITIVO_CONTRATUAL (as demais formas de formalização
// — e-mail de aprovação, PO, ordem de serviço etc. — são contratações
// reais mas não instrumentos de "aditivo contratual" propriamente
// ditos). Possível/em análise/em negociação/proposta pendente NUNCA
// entram aqui (seção 11: "Adicional possível/em análise/em negociação
// NÃO entra").
//
// Não existe, em nenhuma tabela do banco hoje, um valor de
// "contrato-base" nem um "valor contratual vigente" — por isso o total
// acumulado (que dependeria da base) é sempre NÃO DISPONÍVEL aqui; só o
// acréscimo/redução formalizado pelos aditivos é real e mostrado.
//
// Puro, sem I/O.

import type { AdditionalProposal } from "@/lib/additionals/types";

export interface FormalizedAditivo {
  proposalId: string;
  proposalNumber: string;
  title: string;
  contractedAt: string;
  contractedValue: number;
}

function isFormalizedAditivoContratual(proposal: AdditionalProposal): proposal is AdditionalProposal & {
  contractedAt: string;
  contractedValue: number;
} {
  return (
    proposal.status === "CONTRACTED" &&
    proposal.formalizationType === "ADITIVO_CONTRATUAL" &&
    proposal.contractedValue !== null &&
    proposal.contractedAt !== null
  );
}

export function selectFormalizedAditivos(proposals: AdditionalProposal[]): FormalizedAditivo[] {
  return proposals
    .filter(isFormalizedAditivoContratual)
    .map((p) => ({
      proposalId: p.id,
      proposalNumber: p.proposalNumber,
      title: p.title,
      contractedAt: p.contractedAt,
      contractedValue: p.contractedValue,
    }))
    .sort((a, b) => new Date(a.contractedAt).getTime() - new Date(b.contractedAt).getTime());
}

export interface AditivosContratuaisSummary {
  quantity: number;
  netValue: number;
  lastAditivo: FormalizedAditivo | null;
}

export function computeAditivosContratuaisSummary(aditivos: FormalizedAditivo[]): AditivosContratuaisSummary {
  const netValue = aditivos.reduce((sum, a) => sum + a.contractedValue, 0);
  const lastAditivo = aditivos.length > 0 ? aditivos[aditivos.length - 1] : null;
  return { quantity: aditivos.length, netValue, lastAditivo };
}

export interface ContractValueInstrumentRow {
  instrument: string;
  date: string | null;
  description: string;
  /** null = NÃO DISPONÍVEL (contrato-base, sem valor modelado). */
  changeValue: number | null;
  proposalId: string | null;
}

export interface ContractValueTable {
  rows: ContractValueInstrumentRow[];
  /** Soma real dos acréscimos/reduções dos aditivos formalizados — nunca inclui a base (desconhecida). */
  totalAditivosChange: number;
}

/**
 * Monta a tabela do requisito (seção 11): "Contrato Base" primeiro (sem
 * valor — nunca inventado), depois um Aditivo NN por linha em ordem
 * cronológica. "TOTAL CONTRATUAL VIGENTE" não é calculado aqui — o
 * caller deve exibi-lo como NÃO DISPONÍVEL, já que depende do valor-base
 * inexistente.
 */
export function buildContractValueTable(aditivos: FormalizedAditivo[], projectStartDate: string | null): ContractValueTable {
  const rows: ContractValueInstrumentRow[] = [
    { instrument: "Contrato Base", date: projectStartDate, description: "Contrato base", changeValue: null, proposalId: null },
    ...aditivos.map((a, index) => ({
      instrument: `Aditivo ${String(index + 1).padStart(2, "0")}`,
      date: a.contractedAt,
      description: a.title,
      changeValue: a.contractedValue,
      proposalId: a.proposalId,
    })),
  ];

  const totalAditivosChange = aditivos.reduce((sum, a) => sum + a.contractedValue, 0);
  return { rows, totalAditivosChange };
}
