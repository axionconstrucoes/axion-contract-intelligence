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
import { createConstrumanagerClient } from "@/lib/integrations/construmanager/client";
import {
  classifyConstrumanagerConnectionFailure,
  sanitizeIntegrationConnectionError,
} from "@/lib/integrations/construmanager/sanitize-error";
import type {
  DisconnectEmailAccountState,
  RegisterEmailAccountState,
  SaveEmailIngestionConfigState,
  SaveIntegrationOriginState,
  StartEmailSyncState,
  ValidateConstrumanagerConnectionState,
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

export async function saveIntegrationOriginAction(
  _prevState: SaveIntegrationOriginState,
  formData: FormData
): Promise<SaveIntegrationOriginState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const sourceType = requiredField(formData, "sourceType");

    const { error } = await supabase.rpc("save_integration_origin", {
      p_project_id: projectId,
      p_source_type: sourceType,
      p_external_system_reference: optionalField(formData, "externalSystemReference"),
      p_external_project_reference: optionalField(formData, "externalProjectReference"),
      p_account_reference: optionalField(formData, "accountReference"),
      p_folder_reference: optionalField(formData, "folderReference"),
      p_file_reference: optionalField(formData, "fileReference"),
      p_responsible_reference: optionalField(formData, "responsibleReference"),
      p_drive_type: optionalField(formData, "driveType"),
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/integracoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao salvar origem da fonte.", success: false };
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

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseConstrumanagerWorkId(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+)/);
  return match ? parsePositiveInteger(match[1]) : null;
}

export async function validateConstrumanagerConnectionAction(
  _prevState: ValidateConstrumanagerConnectionState,
  formData: FormData
): Promise<ValidateConstrumanagerConnectionState> {
  const supabase = await createSupabaseServerClient();
  let projectId: string | null = null;

  try {
    await requireUser(supabase);
    projectId = requiredField(formData, "projectId");

    const { data: config, error: configError } = await supabase
      .from("project_integrations")
      .select("account_reference, external_project_reference")
      .eq("project_id", projectId)
      .eq("source_type", "CONSTRUMANAGER")
      .maybeSingle();

    if (configError) throw new Error(configError.message);

    const companyId = parsePositiveInteger(config?.account_reference ?? null);
    const workId = parseConstrumanagerWorkId(
      config?.external_project_reference ?? null
    );

    if (!config || !companyId || !workId) {
      const message =
        "Configuração incompleta. Informe a Conta e o ID da obra do Construmanager.";

      const { error: recordError } = await supabase.rpc(
        "record_integration_connection_check",
        {
          p_project_id: projectId,
          p_source_type: "CONSTRUMANAGER",
          p_status: "PENDENTE",
          p_error: message,
        }
      );

      if (recordError) throw new Error(recordError.message);

      revalidatePath(`/${projectId}/integracoes`);

      return {
        error: message,
        success: false,
        status: "PENDENTE",
        checkedAt: new Date().toISOString(),
      };
    }

    const client = createConstrumanagerClient();
    const auth = await client.authenticate();

    if (auth.user.companyId !== companyId) {
      throw new Error(
        `A conta configurada (${companyId}) não corresponde à empresa retornada pela API.`
      );
    }

    const token = await client.getAccessToken(auth.user.token);

    const works = await client.listWorks(
      token.access_token,
      auth.user.companyId
    );

    const configuredWork = works.listWork.find(
      (work) => work.id === workId
    );

    if (!configuredWork) {
      throw new Error(
        `A obra configurada (${workId}) não está disponível para este usuário no Construmanager.`
      );
    }

    const { error: recordError } = await supabase.rpc(
      "record_integration_connection_check",
      {
        p_project_id: projectId,
        p_source_type: "CONSTRUMANAGER",
        p_status: "CONECTADO",
        p_error: null,
      }
    );

    if (recordError) throw new Error(recordError.message);

    revalidatePath(`/${projectId}/integracoes`);
    revalidatePath(`/${projectId}/dashboard`);
    revalidatePath(`/${projectId}/dashboard/visual`);

    return {
      error: null,
      success: true,
      status: "CONECTADO",
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = sanitizeIntegrationConnectionError(error);
    const status = classifyConstrumanagerConnectionFailure(message);

    if (projectId) {
      const { error: recordError } = await supabase.rpc(
        "record_integration_connection_check",
        {
          p_project_id: projectId,
          p_source_type: "CONSTRUMANAGER",
          p_status: status,
          p_error: message,
        }
      );

      if (!recordError) {
        revalidatePath(`/${projectId}/integracoes`);
        revalidatePath(`/${projectId}/dashboard`);
        revalidatePath(`/${projectId}/dashboard/visual`);
      }
    }

    return {
      error: message,
      success: false,
      status,
      checkedAt: new Date().toISOString(),
    };
  }
}
