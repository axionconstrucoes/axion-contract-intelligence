// Estado do formulário de revisão do grau de risco — fora do módulo "use server" (que só pode
// exportar funções async).
export type RiskReviewActionState = { error: string | null; success: string | null };
export const initialRiskReviewActionState: RiskReviewActionState = { error: null, success: null };
