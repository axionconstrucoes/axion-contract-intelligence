// Motor determinístico de escalonamento (seção 10/11 do requisito) —
// puro, sem I/O, `now` sempre injetado pelo caller (nunca `new Date()`
// interno) para permanecer determinístico e testável. Nenhum LLM decide
// se um prazo expirou — isso é aritmética objetiva sobre timestamps.
//
// Três checkpoints do "Relógio B" (SLA interno), na ordem em que se
// aplicam a uma ação ainda não resolvida:
//   1. não assumida até assumeDueAt          -> NO_ACKNOWLEDGMENT
//   2. assumida, sem completeDueAt vencido   -> NOT_COMPLETED
//   3. assumida, sem respondDueAt vencido     -> NOT_RESPONDED
// (o primeiro que se aplica vira o "checkpoint" a partir do qual o
// Relógio C (escalation2AfterValue / boardAfterValue) é contado.)
//
// Prazo contratual (Relógio A) e "nova evidência aumentou o risco" são
// tratados como gatilhos adicionais e independentes (seção 11) — nunca
// confundidos com o Relógio B/C.

import { addTimeUnits, AXION_DEFAULT_BUSINESS_HOURS_CONFIG, type SlaBusinessHoursConfig } from "./time-units";
import type { ResolvedSlaMatrixRule } from "./resolve-matrix-rule";
import type { SlaActionStatus, SlaEscalationLevel, SlaEscalationReason } from "./types";

const LEVEL_RANK: Record<SlaEscalationLevel, number> = {
  RESPONSAVEL: 0,
  ESCALAO_1: 1,
  ESCALAO_2: 2,
  DIRETORIA: 3,
};
const LEVEL_BY_RANK: SlaEscalationLevel[] = ["RESPONSAVEL", "ESCALAO_1", "ESCALAO_2", "DIRETORIA"];

// Janela de "prazo contratual próximo" (seção 11) — mínimo seguro fixo,
// nunca configurável nesta fase (evita mais uma dimensão de configuração
// não pedida explicitamente).
const CONTRACTUAL_DEADLINE_NEAR_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ComputeEscalationInput {
  status: SlaActionStatus;
  currentEscalationLevel: SlaEscalationLevel;
  assumeDueAt: string;
  respondDueAt: string | null;
  completeDueAt: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  contractualDeadline: string | null;
  /** ISO datetime — sempre injetado pelo caller, nunca `new Date()` interno. */
  now: string;
  rule: Pick<ResolvedSlaMatrixRule, "timeUnit" | "escalation2AfterValue" | "boardAfterValue">;
  /** Sinal externo (seção 11: "nova evidência aumenta criticidade") — nunca inferido, sempre informado pelo caller. */
  externalRiskIncrease?: boolean;
  /** Timezone/expediente do projeto (correção de timezone) — default AXION (America/Sao_Paulo, 08:00–18:00) quando o projeto não configurou o próprio. */
  businessHoursConfig?: SlaBusinessHoursConfig;
}

export interface ComputeEscalationResult {
  recommendedLevel: SlaEscalationLevel;
  shouldEscalate: boolean;
  /** Motivo dominante (o primeiro que disparou uma subida de nível) — null quando shouldEscalate é false. */
  reason: SlaEscalationReason | null;
  /** Explicação legível de cada gatilho considerado — nunca uma caixa-preta. */
  reasons: string[];
}

export function computeEscalation(input: ComputeEscalationInput): ComputeEscalationResult {
  const reasons: string[] = [];

  if (input.status === "COMPLETED" || input.status === "CANCELLED") {
    return {
      recommendedLevel: input.currentEscalationLevel,
      shouldEscalate: false,
      reason: null,
      reasons: ["Ação concluída/cancelada — nunca escalada."],
    };
  }

  const now = new Date(input.now);
  const businessHoursConfig = input.businessHoursConfig ?? AXION_DEFAULT_BUSINESS_HOURS_CONFIG;
  let recommendedRank = LEVEL_RANK[input.currentEscalationLevel];
  let dominantReason: SlaEscalationReason | null = null;

  let checkpoint: Date | null = null;
  let checkpointReason: SlaEscalationReason | null = null;
  let checkpointLabel = "";

  if (!input.acknowledgedAt) {
    checkpoint = new Date(input.assumeDueAt);
    checkpointReason = "NO_ACKNOWLEDGMENT";
    checkpointLabel = "assumir";
  } else if (!input.completedAt && input.completeDueAt) {
    checkpoint = new Date(input.completeDueAt);
    checkpointReason = "NOT_COMPLETED";
    checkpointLabel = "concluir";
  } else if (!input.completedAt && input.respondDueAt) {
    checkpoint = new Date(input.respondDueAt);
    checkpointReason = "NOT_RESPONDED";
    checkpointLabel = "responder";
  }

  if (checkpoint && checkpointReason && now.getTime() > checkpoint.getTime()) {
    recommendedRank = Math.max(recommendedRank, LEVEL_RANK.ESCALAO_1);
    dominantReason = dominantReason ?? checkpointReason;
    reasons.push(`Prazo para ${checkpointLabel} vencido em ${checkpoint.toISOString()}.`);

    const level2Threshold = addTimeUnits(
      checkpoint,
      input.rule.escalation2AfterValue,
      input.rule.timeUnit,
      businessHoursConfig
    );
    if (now.getTime() > level2Threshold.getTime()) {
      recommendedRank = Math.max(recommendedRank, LEVEL_RANK.ESCALAO_2);
      reasons.push(
        `Sem ação por mais ${input.rule.escalation2AfterValue} (${input.rule.timeUnit}) após o vencimento — sobe ao 2º escalão.`
      );

      const boardThreshold = addTimeUnits(level2Threshold, input.rule.boardAfterValue, input.rule.timeUnit, businessHoursConfig);
      if (now.getTime() > boardThreshold.getTime()) {
        recommendedRank = Math.max(recommendedRank, LEVEL_RANK.DIRETORIA);
        reasons.push(
          `Sem ação por mais ${input.rule.boardAfterValue} (${input.rule.timeUnit}) após o 2º escalão — sobe à Diretoria.`
        );
      }
    }
  }

  if (input.contractualDeadline) {
    const deadline = new Date(input.contractualDeadline);
    if (now.getTime() > deadline.getTime()) {
      recommendedRank = Math.max(recommendedRank, LEVEL_RANK.ESCALAO_2);
      dominantReason = dominantReason ?? "CONTRACTUAL_DEADLINE_MISSED";
      reasons.push("Prazo contratual perdido.");
    } else if (deadline.getTime() - now.getTime() <= CONTRACTUAL_DEADLINE_NEAR_WINDOW_MS) {
      recommendedRank = Math.max(recommendedRank, LEVEL_RANK.ESCALAO_1);
      dominantReason = dominantReason ?? "CONTRACTUAL_DEADLINE_NEAR";
      reasons.push("Prazo contratual próximo (≤ 24h).");
    }
  }

  if (input.externalRiskIncrease) {
    recommendedRank = Math.max(recommendedRank, LEVEL_RANK.ESCALAO_1);
    dominantReason = dominantReason ?? "NEW_EVIDENCE_INCREASED_RISK";
    reasons.push("Nova evidência aumentou a criticidade da ação.");
  }

  const recommendedLevel = LEVEL_BY_RANK[recommendedRank];
  const shouldEscalate = recommendedRank > LEVEL_RANK[input.currentEscalationLevel];

  if (reasons.length === 0) {
    reasons.push("Nenhum prazo vencido — sem gatilho de escalonamento.");
  }

  return {
    recommendedLevel,
    shouldEscalate,
    reason: shouldEscalate ? dominantReason : null,
    reasons,
  };
}
