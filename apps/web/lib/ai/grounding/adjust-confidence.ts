// Ajuste determinístico e simples de confiança a partir do resultado de
// grounding (seção 13 do requisito) — nunca uma fórmula arbitrária
// complexa. Só é aplicado quando havia um draft para checar (fora
// disso, a confiança original do provider é preservada sem alteração).

import type { GroundingValidationResult } from "./types";

/** Aplicado quando ainda há afirmação sem suporte não corrigida (draft suprimido). */
const UNSUPPORTED_CONFIDENCE_CAP = 0.2;
/** Aplicado quando uma afirmação sem suporte foi corrigida automaticamente (draft mantido, mas com marcador de confirmação). */
const CORRECTED_CONFIDENCE_CAP = 0.5;
/** Redução por afirmação classificada como inferência — simples e documentada, não uma curva complexa. */
const INFERENCE_PENALTY_PER_CLAIM = 0.05;
const MIN_CONFIDENCE = 0.1;

export interface GroundingConfidenceContext {
  draftSuppressed: boolean;
  correctionApplied: boolean;
}

/**
 * Regra determinística simples (seção 13 do requisito, não uma fórmula
 * complexa): draft suprimido → confiança baixa; draft corrigido
 * automaticamente → confiança moderada; só inferências → pequena
 * penalidade por inferência; só fatos suportados → confiança original.
 */
export function adjustConfidenceForGrounding(
  baseConfidence: number,
  result: GroundingValidationResult,
  context: GroundingConfidenceContext
): number {
  if (context.draftSuppressed) {
    return Math.min(baseConfidence, UNSUPPORTED_CONFIDENCE_CAP);
  }

  if (context.correctionApplied) {
    return Math.min(baseConfidence, CORRECTED_CONFIDENCE_CAP);
  }

  if (result.inferredClaims.length === 0) {
    return baseConfidence;
  }

  const penalty = result.inferredClaims.length * INFERENCE_PENALTY_PER_CLAIM;
  return Math.max(MIN_CONFIDENCE, Math.round((baseConfidence - penalty) * 100) / 100);
}
