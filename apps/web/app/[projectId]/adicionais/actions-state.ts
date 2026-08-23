// Tipos e estados iniciais dos Server Actions de "Propostas de
// Adicionais" (./actions.ts) — deliberadamente FORA do módulo "use
// server" (mesmo motivo de app/[projectId]/acoes/actions-state.ts).

export type CreateAdditionalProposalState = { error: string | null; success: boolean; proposalId: string | null };
export const initialCreateAdditionalProposalState: CreateAdditionalProposalState = { error: null, success: false, proposalId: null };

export type UpdateAdditionalProposalStatusState = { error: string | null; success: boolean };
export const initialUpdateAdditionalProposalStatusState: UpdateAdditionalProposalStatusState = { error: null, success: false };

export type UpdateAdditionalProposalApprovalsState = { error: string | null; success: boolean };
export const initialUpdateAdditionalProposalApprovalsState: UpdateAdditionalProposalApprovalsState = { error: null, success: false };

export type MarkAdditionalProposalContractedState = { error: string | null; success: boolean };
export const initialMarkAdditionalProposalContractedState: MarkAdditionalProposalContractedState = { error: null, success: false };

export type LinkAdditionalProposalSourceState = { error: string | null; success: boolean };
export const initialLinkAdditionalProposalSourceState: LinkAdditionalProposalSourceState = { error: null, success: false };

export type RunAdditionalProposalCurationState = {
  error: string | null;
  result: import("@/lib/additionals/curation").AdditionalProposalCurationResult | null;
};
export const initialRunAdditionalProposalCurationState: RunAdditionalProposalCurationState = { error: null, result: null };
