"use server";

import { getContractAlertBatch } from "@/lib/email/get-contract-alert-batch";
import { isValidContractAlertBatchAction } from "@/lib/email-actions/contract-alert-batch-validation";
import { respondToContractAlertBatch } from "@/lib/email-actions/respond-to-contract-alert-batch";

import type { CompactContractAlertActionState } from "./actions-state";

export async function submitCompactContractAlertAction(
  projectId: string,
  batchId: string,
  eventId: string,
  _previousState: CompactContractAlertActionState,
  formData: FormData
): Promise<CompactContractAlertActionState> {
  const action = String(formData.get("action") ?? "");
  const assignedUserId = String(formData.get("assignedUserId") ?? "").trim() || null;

  if (!isValidContractAlertBatchAction(action)) {
    return { success: false, error: "Ação inválida." };
  }

  if (action === "ENVIADO_PARA" && !assignedUserId) {
    return { success: false, error: "Selecione um colaborador." };
  }

  const batch = await getContractAlertBatch(projectId, batchId);
  if (!batch) {
    return { success: false, error: "Este alerta não está disponível para seu usuário." };
  }

  const item = batch.items.find((candidate) => candidate.eventId === eventId);
  if (!item) {
    return { success: false, error: "Evento não encontrado neste lote." };
  }

  if (batch.items.length !== 1) {
    return {
      success: false,
      error: "Este e-mail contém vários alertas. Para preservar a resposta atômica do lote, use RESPONDER AO ACC.",
    };
  }

  const outcome = await respondToContractAlertBatch({
    batchId,
    responses: [{ eventId, action, assignedUserId }],
  });

  if (!outcome.ok) {
    return { success: false, error: outcome.error };
  }

  return { success: true, error: null };
}
