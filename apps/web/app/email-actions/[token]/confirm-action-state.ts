// Tipo e estado inicial do Server Action de confirmação de e-mail
// acionável (./actions.ts) — deliberadamente FORA do módulo "use
// server", mesmo padrão de
// apps/web/app/[projectId]/acoes/actions-state.ts.

export type ConfirmEmailActionState = { error: string | null; success: boolean };
export const initialConfirmEmailActionState: ConfirmEmailActionState = { error: null, success: false };
