// Tipos e estados iniciais dos Server Actions de ESG/SSMA (./actions.ts)
// — deliberadamente FORA do módulo "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

export type CreateEsgObligationState = { error: string | null; success: boolean };
export const initialCreateEsgObligationState: CreateEsgObligationState = { error: null, success: false };

export type CreateEsgSubmissionState = { error: string | null; submissionId: string | null };
export const initialCreateEsgSubmissionState: CreateEsgSubmissionState = { error: null, submissionId: null };

export type ReviewEsgSubmissionState = { error: string | null; success: boolean };
export const initialReviewEsgSubmissionState: ReviewEsgSubmissionState = { error: null, success: false };
