"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@axion/db/server";

import type { DeliveryActionState } from "./actions-state";

// Toda escrita passa pelas funções SQL delivery_* (sessão do usuário): elas conferem permissão
// (gestor/gerente/administrador da obra), colaborador ATIVO como responsável e as regras de
// concluir / não aplicável — a interface nunca é a única barreira.

const fail = (error: string): DeliveryActionState => ({ error, success: null });
const ok = (success: string): DeliveryActionState => ({ error: null, success });
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

function friendly(message: string | undefined): string {
  return message && message.length < 220 ? message : "Não foi possível salvar. Tente novamente.";
}

export async function seedDeliveryChecklistAction(projectId: string): Promise<DeliveryActionState> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delivery_items_seed_checklist", { p_project_id: projectId });
  if (error) return fail(friendly(error.message));
  revalidatePath(`/${projectId}/providencias`);
  return ok(data === 0 ? "O checklist inicial já estava cadastrado." : `${data} providências do checklist inicial cadastradas (a confirmar).`);
}

export async function addDeliveryItemAction(
  projectId: string,
  _prev: DeliveryActionState,
  formData: FormData
): Promise<DeliveryActionState> {
  const title = text(formData, "title");
  const phase = text(formData, "phase");
  if (!title) return fail("Informe o nome da providência.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delivery_item_add_custom", { p_project_id: projectId, p_title: title, p_phase: phase });
  if (error) return fail(friendly(error.message));
  revalidatePath(`/${projectId}/providencias`);
  return ok("Providência adicionada.");
}

export async function updateDeliveryItemAction(
  projectId: string,
  itemId: string,
  _prev: DeliveryActionState,
  formData: FormData
): Promise<DeliveryActionState> {
  const fields = {
    deadline: text(formData, "deadline"),
    internal_deadline: text(formData, "internal_deadline"),
    responsible_user_id: text(formData, "responsible_user_id"),
    dependency_kind: text(formData, "dependency_kind"),
    dependency_name: text(formData, "dependency_name"),
    // "risk" NÃO é enviado aqui: o grau de risco só muda pela revisão com justificativa e histórico
    // (app/[projectId]/risco/actions.ts), nunca em branco por um formulário sem o campo.
    blocks_delivery: formData.get("blocks_delivery") === "on",
    applicability_confirmed: formData.get("applicability_confirmed") === "on",
    cno_number: text(formData, "cno_number"),
    evidence: text(formData, "evidence"),
  };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delivery_item_update_fields", { p_item_id: itemId, p_fields: fields });
  if (error) return fail(friendly(error.message));
  revalidatePath(`/${projectId}/providencias`);
  return ok("Providência atualizada.");
}

export async function changeDeliveryStatusAction(
  projectId: string,
  itemId: string,
  _prev: DeliveryActionState,
  formData: FormData
): Promise<DeliveryActionState> {
  const status = text(formData, "status");
  if (!status) return fail("Selecione a situação.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delivery_item_change_status", {
    p_item_id: itemId,
    p_status: status,
    p_justification: text(formData, "justification") || null,
    p_evidence: text(formData, "evidence") || null,
  });
  if (error) return fail(friendly(error.message));
  revalidatePath(`/${projectId}/providencias`);
  return ok("Situação atualizada.");
}
