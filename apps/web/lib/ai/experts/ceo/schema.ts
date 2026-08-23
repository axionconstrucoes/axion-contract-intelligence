// Validação da saída bruta de um provider como ExecutiveCuration.
// Reutiliza as primitivas de apps/web/lib/ai/schemas/primitives.ts — as
// mesmas usadas por validate-expert-assessment.ts e
// validate-expert-query-response.ts — em vez de duplicar checagem de
// forma/tipo.

import {
  fail,
  isRecord,
  requireHumanReviewTrue,
  requireString,
  requireStringArray,
  ValidationFailure,
} from "../../schemas/primitives";
import type { ExpertId, ExpertSeverity } from "../../types";
import type { ExecutiveCuration, ExecutiveCurationConflict, ExecutiveCurationPosition } from "./types";

export { ValidationFailure as ExecutiveCurationValidationError };

const VALID_SEVERITIES: ExpertSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** IDs dos Experts que realmente participaram desta rodada — nenhuma posição/divergência pode citar outro. */
export interface ExpectedCurationParticipants {
  expertIds: ExpertId[];
}

function validatePosition(value: unknown, index: number, participants: ExpectedCurationParticipants): ExecutiveCurationPosition {
  if (!isRecord(value)) fail(`posicoes[${index}] deve ser um objeto`);

  const expertId = requireString(value.expertId, `posicoes[${index}].expertId`);
  if (!participants.expertIds.includes(expertId as ExpertId)) {
    fail(
      `posicoes[${index}].expertId ("${expertId}") não corresponde a nenhum Expert realmente consultado nesta rodada — ` +
        "o CEO IA nunca pode inventar a posição de um Expert que não foi consultado."
    );
  }

  const severity = requireString(value.severity, `posicoes[${index}].severity`);
  if (!VALID_SEVERITIES.includes(severity as ExpertSeverity)) {
    fail(`posicoes[${index}].severity inválida: "${severity}"`);
  }

  return {
    expertId: expertId as ExpertId,
    expertName: requireString(value.expertName, `posicoes[${index}].expertName`),
    severity: severity as ExpertSeverity,
    summary: requireString(value.summary, `posicoes[${index}].summary`),
  };
}

function validateConflict(value: unknown, index: number, participants: ExpectedCurationParticipants): ExecutiveCurationConflict {
  if (!isRecord(value)) fail(`divergencias[${index}] deve ser um objeto`);

  const rawPositions = value.positions;
  if (!Array.isArray(rawPositions) || rawPositions.length < 2) {
    fail(`divergencias[${index}].positions deve ser um array com ao menos 2 posições — uma divergência exige ao menos dois lados`);
  }

  const positions = rawPositions.map((position, positionIndex) => {
    if (!isRecord(position)) fail(`divergencias[${index}].positions[${positionIndex}] deve ser um objeto`);
    const expertId = requireString(position.expertId, `divergencias[${index}].positions[${positionIndex}].expertId`);
    if (!participants.expertIds.includes(expertId as ExpertId)) {
      fail(
        `divergencias[${index}].positions[${positionIndex}].expertId ("${expertId}") não corresponde a nenhum Expert ` +
          "realmente consultado nesta rodada."
      );
    }
    return {
      expertId: expertId as ExpertId,
      expertName: requireString(position.expertName, `divergencias[${index}].positions[${positionIndex}].expertName`),
      position: requireString(position.position, `divergencias[${index}].positions[${positionIndex}].position`),
    };
  });

  return {
    topic: requireString(value.topic, `divergencias[${index}].topic`),
    positions,
    probableReason: requireString(value.probableReason, `divergencias[${index}].probableReason`),
  };
}

/**
 * Valida a saída bruta de um provider como ExecutiveCuration. Lança
 * ExecutiveCurationValidationError descrevendo exatamente o que falhou —
 * nunca "conserta" silenciosamente um campo inválido. `participants`
 * trava a validação contra qualquer posição/divergência inventada para
 * um Expert que não foi realmente consultado nesta rodada.
 */
export function validateExecutiveCuration(candidate: unknown, participants: ExpectedCurationParticipants): ExecutiveCuration {
  if (!isRecord(candidate)) {
    fail("Saída do provider não é um objeto — saída textual livre não é aceita.");
  }

  const overallSeverity = requireString(candidate.overallSeverity, "overallSeverity");
  if (!VALID_SEVERITIES.includes(overallSeverity as ExpertSeverity)) {
    fail(`overallSeverity inválida: "${overallSeverity}"`);
  }

  const posicoesRaw = candidate.posicoes;
  if (!Array.isArray(posicoesRaw)) fail("Campo obrigatório deve ser um array: posicoes");
  const posicoes = posicoesRaw.map((position, index) => validatePosition(position, index, participants));

  const divergenciasRaw = candidate.divergencias;
  if (!Array.isArray(divergenciasRaw)) fail("Campo obrigatório deve ser um array: divergencias");
  const divergencias = divergenciasRaw.map((conflict, index) => validateConflict(conflict, index, participants));

  return {
    situacao: requireString(candidate.situacao, "situacao"),
    fatosPrincipais: requireStringArray(candidate.fatosPrincipais, "fatosPrincipais"),
    posicoes,
    divergencias,
    riscos: requireStringArray(candidate.riscos, "riscos"),
    overallSeverity: overallSeverity as ExpertSeverity,
    alternativas: requireStringArray(candidate.alternativas, "alternativas"),
    recomendacao: requireString(candidate.recomendacao, "recomendacao"),
    decisoesHumanasNecessarias: requireStringArray(candidate.decisoesHumanasNecessarias, "decisoesHumanasNecessarias"),
    requiresHumanReview: requireHumanReviewTrue(candidate.requiresHumanReview),
  };
}
