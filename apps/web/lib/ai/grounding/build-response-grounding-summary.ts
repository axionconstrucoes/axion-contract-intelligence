// Constrói o ResponseGroundingSummary (seção 11 do requisito) anexado à
// resposta — nunca lido do provider, sempre computado por este módulo
// depois da validação de schema já ter rodado (ver
// experts/commercial-director/{index,query}.ts).

import type { GroundingValidationResult, ResponseGroundingSummary } from "./types";

export function buildResponseGroundingSummary(
  result: GroundingValidationResult,
  options: { correctionApplied: boolean; draftSuppressed: boolean }
): ResponseGroundingSummary {
  return {
    performed: true,
    valid: result.valid,
    supported: result.supportedClaims,
    inferred: result.inferredClaims,
    unsupported: result.unsupportedClaims,
    missingSupport: result.humanInputRequiredClaims,
    warnings: result.warnings,
    correctionApplied: options.correctionApplied,
    draftSuppressed: options.draftSuppressed,
  };
}

export const NOT_PERFORMED_GROUNDING_SUMMARY: ResponseGroundingSummary = {
  performed: false,
  valid: true,
  supported: [],
  inferred: [],
  unsupported: [],
  missingSupport: [],
  warnings: [],
  correctionApplied: false,
  draftSuppressed: false,
};
