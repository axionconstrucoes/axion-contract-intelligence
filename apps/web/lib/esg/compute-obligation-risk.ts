// Regras determinísticas de risco (seção 12/13/14) — SEMPRE calculadas
// antes/independentemente de qualquer IA. O Diretor de ESG IA complementa
// a interpretação, mas nunca substitui este cálculo objetivo, e nenhum
// Expert pode alterar o resultado sozinho.
//
// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
// `today` é sempre injetado pelo caller (nunca `new Date()` aqui dentro),
// para manter o cálculo determinístico e testável.

import type { EsgObligationStatus, EsgRiskLevel } from "./types";

const RISK_RANK: Record<EsgRiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function higher(a: EsgRiskLevel, b: EsgRiskLevel): EsgRiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

const NEAR_DUE_WINDOW_DAYS = 7;

export interface ComputeObligationRiskInput {
  status: EsgObligationStatus;
  /** ISO date (yyyy-mm-dd) — null quando a obrigação não tem prazo aplicável a este registro. */
  dueDate: string | null;
  /** ISO date (yyyy-mm-dd) — data de referência usada como "hoje" para o cálculo; sempre injetada pelo caller. */
  today: string;
  /** Se esta obrigação exige evidência (required_evidence_description preenchido na configuração). */
  requiresEvidence: boolean;
  evidenceCount: number;
  /** Se a obrigação tem penalidade contratual conhecida/descrita. */
  hasPenaltyDescribed: boolean;
  /** Risco do registro anterior desta mesma obrigação, para considerar reincidência (seção 14) — null quando não há histórico. */
  previousRiskLevel: EsgRiskLevel | null;
}

export interface ObligationRiskResult {
  riskLevel: EsgRiskLevel;
  /** Motivos legíveis do cálculo — nunca uma "caixa-preta", sempre rastreável. */
  reasons: string[];
}

function daysUntil(dueDate: string, today: string): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((due - now) / 86_400_000);
}

export function computeObligationRisk(input: ComputeObligationRiskInput): ObligationRiskResult {
  const reasons: string[] = [];

  if (input.status === "NAO_APLICAVEL" || input.status === "DISPENSADO") {
    return { riskLevel: "LOW", reasons: ["Obrigação dispensada/não aplicável, com justificativa registrada."] };
  }

  const daysToDue = input.dueDate ? daysUntil(input.dueDate, input.today) : null;
  const isOverdue = daysToDue !== null && daysToDue < 0;
  const isNearDue = daysToDue !== null && daysToDue >= 0 && daysToDue <= NEAR_DUE_WINDOW_DAYS;
  const missingRequiredEvidence = input.requiresEvidence && input.evidenceCount === 0;

  let risk: EsgRiskLevel;

  switch (input.status) {
    case "CUMPRIDO":
      if (missingRequiredEvidence) {
        risk = "MEDIUM";
        reasons.push("Status CUMPRIDO, mas a evidência obrigatória não foi anexada.");
      } else {
        risk = "LOW";
        reasons.push("Status CUMPRIDO com evidência obrigatória presente.");
      }
      break;
    case "CUMPRIDO_PARCIALMENTE":
      risk = missingRequiredEvidence ? "HIGH" : "MEDIUM";
      reasons.push("Cumprimento parcial registrado.");
      if (missingRequiredEvidence) reasons.push("Evidência obrigatória não foi anexada.");
      break;
    case "PENDENTE":
      if (isOverdue) {
        risk = "HIGH";
        reasons.push(`Obrigação pendente e com prazo vencido há ${Math.abs(daysToDue!)} dia(s).`);
      } else if (isNearDue) {
        risk = "MEDIUM";
        reasons.push(`Obrigação pendente, prazo em ${daysToDue} dia(s).`);
      } else {
        risk = "LOW";
        reasons.push("Obrigação pendente, sem proximidade de prazo.");
      }
      break;
    case "NAO_CUMPRIDO":
      risk = input.hasPenaltyDescribed ? "CRITICAL" : "HIGH";
      reasons.push("Obrigação registrada como não cumprida.");
      if (input.hasPenaltyDescribed) reasons.push("Penalidade contratual conhecida para esta obrigação.");
      break;
    default:
      risk = "LOW";
  }

  if (isOverdue && RISK_RANK[risk] < RISK_RANK.HIGH) {
    risk = "HIGH";
    reasons.push("Prazo vencido.");
  }

  if (input.previousRiskLevel && (input.previousRiskLevel === "HIGH" || input.previousRiskLevel === "CRITICAL")) {
    const escalated = higher(risk, input.previousRiskLevel === "CRITICAL" ? "HIGH" : "MEDIUM");
    if (escalated !== risk) {
      risk = escalated;
      reasons.push(`Reincidência: registro anterior desta obrigação já apresentava risco ${input.previousRiskLevel}.`);
    }
  }

  return { riskLevel: risk, reasons };
}
