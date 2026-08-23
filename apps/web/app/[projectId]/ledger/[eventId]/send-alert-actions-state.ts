// Tipo e estado inicial do Server Action de envio de alerta contratual
// por e-mail (./send-alert-actions.ts) — deliberadamente FORA do
// módulo "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

export type SendContractAlertState = { error: string | null; success: string | null };
export const initialSendContractAlertState: SendContractAlertState = { error: null, success: null };
