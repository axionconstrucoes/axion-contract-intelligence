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
