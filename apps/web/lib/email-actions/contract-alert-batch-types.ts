// Tipos do lote de alertas de contrato (um e-mail com vários eventos).
// Vocabulário deliberadamente PRÓPRIO desta feature — nunca reaproveita
// EmailAlertActionType (ACKNOWLEDGE/ASSUME_RESPONSIBILITY/SET_DEADLINE/
// RESPOND, ./types.ts) nem WeeklyDigestResponse (AWARE/STUDYING/
// RESOLVED/FORWARDED, get-weekly-alert-digest.ts) — são três recursos
// diferentes, cada um com sua própria tabela/RPC/rótulos; misturar os
// enums quebraria os dois já existentes silenciosamente.
//
// "VER EVENTO" NUNCA aparece como um valor de `action` — é só um link de
// navegação/consulta (ver contract-alert-batch-template.ts) e nunca conta
// como resposta.

export type ContractAlertBatchItemAction = "RESOLVIDO" | "EM_ANDAMENTO" | "ENVIADO_PARA";

export const CONTRACT_ALERT_BATCH_ITEM_ACTIONS: readonly ContractAlertBatchItemAction[] = [
  "RESOLVIDO",
  "EM_ANDAMENTO",
  "ENVIADO_PARA",
];

export const CONTRACT_ALERT_BATCH_ITEM_ACTION_LABELS: Record<ContractAlertBatchItemAction, string> = {
  RESOLVIDO: "RESOLVIDO",
  EM_ANDAMENTO: "EM ANDAMENTO",
  ENVIADO_PARA: "ENVIADO P/",
};

// Rótulo do botão puramente visual/navegacional do e-mail — nunca um
// valor de `action` (não existe estado "VER_EVENTO" em nenhuma tabela).
export const CONTRACT_ALERT_BATCH_VIEW_EVENT_LABEL = "VER EVENTO";

// Estado (possivelmente ainda não respondido) de um evento dentro do
// lote — usado tanto pela UI (gate do botão final) quanto pelo endpoint
// que efetiva a resposta. `action: null` inclui explicitamente o caso
// "só clicou em VER EVENTO": isso nunca preenche `action`.
export interface ContractAlertBatchItemInput {
  eventId: string;
  title: string;
  action: ContractAlertBatchItemAction | null;
  assignedUserId: string | null;
}

// Payload que o cliente envia para o endpoint/RPC ao responder um item.
export interface ContractAlertBatchResponsePayload {
  eventId: string;
  action: ContractAlertBatchItemAction;
  assignedUserId?: string | null;
}

export interface PendingContractAlertBatchItem {
  eventId: string;
  title: string;
}

// allEventsAnswered = todos os itens possuem RESOLVIDO, EM_ANDAMENTO, ou
// ENVIADO_PARA + colaborador válido (requisito 3 do prompt).
export interface ContractAlertBatchAnsweredState {
  allEventsAnswered: boolean;
  answeredCount: number;
  totalCount: number;
  pendingItems: PendingContractAlertBatchItem[];
}
