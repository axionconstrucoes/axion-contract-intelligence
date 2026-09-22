import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import {
  decideContractAlertBatchRespondOutcome,
  type ContractAlertBatchRespondOutcome,
} from "./contract-alert-batch-validation";
import type {
  ContractAlertBatchItemAction,
  ContractAlertBatchItemInput,
  ContractAlertBatchResponsePayload,
} from "./contract-alert-batch-types";

export interface RespondToContractAlertBatchInput {
  batchId: string;
  responses: ContractAlertBatchResponsePayload[];
}

// Único ponto que EFETIVA a resposta final de um lote de alertas de
// contrato — tanto o endpoint HTTP
// (apps/web/app/api/contract-alert-batches/[batchId]/respond/route.ts)
// quanto o Server Action da página do lote
// (app/[projectId]/ledger/lote-alertas/[batchId]/actions.ts) chamam só
// esta função; nenhum dos dois duplica a leitura do lote nem a decisão
// de liberar/recusar (requisito 5: "Não confiar somente na interface").
//
// SEMPRE recarrega o estado do lote/itens/colaboradores do banco antes
// de decidir — nunca confia no que o cliente diz já estar respondido
// ("mesmo que alguém manipule o frontend, a resposta parcial não pode
// ser enviada"). A decisão em si (decideContractAlertBatchRespondOutcome)
// é pura/testável sem banco; a gravação real só acontece depois de um
// outcome.ok === true, e é sempre a RPC atômica
// (submit_contract_alert_batch_response) quem grava — defesa em
// profundidade: mesmo que esta função tivesse um bug de validação, a
// RPC reconfirma tudo antes de persistir qualquer linha.
export async function respondToContractAlertBatch(
  input: RespondToContractAlertBatchInput
): Promise<ContractAlertBatchRespondOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data: batch, error: batchError } = await supabase
    .from("contract_alert_batches")
    .select("id,project_id,status")
    .eq("id", input.batchId)
    .maybeSingle();

  if (batchError || !batch) {
    return { ok: false, status: 409, error: "Lote de alertas não encontrado." };
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from("contract_alert_batch_items")
    .select("event_id,title_snapshot,action,assigned_user_id")
    .eq("batch_id", input.batchId);

  if (itemsError) {
    return { ok: false, status: 409, error: "Não foi possível carregar os alertas deste lote." };
  }

  const items: ContractAlertBatchItemInput[] = (itemRows ?? []).map((row) => ({
    eventId: row.event_id as string,
    title: row.title_snapshot as string,
    action: row.action as ContractAlertBatchItemAction | null,
    assignedUserId: row.assigned_user_id as string | null,
  }));

  const { data: memberRows, error: membersError } = await supabase
    .from("project_memberships")
    .select("user_id,status")
    .eq("project_id", batch.project_id as string);

  if (membersError) {
    return { ok: false, status: 409, error: "Não foi possível validar os colaboradores do projeto." };
  }

  const activeProjectMemberUserIds = new Set(
    (memberRows ?? [])
      .filter((row) => (row.status ?? "ACTIVE") === "ACTIVE")
      .map((row) => row.user_id as string)
  );

  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: batch.status as "PENDING" | "SENT" | "RESPONDED" | "FAILED",
    items,
    responses: input.responses,
    activeProjectMemberUserIds,
  });

  if (!outcome.ok) {
    return outcome;
  }

  const { error: rpcError } = await supabase.rpc("submit_contract_alert_batch_response", {
    p_batch_id: input.batchId,
    p_responses: input.responses,
  });

  if (rpcError) {
    // A RPC é a autoridade final e atômica — se ela recusar (ex.: outro
    // clique concorrente já respondeu o lote entre a leitura acima e
    // agora), o erro dela vira 409, nunca é escondido/ignorado.
    return { ok: false, status: 409, error: rpcError.message || "Falha ao registrar as respostas." };
  }

  return outcome;
}
