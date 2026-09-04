// Tipo e estado inicial do Server Action de avaliação de risco de atraso
// de cronograma (./assess-schedule-delay-actions.ts) — deliberadamente
// FORA do módulo "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

export interface AssessScheduleDelayState {
  error: string | null;
  success: { previousSeverity: string | null; newSeverity: string; requiresHumanDecision: boolean } | null;
}

export const initialAssessScheduleDelayState: AssessScheduleDelayState = { error: null, success: null };
