"use server";

// Server Actions de "Ingestão Controlada de E-mails" (Integrações).
// Toda escrita passa pelo client de sessão (createSupabaseServerClient)
// — nunca service-role — chamando as RPCs SECURITY DEFINER
// (register_email_account, disconnect_email_account,
// save_project_email_ingestion_config, start_email_sync_run), que
// validam ADMIN internamente. Nenhuma chamada real ao Gmail acontece
// aqui — confirmar sincronização só enfileira o registro (seção 26 do
// requisito: nenhuma carga real nesta tarefa).

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type {
  DisconnectEmailAccountState,
  RegisterEmailAccountState,
  SaveEmailIngestionConfigState,
  StartEmailSyncState,
} from "./actions-state";

function requiredField(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

async function requireUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada. Faça login novamente.");
  return data.user;
}

export async function registerEmailAccountAction(
  _prevState: RegisterEmailAccountState,
  formData: FormData
): Promise<RegisterEmailAccountState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const emailAddress = requiredField(formData, "emailAddress");
    const displayName = optionalField(formData, "displayName");

    const { error } = await supabase.rpc("register_email_account", {
      p_email_address: emailAddress,
      p_display_name: displayName,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/integracoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao registrar conta de e-mail AXION.", success: false };
  }
}

export async function disconnectEmailAccountAction(
  _prevState: DisconnectEmailAccountState,
  formData: FormData
): Promise<DisconnectEmailAccountState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const accountId = requiredField(formData, "accountId");

    const { error } = await supabase.rpc("disconnect_email_account", { p_account_id: accountId });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/integracoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao desconectar conta de e-mail AXION.", success: false };
  }
}

export async function saveEmailIngestionConfigAction(
  _prevState: SaveEmailIngestionConfigState,
  formData: FormData
): Promise<SaveEmailIngestionConfigState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const emailAccountId = requiredField(formData, "emailAccountId");
    const windowMode = requiredField(formData, "windowMode");
    const customStartAt = optionalField(formData, "customStartAt");
    const customEndAt = optionalField(formData, "customEndAt");
    const includeAttachments = formData.get("includeAttachments") === "on";
    const clientDomainsRaw = optionalField(formData, "clientDomains") ?? "[]";
    const participantsRaw = optionalField(formData, "participants") ?? "[]";

    const { error } = await supabase.rpc("save_project_email_ingestion_config", {
      p_project_id: projectId,
      p_email_account_id: emailAccountId,
      p_window_mode: windowMode,
      p_custom_start_at: windowMode === "CUSTOM" ? customStartAt : null,
      p_custom_end_at: windowMode === "CUSTOM" ? customEndAt : null,
      p_client_domains: JSON.parse(clientDomainsRaw),
      p_participants: JSON.parse(participantsRaw),
      p_include_attachments: includeAttachments,
      p_enabled: true,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/integracoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao salvar configuração de ingestão.", success: false };
  }
}

export async function startEmailSyncAction(_prevState: StartEmailSyncState, formData: FormData): Promise<StartEmailSyncState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const configId = requiredField(formData, "configId");

    const { data, error } = await supabase.rpc("start_email_sync_run", { p_config_id: configId }).single();
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/integracoes`);
    return { error: null, success: true, syncRunId: data as string };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao confirmar sincronização.",
      success: false,
      syncRunId: null,
    };
  }
}
