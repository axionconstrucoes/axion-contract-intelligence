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
import { collectConstrumanagerMetadata } from "@/lib/integrations/construmanager/collect-metadata";
import {
  classifyConstrumanagerConnectionFailure,
  sanitizeConstrumanagerApiError,
  sanitizeConstrumanagerContentError,
  sanitizeIntegrationConnectionError,
} from "@/lib/integrations/construmanager/sanitize-error";
import { storeConstrumanagerContent } from "@/lib/integrations/construmanager/store-content";
import { applyContentTargetSelection } from "@/lib/integrations/construmanager/select-content-targets";
import {
  PREPARE_CONTENT_RPC,
  isValidProjectId,
  summarizeContentPreparation,
} from "@/lib/integrations/construmanager/prepare-content";
import {
  initialDownloadConstrumanagerContentState,
  initialPrepareConstrumanagerContentState,
} from "./actions-state";
import type {
  DisconnectEmailAccountState,
  DownloadConstrumanagerContentState,
  PrepareConstrumanagerContentState,
  RegisterEmailAccountState,
  SaveEmailIngestionConfigState,
  SaveIntegrationOriginState,
  StartEmailSyncState,
  SyncConstrumanagerMetadataState,
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

// Sincronização MANUAL de metadados técnicos do Construmanager
// (Pacote B).
//
// Server Action é alcançável por POST direto, não só pela UI — por isso
// a autorização é verificada em DOIS lugares: requireUser aqui e
// has_project_permission(ADMINISTRADOR) dentro das RPCs SECURITY
// DEFINER. Nenhuma escrita usa service-role.
//
// Estritamente read-only do lado do Construmanager: três rotas de
// listagem, nenhum download.
export async function syncConstrumanagerMetadataAction(
  _prevState: SyncConstrumanagerMetadataState,
  formData: FormData
): Promise<SyncConstrumanagerMetadataState> {
  const supabase = await createSupabaseServerClient();
  const startedAt = new Date().toISOString();
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
      throw new Error(
        "Configuração incompleta. Informe a Conta e o ID da obra do Construmanager."
      );
    }

    const client = createConstrumanagerClient();
    const metadata = await collectConstrumanagerMetadata(
      client,
      companyId,
      workId
    );

    const { data, error } = await supabase
      .rpc("sync_construmanager_metadata", {
        p_project_id: projectId,
        p_company_id: companyId,
        p_work_id: workId,
        p_started_at: startedAt,
        p_folders: metadata.folders,
        p_documents: metadata.documents,
        p_versions: metadata.versions,
      })
      .single();

    if (error) throw new Error(error.message);

    const summary = data as {
      sync_run_id: string;
      folders_seen: number;
      documents_seen: number;
      historical_versions_seen: number;
      folders_created: number;
      documents_created: number;
      versions_created: number;
      versions_orphaned: number;
    };

    // ORDEM OBRIGATORIA — a deteccao de vigencia vem DEPOIS da
    // sincronizacao ter terminado consistentemente, e nunca antes:
    //
    //   1. autenticar            (createConstrumanagerClient acima)
    //   2. coletar metadados     (collectConstrumanagerMetadata)
    //   3. persistir             (sync_construmanager_metadata)
    //   4. confirmar consistencia (o throw acima; se a RPC falhou, nao
    //      chegamos aqui e NENHUMA transicao parcial e registrada)
    //   5. detectar transicoes   <- aqui
    //   6. auditoria/alerta      (dentro da RPC de deteccao)
    //   7. downloads             — processo separado, nao acontece aqui
    //
    // Recebe o sync_run_id desta sincronizacao: a transicao fica ancorada
    // na observacao que a produziu, e reprocessar a mesma observacao nao
    // duplica evento.
    //
    // Falha aqui NAO invalida a sincronizacao: os metadados ja estao
    // persistidos e corretos. A deteccao roda de novo na proxima
    // sincronizacao ou pelo monitor agendado.
    const { error: detectError } = await supabase.rpc(
      "detect_construmanager_version_transitions",
      { p_project_id: projectId, p_sync_run_id: summary.sync_run_id }
    );

    // Falha aqui NÃO desfaz os metadados já persistidos e NÃO fabrica
    // transição — mas também não pode virar só um console.error. Sem
    // sinal visível, a UI diria "Concluída" e a pessoa iria embora
    // achando que o monitoramento rodou. O resultado é PARCIAL, e a tela
    // precisa dizer isso.
    const versionMonitoringFailed = Boolean(detectError);

    if (detectError) {
      console.error(
        "[construmanager] Deteccao de versao vigente falhou apos sincronizacao bem-sucedida.",
        JSON.stringify({
          projectId,
          syncRunId: summary.sync_run_id,
          message: detectError.message.slice(0, 300),
        })
      );
    }

    revalidatePath(`/${projectId}/integracoes`);

    return {
      error: null,
      success: true,
      syncedAt: new Date().toISOString(),
      foldersSeen: summary.folders_seen,
      documentsSeen: summary.documents_seen,
      historicalVersionsSeen: summary.historical_versions_seen,
      documentsCreated: summary.documents_created,
      versionsCreated: summary.versions_created,
      versionsOrphaned: summary.versions_orphaned,
      versionMonitoringFailed,
    };
  } catch (error) {
    // sanitizeConstrumanagerApiError cobre o stack trace de SQL Server
    // que a rota ListaMestra/List devolve em requisição malformada.
    const message = sanitizeConstrumanagerApiError(error);

    if (projectId) {
      // A falha também precisa deixar rastro auditável. Se nem isso for
      // possível (ex.: sem permissão), a mensagem ao usuário continua
      // sendo a original — não mascaramos o erro real com o secundário.
      const { error: recordError } = await supabase.rpc(
        "record_construmanager_sync_failure",
        {
          p_project_id: projectId,
          p_started_at: startedAt,
          p_error: message,
        }
      );

      if (!recordError) {
        revalidatePath(`/${projectId}/integracoes`);
      }
    }

    return {
      error: message,
      success: false,
      syncedAt: null,
      foldersSeen: null,
      documentsSeen: null,
      historicalVersionsSeen: null,
      documentsCreated: null,
      versionsCreated: null,
      versionsOrphaned: null,
      // A sincronização inteira falhou; não faz sentido reportar falha
      // parcial do monitoramento, que sequer chegou a ser tentado.
      versionMonitoringFailed: false,
    };
  }
}

// ============================================================
// Download MANUAL de conteúdo real do Construmanager (Pacote C).
//
// Estritamente por lote pequeno e explícito: a obra piloto tem 203
// alvos e baixar tudo de uma vez não é o que este pacote autoriza.
// CONTENT_DOWNLOAD_MAX_BATCH é um teto duro — o valor vindo do
// formulário nunca o ultrapassa, mesmo em POST direto.
//
// Autorização em dois lugares, como no Pacote B: requireUser aqui e
// has_project_permission(ADMINISTRADOR) dentro de cada RPC SECURITY
// DEFINER. O service-role só aparece na escrita física do bucket
// content-addressed (ver store-content.ts), nunca na decisão de
// permissão.
// ============================================================

const CONTENT_DOWNLOAD_MAX_BATCH = 10;
const CONTENT_DOWNLOAD_DEFAULT_BATCH = 2;

type ContentLinkRow = {
  id: string;
  construmanager_object_id: number;
  source_name: string;
  document_id: string | null;
  version_id: string | null;
  construmanager_documents: { extension_normalized: string } | { extension_normalized: string }[] | null;
  construmanager_document_versions: { extension_normalized: string } | { extension_normalized: string }[] | null;
};

function extensionOf(row: ContentLinkRow): string | null {
  const source = row.version_id
    ? row.construmanager_document_versions
    : row.construmanager_documents;
  if (!source) return null;
  const record = Array.isArray(source) ? source[0] : source;
  return record?.extension_normalized ?? null;
}

export async function downloadConstrumanagerContentAction(
  _prevState: DownloadConstrumanagerContentState,
  formData: FormData
): Promise<DownloadConstrumanagerContentState> {
  const supabase = await createSupabaseServerClient();

  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const requestedLinkId = optionalField(formData, "linkId");

    const requestedBatch =
      parsePositiveInteger(optionalField(formData, "batchSize")) ??
      CONTENT_DOWNLOAD_DEFAULT_BATCH;

    // Ternário em vez de Math.min de propósito: o guard do Pacote B
    // (test-construmanager-metadata-identity) proíbe Math.min/Math.max
    // neste arquivo para impedir que alguém volte a eleger "cabeça =
    // menor id". A regra vale mesmo quando o uso é inofensivo — não se
    // afrouxa um guard de identidade para caber um limite de lote.
    const batchSize =
      requestedBatch > CONTENT_DOWNLOAD_MAX_BATCH
        ? CONTENT_DOWNLOAD_MAX_BATCH
        : requestedBatch;

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
      throw new Error(
        "Configuração incompleta. Informe a Conta e o ID da obra do Construmanager."
      );
    }

    // Cria os vínculos que ainda faltam. Idempotente: roda a cada
    // acionamento e só insere o que o sync de metadados trouxe de novo.
    const { error: ensureError } = await supabase.rpc(
      "ensure_construmanager_content_links",
      { p_project_id: projectId }
    );

    if (ensureError) throw new Error(ensureError.message);

    let query = supabase
      .from("construmanager_content_links")
      .select(
        "id, construmanager_object_id, source_name, document_id, version_id, construmanager_documents (extension_normalized), construmanager_document_versions (extension_normalized)"
      )
      .eq("project_id", projectId);

    // linkId presente => SOMENTE aquele alvo, nunca o lote automático.
    // A regra vive em select-content-targets.ts para poder ser testada.
    query = applyContentTargetSelection(query, {
      linkId: requestedLinkId,
      batchSize,
    });

    const { data: linkRows, error: linksError } = await query;

    if (linksError) throw new Error(linksError.message);

    const targets = ((linkRows ?? []) as unknown as ContentLinkRow[]).map((row) => ({
      linkId: row.id,
      objectId: row.construmanager_object_id,
      name: row.source_name,
      extensionNormalized: extensionOf(row),
    }));

    if (targets.length === 0) {
      return {
        ...initialDownloadConstrumanagerContentState,
        success: true,
        finishedAt: new Date().toISOString(),
        attempted: 0,
        stored: 0,
        failed: 0,
        blobsCreated: 0,
        blobsReused: 0,
        uploadsSkipped: 0,
      };
    }

    // Autentica UMA vez para o lote: o token de acesso vale ~24 h e
    // reautenticar por arquivo só multiplicaria a exposição.
    const client = createConstrumanagerClient();
    const auth = await client.authenticate();

    if (auth.user.companyId !== companyId) {
      throw new Error(
        `A conta configurada (${companyId}) não corresponde à empresa retornada pela API.`
      );
    }

    const token = await client.getAccessToken(auth.user.token);

    let stored = 0;
    let failed = 0;
    let blobsCreated = 0;
    let blobsReused = 0;
    let uploadsSkipped = 0;
    let firstError: string | null = null;

    // Sequencial de propósito: downloads de centenas de MB em paralelo
    // multiplicariam disco temporário e banda sem ganho real nesta fase.
    for (const target of targets) {
      const result = await storeConstrumanagerContent(
        supabase,
        projectId,
        target,
        client,
        token.access_token,
        companyId,
        workId
      );

      if (result.status === "ARMAZENADO") {
        stored += 1;
        if (result.blobReused) blobsReused += 1;
        else blobsCreated += 1;
        if (result.uploadSkipped) uploadsSkipped += 1;
      } else {
        failed += 1;
        if (!firstError) firstError = result.error;
      }
    }

    revalidatePath(`/${projectId}/integracoes`);

    return {
      error: null,
      success: true,
      finishedAt: new Date().toISOString(),
      attempted: targets.length,
      stored,
      failed,
      blobsCreated,
      blobsReused,
      uploadsSkipped,
      firstError,
    };
  } catch (error) {
    return {
      ...initialDownloadConstrumanagerContentState,
      error: sanitizeConstrumanagerContentError(error),
    };
  }
}

// Preparação da lista de conteúdo — cria vínculos, NÃO baixa nada.
//
// Deliberadamente separada de downloadConstrumanagerContentAction. Aquela
// ação prepara e, na sequência, baixa: qualquer acionamento dela transfere
// pelo menos um arquivo, e no piloto controlado seria um alvo arbitrário.
// Esta aqui termina onde a outra começa.
//
// O que esta ação NÃO faz, por construção (não há código para isso no
// caminho): não instancia o cliente Construmanager, não autentica, não
// pede token, não chama Objeto/Download, não seleciona alvo, não cria
// blob e não escreve no Storage. Também não toca nas tabelas do Pacote B
// — o RPC apenas as lê.
//
// Autorização: ADMINISTRADOR é exigido dentro do próprio RPC
// (auth.uid() + has_project_permission(..., 'ADMINISTRADOR')), que roda
// SECURITY DEFINER com search_path vazio. A checagem é do banco e não
// pode ser contornada pela UI; aqui só garantimos sessão e formato do
// projectId antes de gastar uma ida ao banco.
//
// Idempotente: o RPC insere com ON CONFLICT DO NOTHING, então a segunda
// execução devolve links_created = 0 e não duplica nada.
export async function prepareConstrumanagerContentAction(
  _prevState: PrepareConstrumanagerContentState,
  formData: FormData
): Promise<PrepareConstrumanagerContentState> {
  const supabase = await createSupabaseServerClient();

  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");

    if (!isValidProjectId(projectId)) {
      throw new Error("Projeto inválido.");
    }

    const { data, error } = await supabase.rpc(PREPARE_CONTENT_RPC, {
      p_project_id: projectId,
    });

    if (error) throw new Error(error.message);

    const summary = summarizeContentPreparation(data);

    revalidatePath(`/${projectId}/integracoes`);

    return {
      error: null,
      success: true,
      finishedAt: new Date().toISOString(),
      linksCreated: summary.linksCreated,
      documentsTotal: summary.documentsTotal,
      versionsTotal: summary.versionsTotal,
      pendingTotal: summary.pendingTotal,
    };
  } catch (error) {
    return {
      ...initialPrepareConstrumanagerContentState,
      error: sanitizeConstrumanagerContentError(error),
    };
  }
}
