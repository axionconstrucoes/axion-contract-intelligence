// Pacote D — ciclo HEADLESS: descobrir uma nova versao vigente sem
// clique humano.
//
// Prova que a sincronizacao de metadados tem duas portas para o MESMO
// nucleo, que o nucleo nao e alcancavel por ninguem, que o sync_run_id
// e sempre real, e que downloads permanecem desligados durante todo o
// processo.
//
// Nenhuma chamada real, nenhum Supabase, nenhuma rede: banco falso em
// memoria + auditoria do SQL e dos scripts.
//
// Uso: node scripts/test-construmanager-headless-sync.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveMetadataSyncEnabled, resolveVersionMonitoringEnabled, resolveAutomationConfig } =
  await import("../apps/web/lib/integrations/construmanager/automation-policy.ts");

const { evaluateVigency } = await import(
  "../apps/web/lib/integrations/construmanager/version-vigency.ts"
);

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL ${name}`);
    failed += 1;
  }
}

const MIGRATION = readFileSync(
  "supabase/migrations/20260905180000_construmanager_content_automation.sql",
  "utf8"
);
const MIG = MIGRATION.replace(/^\s*--.*$/gm, " ");

const METADATA_WORKER = readFileSync("scripts/construmanager-metadata-worker.mjs", "utf8");
const CONTENT_WORKER = readFileSync("scripts/construmanager-content-worker.mjs", "utf8");
const MONITOR = readFileSync("scripts/construmanager-version-monitor.mjs", "utf8");
const WORKFLOW = readFileSync(
  ".github/workflows/construmanager-content-ingestion.yml",
  "utf8"
);

const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("#"))
    .join("\n");

console.log("");
console.log("PACOTE D — CICLO HEADLESS");
console.log("=========================");
console.log("");
console.log("-- 1. nucleo compartilhado, sem duplicacao --");

check(
  "existe um nucleo unico de sincronizacao",
  /create or replace function public\.sync_construmanager_metadata_core\(/.test(MIG)
);

check(
  "o nucleo recebe ator e origem como parametros",
  /p_actor_user_id uuid,\s*p_source text/.test(MIG)
);

check(
  "o nucleo NAO checa sessao (quem decide autorizacao e a porta)",
  (() => {
    const i = MIG.indexOf("function public.sync_construmanager_metadata_core(");
    const corpo = MIG.slice(i, MIG.indexOf("$$;", i));
    return !corpo.includes("auth.uid()") && !corpo.includes("has_project_permission");
  })()
);

check(
  "a logica NAO foi duplicada: so um INSERT em construmanager_sync_runs",
  (MIG.match(/insert into public\.construmanager_sync_runs/g) ?? []).length === 1
);

check(
  "as duas portas chamam o MESMO nucleo",
  // Conta CALL SITES, nao mencoes: os revokes/grants tambem citam o nome.
  (MIG.match(/select \* from public\.sync_construmanager_metadata_core\(/g) ?? []).length === 2
);

console.log("");
console.log("-- 2. grants: nucleo fechado, portas distintas --");

const grantsBloco = MIG.slice(
  MIG.indexOf("revoke all on function public.sync_construmanager_metadata_core")
);

check(
  "NUCLEO revogado de public, anon, authenticated E service_role",
  ["public", "anon", "authenticated", "service_role"].every((papel) =>
    grantsBloco.includes(
      `sync_construmanager_metadata_core(uuid, bigint, bigint, timestamptz, jsonb, jsonb, jsonb, uuid, text) from ${papel}`
    )
  )
);

check(
  "NUCLEO nao tem grant de execucao para ninguem",
  !/grant execute on function public\.sync_construmanager_metadata_core/.test(MIG)
);

check(
  "PORTA MANUAL concedida a authenticated",
  /grant execute on function public\.sync_construmanager_metadata\(uuid, bigint, bigint, timestamptz, jsonb, jsonb, jsonb\) to authenticated/.test(
    MIG
  )
);

check(
  "PORTA MANUAL exige sessao e ADMINISTRADOR",
  (() => {
    const i = MIG.indexOf(
      "create or replace function public.sync_construmanager_metadata(\n  p_project_id uuid"
    );
    const corpo = MIG.slice(i, MIG.indexOf("$$;", i));
    return (
      corpo.includes("auth.uid()") &&
      corpo.includes("Sessao nao autenticada") &&
      corpo.includes("has_project_permission(p_project_id, 'ADMINISTRADOR')")
    );
  })()
);

check(
  "PORTA MANUAL fixa o ator: nao ha parametro para o usuario escolher SYSTEM",
  (() => {
    const i = MIG.indexOf(
      "create or replace function public.sync_construmanager_metadata(\n  p_project_id uuid"
    );
    const assinatura = MIG.slice(i, MIG.indexOf(")", MIG.indexOf("p_versions jsonb", i)));
    return !assinatura.includes("p_actor") && !assinatura.includes("p_source");
  })()
);

check(
  "PORTA MANUAL grava ator USER e origem MANUAL",
  /v_actor_user_id, 'MANUAL'/.test(MIG)
);

check(
  "PORTA SYSTEM concedida SOMENTE a service_role",
  /grant execute on function public\.sync_construmanager_metadata_system\(uuid, bigint, bigint, timestamptz, jsonb, jsonb, jsonb\) to service_role/.test(
    MIG
  )
);

check(
  "PORTA SYSTEM revogada de public, anon e authenticated",
  ["public", "anon", "authenticated"].every((papel) =>
    MIG.includes(
      `sync_construmanager_metadata_system(uuid, bigint, bigint, timestamptz, jsonb, jsonb, jsonb) from ${papel}`
    )
  )
);

check(
  "PORTA SYSTEM grava ator NULO e origem AUTOMATICO",
  /null, 'AUTOMATICO'/.test(MIG)
);

check(
  "a origem AUTOMATICO passou a ser aceita em construmanager_sync_runs",
  /check \(source in \('MANUAL', 'AUTOMATICO'\)\)/.test(MIG)
);

check(
  "o nucleo valida a origem recebida",
  /p_source not in \('MANUAL', 'AUTOMATICO'\)/.test(MIG)
);

console.log("");
console.log("-- 3. sync_run_id real e integridade referencial --");

check(
  "existe FOREIGN KEY de sync_run_id para construmanager_sync_runs",
  /foreign key \(sync_run_id\)\s*references public\.construmanager_sync_runs\(id\)/.test(MIG)
);

check(
  "a FK usa on delete restrict (evidencia nao some por cascata)",
  /references public\.construmanager_sync_runs\(id\)\s*on delete restrict/.test(MIG)
);

check(
  "o detector NAO fabrica mais sync_run_id",
  !/coalesce\(p_sync_run_id, gen_random_uuid\(\)\)/.test(MIG)
);

check(
  "sem id informado, o detector busca uma execucao REAL pendente",
  /coalesce\(\s*p_sync_run_id,\s*public\.pending_construmanager_sync_run\(p_project_id\)\s*\)/.test(
    MIG
  )
);

check(
  "sem execucao pendente, o detector encerra sem escrever",
  /if v_run_id is null then\s*return query select 0, 0, 0;/.test(MIG)
);

check(
  "o detector recusa execucao inexistente ou de outro projeto",
  /Execucao de sincronizacao inexistente ou de outro projeto/.test(MIG)
);

check(
  "pending_construmanager_sync_run so olha execucoes concluidas",
  /status in \('SUCESSO', 'PARCIAL'\)/.test(MIG)
);

check(
  "pending_construmanager_sync_run ignora execucoes ja comparadas",
  /not exists \(\s*select 1\s*from public\.construmanager_version_transitions t\s*where t\.sync_run_id = r\.id/.test(
    MIG
  )
);

console.log("");
console.log("-- 4. reprocessar o mesmo sync_run_id e idempotente --");

{
  const transicoes = [];
  let ponteiro = { objectId: 1, revision: "04" };

  function detectar(revisao, runId) {
    const atual = { objectId: 1, revision: revisao };
    const v = evaluateVigency(ponteiro, atual);
    if (v.outcome !== "NOVA_VERSAO_VIGENTE") return v.outcome;

    const duplicada = transicoes.some((t) => t.objectId === 1 && t.runId === runId);
    if (!duplicada) transicoes.push({ objectId: 1, runId, newRevision: revisao });

    ponteiro = atual;
    return v.outcome;
  }

  detectar("05", "run-real-1");
  check("primeira deteccao grava a transicao", transicoes.length === 1);

  // Reprocessar a MESMA observacao: ponteiro ja moveu => SEM_MUDANCA.
  const r = detectar("05", "run-real-1");
  check("reprocessar a mesma execucao nao duplica", transicoes.length === 1);
  check("e o resultado e SEM_MUDANCA, nao erro", r === "SEM_MUDANCA");
}

console.log("");
console.log("-- 5. metadata worker: coleta sem baixar --");

check(
  "existe um worker de metadados proprio",
  METADATA_WORKER.includes("sync_construmanager_metadata_system")
);

check(
  "usa a MESMA coleta validada do Pacote B",
  METADATA_WORKER.includes("collectConstrumanagerMetadata")
);

check(
  "checa o kill switch e o proprio interruptor antes de conectar",
  METADATA_WORKER.indexOf("resolveMetadataSyncEnabled(process.env)") <
    METADATA_WORKER.indexOf("createClient(")
);

check(
  "encerra sem conexao quando desligado",
  /if \(!decision\.enabled\)[\s\S]{0,240}process\.exit\(0\)/.test(METADATA_WORKER)
);

check(
  "NAO le a variavel de download",
  !semComentarios(METADATA_WORKER).includes("CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED")
);

check(
  "NAO baixa conteudo, nao abre ZIP, nao calcula SHA-256, nao toca Storage",
  !/downloadConstrumanagerContent|readZipDirectory|createHash|openAsBlob|\.storage\b|buildContentStoragePath/.test(
    semComentarios(METADATA_WORKER)
  )
);

check(
  "NAO chama Objeto/Download",
  !/Objeto\/Download|buildObjectDownloadBody|downloadObject/.test(semComentarios(METADATA_WORKER))
);

check(
  "NAO adquire lease",
  !METADATA_WORKER.includes("claim_construmanager_content_targets")
);

check(
  "obtem o sync_run_id REAL do retorno da RPC",
  /const syncRunId = syncData\.sync_run_id/.test(METADATA_WORKER)
);

check(
  "passa esse sync_run_id ao detector",
  /p_sync_run_id: syncRunId/.test(METADATA_WORKER)
);

check(
  "falha de persistencia impede a deteccao (throw antes)",
  METADATA_WORKER.indexOf("if (syncError) throw") <
    METADATA_WORKER.indexOf("detect_construmanager_version_transitions")
);

check(
  "falha de autenticacao e fail-closed (throw antes da coleta)",
  METADATA_WORKER.indexOf("await client.authenticate()") <
    METADATA_WORKER.indexOf("await collectConstrumanagerMetadata(")
);

check(
  "a deteccao tem interruptor separado dentro do proprio worker",
  /resolveVersionMonitoringEnabled\(process\.env\)/.test(METADATA_WORKER)
);

check(
  "erros sao sanitizados",
  /sanitizeConstrumanagerApiError\(error\)/.test(METADATA_WORKER)
);

check(
  "nenhum segredo literal",
  !/sb_secret_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{20,}\./.test(METADATA_WORKER)
);

console.log("");
console.log("-- 6. tres interruptores, zero acoplamento --");

check(
  "download desligado NAO impede sincronizacao",
  resolveMetadataSyncEnabled({
    CONSTRUMANAGER_METADATA_SYNC_ENABLED: "true",
  }).enabled === true &&
    resolveAutomationConfig({ CONSTRUMANAGER_METADATA_SYNC_ENABLED: "true" }).enabled === false
);

check(
  "download desligado NAO impede monitoramento",
  resolveVersionMonitoringEnabled({
    CONSTRUMANAGER_VERSION_MONITORING_ENABLED: "true",
  }).enabled === true
);

check(
  "CICLO COMPLETO com download DESLIGADO",
  (() => {
    const env = {
      CONSTRUMANAGER_METADATA_SYNC_ENABLED: "true",
      CONSTRUMANAGER_VERSION_MONITORING_ENABLED: "true",
    };
    return (
      resolveMetadataSyncEnabled(env).enabled === true &&
      resolveVersionMonitoringEnabled(env).enabled === true &&
      resolveAutomationConfig(env).enabled === false
    );
  })()
);

check(
  "kill switch derruba a sincronizacao tambem",
  resolveMetadataSyncEnabled({
    CONSTRUMANAGER_METADATA_SYNC_ENABLED: "true",
    CONSTRUMANAGER_AUTO_KILL_SWITCH: "true",
  }).enabled === false
);

check(
  "o content worker nao descobre revisao",
  !CONTENT_WORKER.includes("detect_construmanager_version_transitions") &&
    !CONTENT_WORKER.includes("collectConstrumanagerMetadata") &&
    !CONTENT_WORKER.includes("sync_construmanager_metadata")
);

check(
  "o monitor independente continua existindo",
  MONITOR.includes("detect_construmanager_version_transitions")
);

console.log("");
console.log("-- 7. workflow: tres steps independentes --");

check("nenhum schedule ativo", !/^\s{2}schedule:/m.test(WORKFLOW));
check("apenas disparo manual", /workflow_dispatch:/.test(WORKFLOW));

check(
  "step de metadados existe e vem primeiro",
  WORKFLOW.indexOf("Sync Construmanager metadata") <
    WORKFLOW.indexOf("Ingest Construmanager content")
);

check(
  "cada step tem seu proprio interruptor",
  (() => {
    const meta = WORKFLOW.slice(
      WORKFLOW.indexOf("Sync Construmanager metadata"),
      WORKFLOW.indexOf("Ingest Construmanager content")
    );
    const cont = WORKFLOW.slice(
      WORKFLOW.indexOf("Ingest Construmanager content"),
      WORKFLOW.indexOf("Monitor Construmanager version vigency")
    );
    const mon = WORKFLOW.slice(WORKFLOW.indexOf("Monitor Construmanager version vigency"));
    return (
      meta.includes("CONSTRUMANAGER_METADATA_SYNC_ENABLED") &&
      cont.includes("CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED") &&
      mon.includes("CONSTRUMANAGER_VERSION_MONITORING_ENABLED")
    );
  })()
);

check(
  "o step de metadados NAO recebe a variavel de download",
  (() => {
    const meta = WORKFLOW.slice(
      WORKFLOW.indexOf("Sync Construmanager metadata"),
      WORKFLOW.indexOf("Ingest Construmanager content")
    );
    return !meta.includes("CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED");
  })()
);

check(
  "falha no download nao impede a proxima sincronizacao (if: always)",
  (WORKFLOW.match(/if: always\(\)/g) ?? []).length >= 2
);

check(
  "o kill switch chega aos tres steps",
  (WORKFLOW.match(/CONSTRUMANAGER_AUTO_KILL_SWITCH/g) ?? []).length >= 3
);

console.log("");
console.log("-- 8. painel: NOVAS VERSOES VIGENTES --");

const PAINEL = readFileSync(
  "apps/web/components/integrations/construmanager-version-transitions.tsx",
  "utf8"
);
const LEITURA = readFileSync(
  "apps/web/lib/integrations/construmanager/get-version-transitions.ts",
  "utf8"
);
const CARD = readFileSync("apps/web/components/integrations/integration-card.tsx", "utf8");
const PAGE = readFileSync("apps/web/app/[projectId]/integracoes/page.tsx", "utf8");

check("o painel existe e tem o titulo exigido", /NOVAS VERSÕES VIGENTES/.test(PAINEL));

check(
  "o destaque e alto contraste, texto branco e negrito",
  /bg-amber-600 text-white font-bold/.test(PAINEL)
);

check(
  "o badge diz NOVA VERSÃO VIGENTE",
  /NOVA VERSÃO VIGENTE/.test(PAINEL)
);

for (const [nome, padrao] of [
  ["quantidade de transicoes", /NOVAS VERSÕES VIGENTES · \{items\.length\}/],
  ["documento", /item\.documentName/],
  ["revisao anterior e vigente", /item\.previousRevision[\s\S]{0,80}item\.newRevision/],
  ["data da deteccao", /item\.detectedAt/],
  ["autor", /item\.authorName/],
  ["tamanho", /item\.sizeBytes/],
  ["situacao do conteudo", /item\.contentStatus/],
]) {
  check(`o painel apresenta ${nome}`, padrao.test(PAINEL));
}

check(
  "as tres situacoes de conteudo tem rotulo",
  /ARMAZENADO_NO_ACC: "Armazenado no ACC"/.test(PAINEL) &&
    /PENDENTE: "Pendente"/.test(PAINEL) &&
    /SOMENTE_NO_CONSTRUMANAGER: "Somente no Construmanager"/.test(PAINEL)
);

check(
  "o painel NAO classifica a mudanca como erro",
  (() => {
    // Remove comentarios de linha E de bloco: a prosa que EXPLICA a
    // decisao ("nao classifica como erro") nao pode ser confundida com a
    // classificacao em si.
    const semProsa = PAINEL.replace(/\/\*[\s\S]*?\*\//g, " ").replace(
      /^\s*\/\/.*$/gm,
      " "
    );
    return !/erro|error|falha/i.test(semProsa);
  })()
);

check(
  "o painel declara o limite (sem download nao se afirma conteudo binario)",
  /Sem download não é possível afirmar se o conteúdo/.test(PAINEL)
);

check(
  "nenhuma acao remota de reconhecimento improvisada",
  !/onClick|formAction|useActionState|<form/.test(PAINEL)
);

check(
  "a leitura usa a view com security_invoker (RLS preservada)",
  /construmanager_recent_version_transitions/.test(LEITURA) &&
    /security_invoker = true/.test(MIGRATION)
);

check(
  "o painel esta ligado ao card e a pagina",
  /<ConstrumanagerVersionTransitions/.test(CARD) &&
    /getConstrumanagerVersionTransitions\(supabase, projectId\)/.test(PAGE) &&
    /construmanagerTransitions=\{/.test(PAGE)
);

check(
  "a novidade aparece ANTES do painel de download",
  CARD.indexOf("<ConstrumanagerVersionTransitions") <
    CARD.indexOf("<ConstrumanagerContentDownload")
);

console.log("");
console.log("-- 9. arquivo grande: R05 detectada, zero download --");

check(
  "REFERENCIA_EXTERNA preservada como estado",
  /'PENDENTE', 'BAIXANDO', 'ARMAZENADO', 'ERRO', 'REFERENCIA_EXTERNA'/.test(MIG)
);

check(
  "referencia externa nunca entra na fila do claim",
  (() => {
    const claim =
      MIG.match(/function public\.claim_construmanager_content_targets[\s\S]*?\$\$;/)?.[0] ?? "";
    return claim.length > 0 && !claim.includes("REFERENCIA_EXTERNA");
  })()
);

check(
  "a deteccao de vigencia NAO depende de conteudo fisico",
  (() => {
    const det =
      MIG.match(
        /function public\.detect_construmanager_version_transitions[\s\S]*?\$\$;/
      )?.[0] ?? "";
    return (
      det.length > 0 &&
      !/sha256|content_blob_id|storage\./i.test(det) &&
      det.includes("download_status = 'ARMAZENADO'") // so para dizer ONDE esta
    );
  })()
);

check(
  "a view reporta SOMENTE_NO_CONSTRUMANAGER para referencia externa",
  /when l\.download_status = 'REFERENCIA_EXTERNA' then 'SOMENTE_NO_CONSTRUMANAGER'/.test(MIG)
);

check(
  "o IFC grande seria detectado: a regra so olha revisao, nao tamanho",
  (() => {
    const v = evaluateVigency(
      { objectId: 38350763, revision: "04" },
      { objectId: 38350763, revision: "05" }
    );
    return v.outcome === "NOVA_VERSAO_VIGENTE";
  })()
);

console.log("");
console.log("-- 10. integridade sintatica do SQL (guard) --");

{
  // Defeito real encontrado por banco local: um terminador $$; virou $;
  // por causa de escaping de shell numa edicao. Os testes por regex
  // passaram todos — nenhum deles analisa SQL. Este guard existe para
  // que essa classe de bug nao volte em silencio.
  const ocorrencias = (MIGRATION.match(/\$\$/g) ?? []).length;

  check(
    `delimitadores $$ balanceados (${ocorrencias} ocorrencias, deve ser par)`,
    ocorrencias % 2 === 0
  );

  check(
    "nenhum terminador corrompido ($ sozinho em linha)",
    !/^\s*\$\s*;\s*$/m.test(MIGRATION)
  );

  // Alias `r` em subconsulta dentro de funcao plpgsql que declara `r
  // record`: o PL/pgSQL resolve r.coluna para a VARIAVEL, nao para a
  // tabela, e a funcao falha em runtime com "record r is not assigned
  // yet". Outro defeito que so o banco real pegou.
  check(
    "detector nao usa alias `r` colidindo com a variavel de registro",
    (() => {
      const i = MIGRATION.indexOf(
        "function public.detect_construmanager_version_transitions"
      );
      const corpo = MIGRATION.slice(i, MIGRATION.indexOf("$$;", i));
      const declaraR = /^\s*r record;/m.test(corpo);
      const usaAliasR = /from public\.\w+ r\b/.test(corpo);
      return declaraR && !usaAliasR;
    })()
  );

  check(
    "toda funcao criada tem um $$ de abertura e um de fechamento",
    (MIGRATION.match(/^as \$\$/gm) ?? []).length +
      (MIGRATION.match(/^do \$\$/gm) ?? []).length ===
      (MIGRATION.match(/^\$\$;/gm) ?? []).length
  );
}

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
