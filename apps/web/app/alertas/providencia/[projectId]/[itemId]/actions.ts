"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@axion/db/server";

import type { DeliveryAlertActionState } from "./actions-state";

// Confirmação EXPLÍCITA (envio do formulário) de uma ação do alerta de providência. Abrir o link
// (GET) nunca chega aqui. Toda regra (quem pode agir, colaborador ativo, concluir só por gestor com
// evidência/justificativa) é imposta pela função SQL delivery_item_respond — a página não é a
// única barreira.
export async function respondDeliveryAlertAction(
  projectId: string,
  itemId: string,
  action: string,
  _previous: DeliveryAlertActionState,
  formData: FormData
): Promise<DeliveryAlertActionState> {
  if (!["RESOLVIDO", "EM_ANDAMENTO", "ENVIADO_PARA"].includes(action)) return { success: false, error: "Ação inválida." };

  const assigned = String(formData.get("assignedUserId") ?? "").trim() || null;
  if (action === "ENVIADO_PARA" && !assigned) return { success: false, error: "Selecione um colaborador." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delivery_item_respond", {
    p_item_id: itemId,
    p_action: action,
    p_assigned_user_id: action === "ENVIADO_PARA" ? assigned : null,
    p_justification: String(formData.get("justification") ?? "").trim() || null,
    p_evidence: String(formData.get("evidence") ?? "").trim() || null,
  });
  if (error) {
    const message = error.message && error.message.length < 260 ? error.message : "Não foi possível registrar a ação.";
    return { success: false, error: message };
  }

  revalidatePath(`/${projectId}/providencias`);
  return { success: true, error: null };
}
