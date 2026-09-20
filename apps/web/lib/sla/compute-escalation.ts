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
// CADEIA ÚNICA (três níveis operacionais):
//   RESPONSAVEL --(checkpoint vencido)--> ESCALAO_1 (Nível 2 · Gerência)
//   ESCALAO_1  --(+ escalation2AfterValue, "prazo do Nível 2")--> DIRETORIA (Nível 3)
//   DIRETORIA  --(+ boardAfterValue, "prazo do Nível 3")--> TOP_LEVEL_REACHED
// TOP_LEVEL_REACHED não é um nível nem tem destinatário: é o sinal de que
// a Diretoria também deixou o prazo vencer (topLevelReached = true), para
// registro/auditoria — nunca um novo e-mail. ESCALAO_2 é legado: nunca é
// recomendado; um registro histórico em ESCALAO_2 é tratado como Nível 2
// e avança diretamente para DIRETORIA.
//
// Prazo contratual (Relógio A) e "nova evidência aumentou o risco" são
// tratados como gatilhos adicionais e independentes (seção 11) — nunca
// confundidos com o Relógio B/C.

import { addTimeUnits, AXION_DEFAULT_BUSINESS_HOURS_CONFIG, type SlaBusinessHoursConfig } from "./time-units";
import type { ResolvedSlaMatrixRule } from "./resolve-matrix-rule";
import type { SlaActionStatus, SlaEscalationLevel, SlaEscalationReason } from "./types";

// ESCALAO_2 (legado) ocupa o MESMO rank do Nível 2: nunca é recomendado e,
// quando é o nível atual de um registro antigo, o próximo passo é DIRETORIA.
const LEVEL_RANK: Record<SlaEscalationLevel, number> = {
  RESPONSAVEL: 0,
  ESCALAO_1: 1,
  ESCALAO_2: 1,
  DIRETORIA: 2,
};
const LEVEL_BY_RANK: SlaEscalationLevel[] = ["RESPONSAVEL", "ESCALAO_1", "DIRETORIA"];
export const SLA_ESCALATION_CHAIN: readonly SlaEscalationLevel[] = LEVEL_BY_RANK;

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
  /**
   * true quando o prazo da Diretoria (boardAfterValue após a subida ao
   * Nível 3) também venceu: limite de escalonamento atingido. Não há novo
   * destinatário nem novo e-mail — só registro/auditoria (idempotente).
   */
  topLevelReached: boolean;
}

export function computeEscalation(input: ComputeEscalationInput): ComputeEscalationResult {
  const reasons: string[] = [];

  if (input.status === "COMPLETED" || input.status === "CANCELLED") {
    return {
      recommendedLevel: input.currentEscalationLevel,
      shouldEscalate: false,
      reason: null,
      reasons: ["Ação concluída/cancelada — nunca escalada."],
      topLevelReached: false,
    };
  }

  const now = new Date(input.now);
  const businessHoursConfig = input.businessHoursConfig ?? AXION_DEFAULT_BUSINESS_HOURS_CONFIG;
  let recommendedRank = LEVEL_RANK[input.currentEscalationLevel];
  let dominantReason: SlaEscalationReason | null = null;
  let topLevelReached = false;

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

    // Prazo do Nível 2 (escalation2AfterValue) contado a partir do
    // checkpoint: vencido => Diretoria (Nível 3).
    const boardThreshold = addTimeUnits(
      checkpoint,
      input.rule.escalation2AfterValue,
      input.rule.timeUnit,
      businessHoursConfig
    );
    if (now.getTime() > boardThreshold.getTime()) {
      recommendedRank = Math.max(recommendedRank, LEVEL_RANK.DIRETORIA);
      reasons.push(
        `Sem ação por mais ${input.rule.escalation2AfterValue} (${input.rule.timeUnit}) após o vencimento — sobe à Diretoria (Nível 3).`
      );

      // Prazo do Nível 3 (boardAfterValue) contado a partir da subida à
      // Diretoria: vencido => limite de escalonamento atingido (sem Nível 4).
      const topLevelThreshold = addTimeUnits(boardThreshold, input.rule.boardAfterValue, input.rule.timeUnit, businessHoursConfig);
      if (now.getTime() > topLevelThreshold.getTime()) {
        topLevelReached = true;
        reasons.push(
          `Sem ação por mais ${input.rule.boardAfterValue} (${input.rule.timeUnit}) após a Diretoria — limite de escalonamento atingido.`
        );
      }
    }
  }

  if (input.contractualDeadline) {
    const deadline = new Date(input.contractualDeadline);
    if (now.getTime() > deadline.getTime()) {
      recommendedRank = Math.max(recommendedRank, LEVEL_RANK.DIRETORIA);
      dominantReason = dominantReason ?? "CONTRACTUAL_DEADLINE_MISSED";
      reasons.push("Prazo contratual perdido — Diretoria (Nível 3).");
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
    topLevelReached,
  };
}
