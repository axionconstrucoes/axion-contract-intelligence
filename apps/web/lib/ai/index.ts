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
  ContextClause,
  ContextConfrontationCandidate,
  ContextEmail,
  ContextEvent,
  ContextEvidence,
  EventAnalysisContext,
} from "./context/types";

export type { AiProvider, AiProviderRequest, AiProviderResponse } from "./providers/types";
export { createFakeAiProvider } from "./providers/fake-provider";
export { getAiProvider } from "./providers/get-ai-provider";

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
