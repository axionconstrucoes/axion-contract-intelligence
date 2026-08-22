// Ponto de entrada do guardrail determinístico: divide um draft em
// frases candidatas, avalia cada uma contra o GroundingSource, e
// produz o GroundingValidationResult (seção 8 do requisito).

import { evaluateClaimGrounding } from "./evaluate-claim";
import { splitIntoSentences } from "./extract-claims";
import type { GroundedClaim, GroundingSource, GroundingValidationResult } from "./types";

export function validateDraftGrounding(draftBody: string, source: GroundingSource): GroundingValidationResult {
  const sentences = splitIntoSentences(draftBody);

  const supportedClaims: GroundedClaim[] = [];
  const inferredClaims: GroundedClaim[] = [];
  const unsupportedClaims: GroundedClaim[] = [];
  const humanInputRequiredClaims: GroundedClaim[] = [];

  for (const sentence of sentences) {
    const claim = evaluateClaimGrounding(sentence, source);
    switch (claim.supportStatus) {
      case "SUPPORTED":
        supportedClaims.push(claim);
        break;
      case "INFERENCE":
        inferredClaims.push(claim);
        break;
      case "UNSUPPORTED":
        unsupportedClaims.push(claim);
        break;
      case "HUMAN_INPUT_REQUIRED":
        humanInputRequiredClaims.push(claim);
        break;
    }
  }

  const warnings: string[] = [];
  if (inferredClaims.length > 0) {
    warnings.push(`${inferredClaims.length} afirmação(ões) classificada(s) como inferência — revisar antes de enviar.`);
  }
  if (humanInputRequiredClaims.length > 0) {
    warnings.push(`${humanInputRequiredClaims.length} afirmação(ões) dependem de definição humana antes do envio.`);
  }
  if (unsupportedClaims.length > 0) {
    warnings.push(`${unsupportedClaims.length} afirmação(ões) sem suporte no contexto — draft não pode ser tratado como pronto para revisão.`);
  }

  return {
    valid: unsupportedClaims.length === 0,
    supportedClaims,
    inferredClaims,
    unsupportedClaims,
    humanInputRequiredClaims,
    warnings,
  };
}
