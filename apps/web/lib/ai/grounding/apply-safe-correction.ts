// Correção automática SEGURA de um draft com afirmações sem suporte —
// nunca via um segundo LLM (seção 9 do requisito): puramente
// determinística, e só atua sobre afirmações FACTUAL (a categoria mais
// arriscada de "deriva semântica", como o caso real "passou a compor a
// apólice"). Afirmações CONTRACTUAL/LEGAL/NUMERIC sem suporte NUNCA são
// reescritas automaticamente — são sempre motivo de rejeição do draft,
// porque uma citação de cláusula/lei/número errada é um risco alto
// demais para "consertar" com um substituto genérico.

import type { GroundedClaim, GroundingValidationResult } from "./types";

export interface SafeCorrectionResult {
  correctedBody: string;
  /** true quando ainda há afirmação sem suporte que não pôde ser corrigida com segurança — o draft deve ser rejeitado/suprimido. */
  stillRequiresRejection: boolean;
  /** Claims que foram substituídas por um marcador de confirmação humana. */
  correctedClaims: GroundedClaim[];
  /** Claims que permanecem sem suporte e não puderam ser corrigidas (CONTRACTUAL/LEGAL/NUMERIC). */
  uncorrectableClaims: GroundedClaim[];
}

function buildConfirmationMarker(claim: GroundedClaim): string {
  return `[CONFIRMAR INTERNAMENTE: "${claim.text}" — não suportado diretamente pelo contexto fornecido]`;
}

export function applySafeGroundingCorrection(draftBody: string, result: GroundingValidationResult): SafeCorrectionResult {
  let correctedBody = draftBody;
  const correctedClaims: GroundedClaim[] = [];
  const uncorrectableClaims: GroundedClaim[] = [];

  for (const claim of result.unsupportedClaims) {
    if (claim.category === "FACTUAL" && correctedBody.includes(claim.text)) {
      correctedBody = correctedBody.replace(claim.text, buildConfirmationMarker(claim));
      correctedClaims.push(claim);
    } else {
      uncorrectableClaims.push(claim);
    }
  }

  return {
    correctedBody,
    stillRequiresRejection: uncorrectableClaims.length > 0,
    correctedClaims,
    uncorrectableClaims,
  };
}
