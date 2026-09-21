"use server";

import { revalidatePath } from "next/cache";

import { isValidContractAlertBatchAction } from "@/lib/email-actions/contract-alert-batch-validation";
import { respondToContractAlertBatch } from "@/lib/email-actions/respond-to-contract-alert-batch";
import type { ContractAlertBatchResponsePayload } from "@/lib/email-actions/contract-alert-batch-types";

import type { SubmitContractAlertBatchState } from "./actions-state";

// Server Action por trás do formulário da página — chama exatamente a
// mesma função (respondToContractAlertBatch) que o endpoint HTTP
// (apps/web/app/api/contract-alert-batches/[batchId]/respond/route.ts)
// chama, nunca uma segunda implementação da validação/gravação. O botão
// "RESPONDER AO ACC" já vem desabilitado do lado do cliente enquanto
// houver pendência (ver contract-alert-batch-form.tsx) — mas mesmo que
// o formulário seja submetido de outra forma, esta função recusa
// qualquer resposta incompleta antes de chegar em
// respondToContractAlertBatch (requisito 5: nunca confiar só na
// interface).
export async function submitContractAlertBatchAction(
  batchId: string,
  projectId: string,
  _previousState: SubmitContractAlertBatchState,
  formData: FormData
): Promise<SubmitContractAlertBatchState> {
  const eventIds = formData.getAll("eventId").map(String);
  if (eventIds.length === 0 || new Set(eventIds).size !== eventIds.length) {
    return { success: false, error: "Não foi possível identificar todos os alertas do lote.", pendingItems: [] };
  }

  const responses: ContractAlertBatchResponsePayload[] = [];
  for (const eventId of eventIds) {
    const action = String(formData.get(`action:${eventId}`) ?? "");
    const assignedUserId = String(formData.get(`assignedUserId:${eventId}`) ?? "").trim() || null;

    if (!isValidContractAlertBatchAction(action)) {
      return { success: false, error: "Todos os alertas precisam ter uma ação definida antes do envio.", pendingItems: [] };
    }
    if (action === "ENVIADO_PARA" && !assignedUserId) {
      return { success: false, error: "Selecione um colaborador para cada alerta enviado.", pendingItems: [] };
    }

    responses.push({ eventId, action, assignedUserId });
  }

  const outcome = await respondToContractAlertBatch({ batchId, responses });

  if (!outcome.ok) {
    return { success: false, error: outcome.error, pendingItems: outcome.pendingItems ?? [] };
  }

  revalidatePath(`/${projectId}/ledger`);
  revalidatePath(`/${projectId}/ledger/lote-alertas/${batchId}`);
  return { success: true, error: null, pendingItems: [] };
}
