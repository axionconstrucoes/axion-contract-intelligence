// Puro, sem I/O — aviso mostrado ANTES de enviar um alerta (e ao criar/editar uma providência):
// grau efetivo, de onde ele vem (IA ainda não revisada × revisado por pessoa autorizada) e, quando
// faltam dados para distinguir os níveis pelos critérios, o que precisa ser confirmado.
//
// Usa a MESMA sugestão determinística da revisão (suggestRisk) com os fatos que o ACC já tem
// (cláusula aprovada, evidências, prazo da providência). O que só uma pessoa sabe (natureza,
// iminência, tempo para mitigação) fica "desconhecido": o aviso nunca cria certeza e nunca altera
// a classificação — ela só muda pela revisão com justificativa e histórico.

import type { AlertSeverity } from "@axion/types";

import { buildRiskFacts, parseRiskReviewForm } from "./facts-builders";
import { RISK_LEVEL_LABEL, suggestRisk, type RiskSuggestion, type SourceRef, type DeadlineStatus } from "./suggest-risk";

export interface PreSendRiskInput {
  currentLevel: AlertSeverity | null;
  originalLevel: AlertSeverity | null;
  /** Há revisão humana registrada (histórico não vazio). */
  hasHumanReview: boolean;
  verifiedClause: SourceRef | null;
  obligationDescription: string | null;
  evidence: SourceRef[];
  deadline: { status: DeadlineStatus; date: string | null; ref: SourceRef | null };
}

export interface PreSendRiskNotice {
  currentLevel: AlertSeverity | null;
  currentLabel: string | null;
  origin: "REVISADA_POR_PESSOA" | "CLASSIFICACAO_AUTOMATICA";
  suggestion: RiskSuggestion;
  /** Pede conferência humana antes do envio (grau ainda não revisado por pessoa autorizada). */
  needsConfirmation: boolean;
  headline: string;
  missingInformation: string[];
}

export function buildPreSendRiskNotice(input: PreSendRiskInput): PreSendRiskNotice {
  // Nada declarado: natureza/iminência/mitigação ficam desconhecidas (nunca assumidas).
  const form = parseRiskReviewForm({ deadlineStatus: input.deadline.status, deadlineDate: input.deadline.date });
  const suggestion = suggestRisk(
    buildRiskFacts({
      form,
      verifiedClause: input.verifiedClause,
      obligationDescription: input.obligationDescription,
      evidence: input.evidence,
      deadlineRef: input.deadline.ref,
    })
  );
  const origin = input.hasHumanReview ? "REVISADA_POR_PESSOA" : "CLASSIFICACAO_AUTOMATICA";
  const currentLabel = input.currentLevel ? RISK_LEVEL_LABEL[input.currentLevel] : null;
  // Já revisada por pessoa autorizada: a decisão existe (com justificativa e histórico). Sem revisão: pede conferência.
  const needsConfirmation = !input.hasHumanReview;
  const where =
    origin === "REVISADA_POR_PESSOA"
      ? "revisada por pessoa autorizada"
      : "classificação automática, ainda não revisada por pessoa autorizada";
  const headline = currentLabel
    ? `Grau de risco atual: ${currentLabel} (${where}).`
    : "Grau de risco ainda não definido.";
  return {
    currentLevel: input.currentLevel,
    currentLabel,
    origin,
    suggestion,
    needsConfirmation,
    headline,
    missingInformation: needsConfirmation ? suggestion.missingInformation : [],
  };
}
