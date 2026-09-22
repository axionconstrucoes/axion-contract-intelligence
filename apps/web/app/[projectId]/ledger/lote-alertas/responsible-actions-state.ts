// Tipo e estado inicial do Server Action de configuração do
// "Responsável pelos alertas contratuais" (./responsible-actions.ts) —
// deliberadamente FORA do módulo "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

export type ConfigureContractAlertResponsibleState = { error: string | null; success: boolean };
export const initialConfigureContractAlertResponsibleState: ConfigureContractAlertResponsibleState = {
  error: null,
  success: false,
};
