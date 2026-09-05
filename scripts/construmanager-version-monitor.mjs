// Pacote D — monitor de VERSAO VIGENTE do Construmanager.
//
// Processo B dos tres, e INDEPENDENTE dos outros dois:
//
//   A. sincronizacao de metadados -> CONSTRUMANAGER_METADATA_SYNC_ENABLED
//   B. deteccao de vigencia       -> CONSTRUMANAGER_VERSION_MONITORING_ENABLED  <- este
//   C. download de conteudo       -> CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED
//
// Este script NAO LE a variavel de download, e isso e o ponto: com os
// downloads desligados o monitoramento continua funcionando. Saber que
// um projeto mudou de revisao nao exige ter a copia binaria do arquivo —
// o IFC de 262,9 MiB nunca sera baixado e precisa ser monitorado do
// mesmo jeito.
//
// O que ele NAO faz, por construcao (nao ha codigo para isso aqui):
// nao autentica no Construmanager, nao chama Objeto/Download, nao le
// ZIP, nao calcula SHA-256, nao toca no Storage e nao adquire lease.
// Ele so compara o estado ja persistido com o ultimo observado.
//
// Uso:
//   node scripts/construmanager-version-monitor.mjs [projectId] [syncRunId]

import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveVersionMonitoringEnabled } = await import(
  "../apps/web/lib/integrations/construmanager/automation-policy.ts"
);

const { sanitizeConstrumanagerContentError } = await import(
  "../apps/web/lib/integrations/construmanager/sanitize-error.ts"
);

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const PROJECT_ID = args[0] ?? "00000000-0000-4000-8000-000000000001";

// Identificador imutavel da observacao. Quando o monitor roda logo apos
// uma sincronizacao, recebe o sync_run_id dela — assim a transicao fica
// ancorada na observacao que a produziu, e nao num relogio local.
const SYNC_RUN_ID = args[1] ?? null;

function log(message) {
  console.log(`[construmanager-version-monitor] ${message}`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel de ambiente ausente: ${name}`);
  return value;
}

const decision = resolveVersionMonitoringEnabled(process.env);

if (!decision.enabled) {
  log(`Monitoramento de versao DESLIGADO. ${decision.reason}`);
  log("Nenhuma conexao aberta, nenhuma escrita.");
  process.exit(0);
}

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SECRET_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

try {
  const { data, error } = await supabase.rpc(
    "detect_construmanager_version_transitions",
    { p_project_id: PROJECT_ID, p_sync_run_id: SYNC_RUN_ID }
  );

  if (error) throw new Error(error.message);

  const r = Array.isArray(data) ? data[0] : data;

  const primeiras = Number(r?.first_observations ?? 0);
  const transicoes = Number(r?.transitions ?? 0);
  const semMudanca = Number(r?.unchanged ?? 0);

  // (0,0,0) significa "nao havia execucao de sincronizacao pendente para
  // comparar". Isso e SUCESSO, nao erro: nada mudou porque nada foi
  // sincronizado desde a ultima verificacao. Tratar como falha encheria
  // o historico do agendador de vermelho em situacao normal — e vermelho
  // que aparece sempre para de significar alguma coisa.
  if (primeiras === 0 && transicoes === 0 && semMudanca === 0) {
    log("Nenhuma execucao de sincronizacao pendente de comparacao. Nada a fazer.");
    process.exit(0);
  }

  log(
    `primeiras observacoes: ${primeiras} | ` +
      `NOVAS VERSOES VIGENTES: ${transicoes} | ` +
      `sem mudanca: ${semMudanca}`
  );

  if ((r?.transitions ?? 0) > 0) {
    log(
      "Cada transicao gerou UMA entrada em construmanager_version_transitions " +
        "e UMA em audit_log_entries. Mudanca de versao documental segundo os " +
        "metadados oficiais; sem download nao se afirma que o conteudo binario difere."
    );
  }

  process.exit(0);
} catch (error) {
  log(`FALHA: ${sanitizeConstrumanagerContentError(error)}`);
  process.exit(1);
}
