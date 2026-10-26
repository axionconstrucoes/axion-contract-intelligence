// Estado dos formulários da tabela de providências — fora do módulo "use server" (que só pode
// exportar funções async). Mesmo padrão de app/[projectId]/ledger/[eventId]/send-alert-actions-state.ts.
export type DeliveryActionState = { error: string | null; success: string | null };
export const initialDeliveryActionState: DeliveryActionState = { error: null, success: null };
