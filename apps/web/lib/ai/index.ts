// Ponto único de importação da fundação de AI Experts do ACC.
// Ver docs/ai/experts.md para a arquitetura completa.

export type {
  ExpertAnalysisType,
  ExpertAssessment,
  ExpertContractualBasisRef,
  ExpertEvidenceRef,
  ExpertEvidenceSourceType,
  ExpertFinding,
  ExpertId,
  ExpertSeverity,
} from "./types";

export type {
  BuildEventAnalysisContextInput,
} from "./context/build-event-context";
export { buildEventAnalysisContext } from "./context/build-event-context";
export type {
  BuildProjectAnalysisContextInput,
} from "./context/build-project-context";
export { buildProjectAnalysisContext } from "./context/build-project-context";
export type {
  ContextClause,
  ContextConfrontationCandidate,
  ContextEmail,
  ContextEmailAttachment,
  ContextEsgObligationSummary,
  ContextEvent,
  ContextEventNote,
  ContextEvidence,
  EventAnalysisContext,
  ProjectAnalysisContext,
  ProjectContextEventSummary,
} from "./context/types";

export type { AiProvider, AiProviderQueryRequest, AiProviderRequest, AiProviderResponse } from "./providers/types";
export { createFakeAiProvider } from "./providers/fake-provider";
export { getAiProvider } from "./providers/get-ai-provider";
export { EXPERT_PROVIDER_ENV_VAR, resolveAiProviderForExpert, resolveAiProviderNameForExpert } from "./providers/resolve-provider-for-expert";
export type { AiProviderUiMetadata } from "./provider-ui-metadata";
export { buildAiProviderUiMetadata, normalizeProviderMeta } from "./provider-ui-metadata";
export type { AnthropicProviderConfig } from "./providers/anthropic-config";
export { loadAnthropicConfig } from "./providers/anthropic-config";
export type { AnthropicAiProviderOverrides, AnthropicMessagesClient } from "./providers/anthropic-provider";
export { createAnthropicAiProvider } from "./providers/anthropic-provider";

export type { LegalCitation, LegalSource, LegalSourceOrigin } from "./legal/types";
export { LEGAL_SOURCE_UNAVAILABLE_NOTICE } from "./legal/types";

export type {
  ClassifiedStatement,
  DeclaredContextItem,
  ExpertQueryDraft,
  ExpertQueryDraftType,
  ExpertQueryRequest,
  ExpertQueryResponse,
  ExpertQueryScope,
  RequirementSourceKind,
} from "./query/types";
export {
  ExpertQueryValidationError,
  validateExpertQueryResponse,
} from "./query/validate-expert-query-response";
export type { ExpectedExpertQueryIdentity } from "./query/validate-expert-query-response";

export {
  ExpertAssessmentValidationError,
  validateExpertAssessment,
} from "./schemas/validate-expert-assessment";
export type { ExpectedExpertIdentity } from "./schemas/validate-expert-assessment";

export {
  COMMERCIAL_DIRECTOR_EXPERT_ID,
  COMMERCIAL_DIRECTOR_INSTRUCTIONS,
  COMMERCIAL_DIRECTOR_NAME,
  COMMERCIAL_DIRECTOR_VERSION,
  runCommercialDirectorExpert,
} from "./experts/commercial-director";
export type { CommercialDirectorRunResult } from "./experts/commercial-director";
export type {
  CommercialDraftCommunication,
  CommercialDraftCommunicationType,
  CommercialFieldValue,
  CommercialImpactAssessment,
  CommercialNegotiationAnalysis,
  CommercialDirectorAssessment,
} from "./experts/commercial-director/types";
export { answerCommercialDirectorQuery } from "./experts/commercial-director/query";
export type { CommercialDirectorQueryResult } from "./experts/commercial-director/query";

export {
  ESG_DIRECTOR_EXPERT_ID,
  ESG_DIRECTOR_INSTRUCTIONS,
  ESG_DIRECTOR_NAME,
  ESG_DIRECTOR_VERSION,
  answerEsgDirectorQuery,
} from "./experts/esg-director";
export type { EsgDirectorQueryResult } from "./experts/esg-director";

export type {
  ClaimCategory,
  ClaimSupportStatus,
  GroundedClaim,
  GroundingSource,
  GroundingValidationResult,
  ResponseGroundingSummary,
} from "./grounding/types";
export type { BuildGroundingSourceInput } from "./grounding/build-grounding-source";
export { buildGroundingSource } from "./grounding/build-grounding-source";
export { validateDraftGrounding } from "./grounding/validate-draft-grounding";
export { buildResponseGroundingSummary, NOT_PERFORMED_GROUNDING_SUMMARY } from "./grounding/build-response-grounding-summary";
export type { SafeCorrectionResult } from "./grounding/apply-safe-correction";
export { applySafeGroundingCorrection } from "./grounding/apply-safe-correction";
export type { GroundingConfidenceContext } from "./grounding/adjust-confidence";
export { adjustConfidenceForGrounding } from "./grounding/adjust-confidence";
export { evaluateClaimGrounding } from "./grounding/evaluate-claim";
export { splitIntoSentences, classifyPrimaryCategory } from "./grounding/extract-claims";

export type {
  AuthorizedSourceRef,
  ExpertCollaborationRule,
  ExpertConfidenceRule,
  ExpertDefinition,
  ExpertEscalationRule,
  ExpertImplementationStatus,
  ExpertOutputType,
  ExpertSourceStatus,
  FactCategory,
  OfficialExpertId,
} from "./expert-definitions/types";
export { formatExpertVersionTag } from "./expert-definitions/types";
export {
  ALL_OFFICIAL_EXPERT_DEFINITIONS,
  CEO_DEFINITION,
  COMMERCIAL_DIRECTOR_DEFINITION,
  CORE_ESCALATION_RULES,
  ESG_DIRECTOR_DEFINITION,
  EXPERT_COLLABORATION_MATRIX,
  getCollaborationRulesForExpert,
  LEGAL_CONSULTANT_DEFINITION,
  OFFICIAL_EXPERT_DEFINITIONS,
  PLANNING_DIRECTOR_DEFINITION,
  SHARED_SOURCE_CATALOG,
} from "./expert-definitions";
