// Tipo e estado inicial do Server Action de vínculo manual de resposta
// do cliente (./link-client-response-actions.ts) — deliberadamente FORA
// do módulo "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

export interface LinkClientResponseState {
  error: string | null;
  success: boolean;
}

export const initialLinkClientResponseState: LinkClientResponseState = { error: null, success: false };
