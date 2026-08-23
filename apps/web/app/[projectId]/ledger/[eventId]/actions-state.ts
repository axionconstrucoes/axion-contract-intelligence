// Tipo e estado inicial do Server Action de revisão de candidato de
// confronto de cláusula (./actions.ts) — deliberadamente FORA do
// módulo "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

export type ReviewEventClauseConfrontationCandidateState = {
  error: string | null;
};

export const initialReviewEventClauseConfrontationCandidateState: ReviewEventClauseConfrontationCandidateState = {
  error: null,
};
