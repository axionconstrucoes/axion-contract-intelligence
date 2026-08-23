// Saída da curadoria executiva do CEO IA — consolidação de posições já
// produzidas por outros Experts nesta mesma rodada (ver ./consolidate.ts
// e apps/web/lib/ai/curation/). Deliberadamente DISTINTA de
// ExpertAssessment/ExpertQueryResponse: não é uma análise de domínio
// própria, é sempre a consolidação de análises alheias — nunca contém um
// rascunho de comunicação (essa é competência exclusiva dos Experts
// especializados).

import type { ExpertId, ExpertSeverity } from "../../types";

/** Posição de um Expert já consultado, como resumida pelo CEO IA — nunca inventada para um Expert não consultado. */
export interface ExecutiveCurationPosition {
  expertId: ExpertId;
  expertName: string;
  severity: ExpertSeverity;
  summary: string;
}

/**
 * Registro explícito de divergência entre especialistas (seção 10 do
 * requisito de curadoria multiagente) — o CEO IA nunca escolhe um
 * vencedor silenciosamente.
 */
export interface ExecutiveCurationConflict {
  topic: string;
  positions: { expertId: ExpertId; expertName: string; position: string }[];
  probableReason: string;
}

/**
 * Saída completa da consolidação executiva. Ordem dos campos reflete o
 * formato de saída obrigatório do CEO IA (ver identity.ts): SITUAÇÃO →
 * FATOS PRINCIPAIS → POSIÇÕES → DIVERGÊNCIAS → RISCOS → ALTERNATIVAS →
 * RECOMENDAÇÃO → DECISÕES HUMANAS NECESSÁRIAS.
 */
export interface ExecutiveCuration {
  situacao: string;
  fatosPrincipais: string[];
  posicoes: ExecutiveCurationPosition[];
  divergencias: ExecutiveCurationConflict[];
  riscos: string[];
  /** Severidade consolidada — sempre a mais alta entre as posições realmente recebidas, nunca inventada. */
  overallSeverity: ExpertSeverity;
  alternativas: string[];
  recomendacao: string;
  decisoesHumanasNecessarias: string[];
  requiresHumanReview: true;
}
