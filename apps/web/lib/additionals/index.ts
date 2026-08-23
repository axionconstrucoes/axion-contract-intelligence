// Ponto único de importação de "Propostas de Adicionais".

export type {
  AdditionalProposal,
  AdditionalProposalApprovalStatus,
  AdditionalProposalDocumentalState,
  AdditionalProposalExecutionStatus,
  AdditionalProposalFormalizationType,
  AdditionalProposalLink,
  AdditionalProposalLinkRole,
  AdditionalProposalScheduleExtensionStatus,
  AdditionalProposalSourceType,
  AdditionalProposalStatus,
} from "./types";
export { CHECKLIST_LINK_ROLES } from "./types";

export { getAdditionalProposal, getAdditionalProposalLinks, getAdditionalProposals } from "./get-additional-proposals";
export { createAdditionalProposal } from "./create-additional-proposal";
export type { CreateAdditionalProposalInput } from "./create-additional-proposal";
export { linkAdditionalProposalSource } from "./link-additional-proposal-source";
export type { LinkAdditionalProposalSourceInput } from "./link-additional-proposal-source";
export { updateAdditionalProposalStatus } from "./update-additional-proposal-status";
export { updateAdditionalProposalApprovals } from "./update-additional-proposal-approvals";
export type { UpdateAdditionalProposalApprovalsInput } from "./update-additional-proposal-approvals";
export { markAdditionalProposalContracted } from "./mark-additional-proposal-contracted";
export type { MarkAdditionalProposalContractedInput } from "./mark-additional-proposal-contracted";
export { suggestExistingSourcesForProposal } from "./suggest-existing-sources";
export type { SuggestedDocumentSource, SuggestedEmailSource, SuggestedExistingSources } from "./suggest-existing-sources";
export { computeScheduleFormalizationAlert } from "./schedule-formalization-alert";
export type { ScheduleFormalizationAlert } from "./schedule-formalization-alert";
export { computeClosingGateAssessment } from "./closing-gate";
export type { ClosingGateAssessment, ClosingGateCumulativeImpactStatus, ClosingGateRecommendation } from "./closing-gate";
export { runAdditionalProposalCuration } from "./curation";
export type { AdditionalProposalCurationResult } from "./curation";

export * from "./confrontation/index";
export * from "./drive-sources/index";
export * from "./findings/index";
