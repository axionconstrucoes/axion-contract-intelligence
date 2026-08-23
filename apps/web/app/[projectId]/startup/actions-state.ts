// Tipos e estados iniciais dos Server Actions do Start-up ACC
// (./actions.ts) — deliberadamente fora do módulo "use server" (mesmo
// padrão de app/[projectId]/acoes/actions-state.ts).

export type ConfigureStartupState = { error: string | null; success: boolean };
export const initialConfigureStartupState: ConfigureStartupState = { error: null, success: false };

export type DismissFindingState = { error: string | null; success: boolean };
export const initialDismissFindingState: DismissFindingState = { error: null, success: false };

export type ResolveFindingState = { error: string | null; success: boolean };
export const initialResolveFindingState: ResolveFindingState = { error: null, success: false };

export type CreateActionForFindingState = { error: string | null; success: boolean };
export const initialCreateActionForFindingState: CreateActionForFindingState = { error: null, success: false };

export type CompleteStartupState = { error: string | null; success: boolean };
export const initialCompleteStartupState: CompleteStartupState = { error: null, success: false };
