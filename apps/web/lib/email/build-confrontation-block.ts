// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// Estrutura o confronto Evento x Cláusula aprovado em 5 partes claras e
// rastreáveis para o e-mail de alerta — nunca mais um texto genérico tipo
// "Confronto humano aprovado" ou "Possível relação contratual". Cada parte
// vem de um campo estruturado já existente (getEventClauseConfrontationCandidates)
// ou da justificativa humana obrigatória (candidate.reviewNote, validada por
// confrontation-justification-validation.ts antes de chegar aqui) — nunca
// inventado, nunca um valor default fabricado.
//
// Mapeamento (rastreável até a origem):
//   1. O QUE FOI IDENTIFICADO NO EVENTO -> candidate.eventBasis
//   2. O QUE O CONTRATO ESTABELECE      -> candidate.clauseBasis
//   3. CONCLUSÃO DO CONFRONTO           -> candidate.reviewNote (justificativa humana da aprovação)
//   4. POSSÍVEL IMPACTO                 -> candidate.summary (síntese do analisador sobre a implicação do achado)
//   5. APROVADO POR <NOME>              -> reviewerName resolvido via reviewed_by_user_id (nunca sessão/navegador)

import { formatDate } from "@/lib/labels";

export interface ConfrontationBlockSource {
  clauseNumber: string;
  eventBasis: string;
  clauseBasis: string;
  summary: string;
  reviewNote: string; // já validada (não-vazia, não-genérica) pelo caller antes de montar o bloco
  reviewedAt: string | null; // ISO
}

export interface ContractConfrontationBlock {
  clauseNumber: string;
  eventFinding: string;
  contractProvision: string;
  conclusion: string;
  potentialImpact: string;
  approvedByLine: string;
  detailUrl: string;
}

export const UNIDENTIFIED_REVIEWER_LABEL = "APROVADO — REVISOR NÃO IDENTIFICADO";

// `reviewerName` é responsabilidade exclusiva do caller: precisa vir
// resolvido a partir de reviewed_by_user_id via getUser() (fonte canônica
// de profiles) — nunca o usuário da sessão atual, nunca aceito do
// navegador. null cobre tanto reviewed_by_user_id nulo quanto um profile
// que não existe mais: nos dois casos, fallback honesto, nunca um nome
// inventado.
export function buildConfrontationBlock(
  source: ConfrontationBlockSource,
  reviewerName: string | null,
  detailUrl: string
): ContractConfrontationBlock {
  const approvedAtSuffix = source.reviewedAt ? ` em ${formatDate(source.reviewedAt)}` : "";
  const approvedByLine = reviewerName
    ? `APROVADO POR ${reviewerName.toUpperCase()}${approvedAtSuffix}`
    : `${UNIDENTIFIED_REVIEWER_LABEL}${approvedAtSuffix}`;

  return {
    clauseNumber: source.clauseNumber,
    eventFinding: source.eventBasis,
    contractProvision: source.clauseBasis,
    conclusion: source.reviewNote,
    potentialImpact: source.summary,
    approvedByLine,
    detailUrl,
  };
}
