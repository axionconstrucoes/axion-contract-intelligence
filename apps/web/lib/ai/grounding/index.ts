export type {
  ClaimCategory,
  ClaimSupportStatus,
  GroundedClaim,
  GroundingSource,
  GroundingValidationResult,
  ResponseGroundingSummary,
} from "./types";

export type { BuildGroundingSourceInput } from "./build-grounding-source";
export { buildGroundingSource } from "./build-grounding-source";

export { validateDraftGrounding } from "./validate-draft-grounding";
export { buildResponseGroundingSummary, NOT_PERFORMED_GROUNDING_SUMMARY } from "./build-response-grounding-summary";
export type { SafeCorrectionResult } from "./apply-safe-correction";
export { applySafeGroundingCorrection } from "./apply-safe-correction";
export type { GroundingConfidenceContext } from "./adjust-confidence";
export { adjustConfidenceForGrounding } from "./adjust-confidence";

export { evaluateClaimGrounding } from "./evaluate-claim";
export { splitIntoSentences, classifyPrimaryCategory } from "./extract-claims";
