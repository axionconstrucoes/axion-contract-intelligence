// Pacote D — sincronizacao HEADLESS de metadados do Construmanager.
//
// Processo A dos tres, e o que fechava o ciclo automatico:
//
//   A. metadados  -> CONSTRUMANAGER_METADATA_SYNC_ENABLED        <- este
//   B. vigencia   -> CONSTRUMANAGER_VERSION_MONITORING_ENABLED
//   C. conteudo   -> CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED
//
// Sem ele, o monitor de vigencia so comparava o que ja estava no banco:
// uma R05 recem-publicada no Construmanager jamais seria descoberta sem
// alguem clicar em "Sincronizar metadados". Agora o ACC descobre sozinho.
//
// O que este worker NAO faz, por construcao (nao ha codigo para isso
// aqui): nao chama Objeto/Download, nao abre ZIP, nao calcula SHA-256,
// nao toca no Storage, nao adquire lease e NAO le
// CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED. Ele coleta metadados, persiste e
// dispara a comparacao de vigencia. Downloads sao outro processo.
//
// Reutiliza a MESMA coleta validada no Pacote B (collect-metadata.ts) e
// a MESMA logica de persistencia (o nucleo SQL compartilhado) — nada foi
// reimplementado.
//
// Uso:
//   node scripts/construmanager-metadata-worker.mjs [projectId]

import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveMetadataSyncEnabled, resolveVersionMonitoringEnabled } = await import(
  "../apps/web/lib/integrations/construmanager/automation-policy.ts"
);

const { createConstrumanagerClient } = await import(
  "../apps/web/lib/integrations/construmanager/client.ts"
);

const { collectConstrumanagerMetadata } = await import(
  "../apps/web/lib/integrations/construmanager/collect-metadata.ts"
);

const { sanitizeConstrumanagerApiError } = await import(
  "../apps/web/lib/integrations/construmanager/sanitize-error.ts"
);

const PROJECT_ID =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
  "00000000-0000-4000-8000-000000000001";

function log(message) {
  console.log(`[construmanager-metadata-worker] ${message}`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel de ambiente ausente: ${name}`);
  return value;
}

// 1. Kill switch e interruptor proprio — antes de qualquer conexao.
const decision = resolveMetadataSyncEnabled(process.env);

if (!decision.enabled) {
  log(`Sincronizacao de metadados DESLIGADA. ${decision.reason}`);
  log("Nenhuma conexao aberta, nenhuma coleta, nenhuma escrita.");
  process.exit(0);
}

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SECRET_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

const inicio = Date.now();

try {
  const { data: integ, error: integErr } = await supabase
    .from("project_integrations")
    .select("account_reference, external_project_reference")
    .eq("project_id", PROJECT_ID)
    .eq("source_type", "CONSTRUMANAGER")
    .maybeSingle();

  if (integErr) throw new Error(integErr.message);

  const companyId = Number.parseInt(String(integ?.account_reference ?? ""), 10);
  const workId = Number.parseInt(
    String(integ?.external_project_reference ?? "").split("-")[0].trim(),
    10
  );

  if (!Number.isInteger(companyId) || !Number.isInteger(workId)) {
    throw new Error("Configuracao da integracao Construmanager incompleta.");
  }

  // 2. Autenticar. Falha aqui e fail-closed: nada e persistido e a
  //    vigencia nao muda.
  const startedAt = new Date().toISOString();
  const client = createConstrumanagerClient();
  const auth = await client.authenticate();

  if (auth.user.companyId !== companyId) {
    throw new Error("A conta configurada nao corresponde a empresa retornada pela API.");
  }

  const token = await client.getAccessToken(auth.user.token);

  // 3. Coletar — MESMA implementacao validada no Pacote B.
  const metadata = await collectConstrumanagerMetadata(
    client,
    token.access_token,
    companyId,
    workId
  );

  log(
    `coleta: ${metadata.folders.length} pasta(s) | ` +
      `${metadata.documents.length} documento(s) | ` +
      `${metadata.versions.length} versao(oes)`
  );

  // 4. Persistir pela PORTA AUTOMATICA (ator SYSTEM, origem AUTOMATICO).
  //    Se falhar, o throw impede que o detector seja chamado — nao existe
  //    transicao parcial sobre metadados que nao foram gravados.
  const { data: syncData, error: syncError } = await supabase
    .rpc("sync_construmanager_metadata_system", {
      p_project_id: PROJECT_ID,
      p_company_id: companyId,
      p_work_id: workId,
      p_started_at: startedAt,
      p_folders: metadata.folders,
      p_documents: metadata.documents,
      p_versions: metadata.versions,
    })
    .single();

  if (syncError) throw new Error(syncError.message);

  // 5. sync_run_id REAL, vindo da execucao que acabou de ser gravada.
  const syncRunId = syncData.sync_run_id;

  log(
    `sincronizacao ${syncRunId}: ${syncData.documents_seen} documento(s) vistos | ` +
      `${syncData.documents_created} novo(s) | ${syncData.versions_created} nova(s) versao(oes)`
  );

  // 6. Detectar transicoes de vigencia, ancoradas nesta observacao.
  //    Interruptor SEPARADO: sincronizar nao habilita monitorar.
  const monitoring = resolveVersionMonitoringEnabled(process.env);

  if (!monitoring.enabled) {
    log(`Deteccao de vigencia DESLIGADA. ${monitoring.reason}`);
    log(`Metadados sincronizados. A comparacao roda quando o processo B for habilitado.`);
    process.exit(0);
  }

  const { data: detectData, error: detectError } = await supabase.rpc(
    "detect_construmanager_version_transitions",
    { p_project_id: PROJECT_ID, p_sync_run_id: syncRunId }
  );

  if (detectError) throw new Error(detectError.message);

  const d = Array.isArray(detectData) ? detectData[0] : detectData;

  log(
    `vigencia: ${d?.first_observations ?? 0} primeira(s) observacao(oes) | ` +
      `${d?.transitions ?? 0} NOVA(S) VERSAO(OES) VIGENTE(S) | ` +
      `${d?.unchanged ?? 0} sem mudanca`
  );

  // 7. Metricas da rodada. Nenhum download foi iniciado.
  log(`concluido em ${Date.now() - inicio}ms | nenhum download iniciado`);
  process.exit(0);
} catch (error) {
  log(`FALHA: ${sanitizeConstrumanagerApiError(error)}`);
  process.exit(1);
}
