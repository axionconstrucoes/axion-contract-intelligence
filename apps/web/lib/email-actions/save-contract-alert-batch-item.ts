import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import { applyBatchResponsesToFollowups } from "../alerts/followup-service";
import { isValidContractAlertBatchAction } from "./contract-alert-batch-validation";
import type { ContractAlertBatchItemAction } from "./contract-alert-batch-types";

export type SaveContractAlertBatchItemOutcome =
  | { ok: true; answered: number; total: number; complete: boolean }
  | { ok: false; error: string };

// Salva IMEDIATAMENTE a ação de UM alerta do lote (resposta parcial). Os demais alertas ficam como
// estão; a resposta FINAL (respondToContractAlertBatch) continua exigindo todos. EM ANDAMENTO e
// ENVIADO P/ contam como resposta ao lote, mas só RESOLVIDO resolve o acompanhamento recorrente.
// A RPC é a autoridade (permissão, lote aberto, colaborador ativo) — aqui só validação rápida.
export async function saveContractAlertBatchItem(input: {
  batchId: string;
  eventId: string;
  action: string;
  assignedUserId?: string | null;
}): Promise<SaveContractAlertBatchItemOutcome> {
  if (!isValidContractAlertBatchAction(input.action)) return { ok: false, error: "Ação inválida." };
  const action = input.action as ContractAlertBatchItemAction;
  const assignedUserId = input.assignedUserId?.trim() || null;
  if (action === "ENVIADO_PARA" && !assignedUserId) return { ok: false, error: "Selecione um colaborador." };

  const supabase = await createSupabaseServerClient();

  const { data: batch, error: batchError } = await supabase
    .from("contract_alert_batches")
    .select("id,project_id,status")
    .eq("id", input.batchId)
    .maybeSingle();
  if (batchError || !batch) return { ok: false, error: "Lote de alertas não encontrado." };

  const { data, error } = await supabase.rpc("save_contract_alert_batch_item_response", {
    p_batch_id: input.batchId,
    p_event_id: input.eventId,
    p_action: action,
    p_assigned_user_id: action === "ENVIADO_PARA" ? assignedUserId : null,
  });
  if (error) return { ok: false, error: error.message || "Não foi possível salvar a ação." };

  // Espelha no acompanhamento recorrente; a ação do lote já está salva e prevalece em caso de falha.
  try {
    await applyBatchResponsesToFollowups(supabase, {
      projectId: batch.project_id as string,
      responses: [{ eventId: input.eventId, action, assignedUserId }],
    });
  } catch {
    // complementar
  }

  const result = (data ?? {}) as { answered?: number; total?: number; complete?: boolean };
  return { ok: true, answered: result.answered ?? 0, total: result.total ?? 0, complete: Boolean(result.complete) };
}
