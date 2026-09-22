// Puro, sem I/O — deliberadamente sem "server-only" para ser testável por
// um script Node standalone (mesmo padrão de pilot-outbound-guard.ts) e
// reaproveitado tanto pela interface (gate do botão "RESPONDER AO ACC")
// quanto pelo endpoint que efetiva a resposta final
// (apps/web/app/api/contract-alert-batches/[batchId]/respond/route.ts) —
// nunca duas implementações divergentes da mesma regra
// "allEventsAnswered". A RPC submit_contract_alert_batch_response
// (20260921130000_contract_alert_batches_foundation.sql) reaplica a
// mesma verificação, de forma atômica, dentro do banco — esta função
// nunca é o único lugar que decide o que é gravado (requisito 5: "não
// confiar somente na interface").

import {
  CONTRACT_ALERT_BATCH_ITEM_ACTIONS,
  type ContractAlertBatchAnsweredState,
  type ContractAlertBatchItemAction,
  type ContractAlertBatchItemInput,
  type ContractAlertBatchResponsePayload,
  type PendingContractAlertBatchItem,
} from "./contract-alert-batch-types";

const VALID_ACTIONS = new Set<string>(CONTRACT_ALERT_BATCH_ITEM_ACTIONS);

export function isValidContractAlertBatchAction(value: unknown): value is ContractAlertBatchItemAction {
  return typeof value === "string" && VALID_ACTIONS.has(value);
}

// "VER EVENTO" nunca chega até aqui — não é um valor de `action`
// possível (ver contract-alert-batch-types.ts). Um item sem `action`
// definido é sempre pendente, mesmo que o destinatário já tenha clicado
// em "VER EVENTO" várias vezes; "ENVIADO_PARA" só conta como respondido
// com um `assignedUserId` presente.
export function resolveContractAlertBatchAnsweredState(
  items: readonly ContractAlertBatchItemInput[]
): ContractAlertBatchAnsweredState {
  const pendingItems: PendingContractAlertBatchItem[] = [];

  for (const item of items) {
    const isAnswered =
      item.action !== null &&
      isValidContractAlertBatchAction(item.action) &&
      (item.action !== "ENVIADO_PARA" || Boolean(item.assignedUserId));

    if (!isAnswered) {
      pendingItems.push({ eventId: item.eventId, title: item.title });
    }
  }

  const totalCount = items.length;
  const answeredCount = totalCount - pendingItems.length;

  return {
    allEventsAnswered: totalCount > 0 && pendingItems.length === 0,
    answeredCount,
    totalCount,
    pendingItems,
  };
}

export interface ContractAlertBatchRespondOutcomeOk {
  ok: true;
  status: 200;
  respondedItems: number;
}

export interface ContractAlertBatchRespondOutcomeError {
  ok: false;
  status: 409 | 422;
  error: string;
  pendingItems?: PendingContractAlertBatchItem[];
}

export type ContractAlertBatchRespondOutcome =
  | ContractAlertBatchRespondOutcomeOk
  | ContractAlertBatchRespondOutcomeError;

export interface DecideContractAlertBatchRespondOutcomeInput {
  // Estado ATUAL do lote, carregado do banco pelo endpoint imediatamente
  // antes de decidir (requisito 5: "verificar o estado atual de
  // todos") — nunca um valor assumido/otimista vindo do cliente.
  batchStatus: "PENDING" | "SENT" | "RESPONDED" | "FAILED";
  // Itens tal como estão HOJE no banco (antes de aplicar `responses`) —
  // o endpoint sempre recarrega isto do banco, nunca confia no que o
  // cliente diz que já estava respondido.
  items: readonly ContractAlertBatchItemInput[];
  // O que o cliente está tentando gravar nesta chamada.
  responses: readonly ContractAlertBatchResponsePayload[];
  // ids de project_memberships ATIVOS do projeto do lote — quem decide
  // se um "ENVIADO_PARA" é válido é sempre o projeto real (consultado
  // pelo endpoint), nunca uma lista arbitrária vinda do cliente.
  activeProjectMemberUserIds: ReadonlySet<string>;
}

// A ÚNICA função que decide 200 (liberado) vs 409 (conflito de estado do
// lote — já respondido, ou ainda não enviado) vs 422 (resposta
// incompleta/inválida). Nunca grava nada — quem grava, depois de um
// "ok: true" aqui, é sempre a RPC (defesa em profundidade: mesmo que
// esta função tivesse um bug, a RPC reconfirma tudo de forma atômica
// antes de gravar qualquer linha).
export function decideContractAlertBatchRespondOutcome(
  input: DecideContractAlertBatchRespondOutcomeInput
): ContractAlertBatchRespondOutcome {
  if (input.batchStatus === "RESPONDED") {
    return { ok: false, status: 409, error: "Este lote de alertas já foi respondido." };
  }

  if (input.batchStatus !== "SENT") {
    return { ok: false, status: 409, error: "Este lote de alertas ainda não está disponível para resposta." };
  }

  const totalCount = input.items.length;
  if (totalCount === 0) {
    return { ok: false, status: 422, error: "Este lote de alertas não contém eventos." };
  }

  const responseByEventId = new Map<string, ContractAlertBatchResponsePayload>();
  for (const response of input.responses) {
    if (!response || typeof response.eventId !== "string") continue;
    responseByEventId.set(response.eventId, response);
  }

  if (responseByEventId.size !== input.responses.length) {
    return { ok: false, status: 422, error: "O lote contém uma resposta duplicada para o mesmo evento." };
  }

  const knownEventIds = new Set(input.items.map((item) => item.eventId));
  for (const response of input.responses) {
    if (!knownEventIds.has(response.eventId)) {
      return { ok: false, status: 422, error: "O lote contém um evento que não pertence a esta mensagem." };
    }
    if (!isValidContractAlertBatchAction(response.action)) {
      return { ok: false, status: 422, error: "Existe uma ação inválida no lote de alertas." };
    }
    if (
      response.action === "ENVIADO_PARA" &&
      (!response.assignedUserId || !input.activeProjectMemberUserIds.has(response.assignedUserId))
    ) {
      return { ok: false, status: 422, error: "Selecione um colaborador ativo do projeto para cada evento enviado." };
    }
  }

  const mergedItems: ContractAlertBatchItemInput[] = input.items.map((item) => {
    const response = responseByEventId.get(item.eventId);
    if (!response) return item;
    return {
      ...item,
      action: response.action,
      assignedUserId: response.assignedUserId ?? null,
    };
  });

  const state = resolveContractAlertBatchAnsweredState(mergedItems);
  if (!state.allEventsAnswered) {
    return {
      ok: false,
      status: 422,
      error: "Todos os alertas precisam ter uma ação definida antes do envio.",
      pendingItems: state.pendingItems,
    };
  }

  return { ok: true, status: 200, respondedItems: state.totalCount };
}
