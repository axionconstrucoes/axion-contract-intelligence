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


// ---------------------------------------------------------------------
// 11. TRES ESTADOS DA CONSULTA DE TRANSICOES
// ---------------------------------------------------------------------

const { getConstrumanagerVersionTransitions } = await import(
  "../apps/web/lib/integrations/construmanager/get-version-transitions.ts"
);

console.log("");
console.log("-- 11. consulta: sucesso com itens, sucesso vazio, falha --");

// Dublê do construtor do supabase-js: encadeia e resolve no fim.
function fakeQuery(resposta, registro) {
  const b = {
    select() { return b; },
    eq(col, val) { if (registro) registro.eq = { col, val }; return b; },
    order(col, opt) { if (registro) registro.order = { col, opt }; return b; },
    limit(n) { if (registro) registro.limit = n; return Promise.resolve(resposta); },
  };
  return b;
}

function fakeSupabase(resposta, registro) {
  return { from(tabela) { if (registro) registro.from = tabela; return fakeQuery(resposta, registro); } };
}

const LINHA = {
  id: "t1",
  construmanager_object_id: 38350763,
  document_name: "356-WEG-MET-3D-001-R05.ifc",
  previous_revision: "04",
  new_revision: "05",
  detected_at: "2026-09-10T12:00:00Z",
  source_created_at: "2026-09-10T09:00:00",
  author_name: "Equipe WEG",
  size_bytes: 275687647,
  folder_path: "\\PASTA",
  content_status: "SOMENTE_NO_CONSTRUMANAGER",
};

// Silencia o console.error das falhas, mas guarda o que foi registrado
// para poder auditar o conteudo.
const registrados = [];
const erroOriginal = console.error;
console.error = (...args) => registrados.push(args.join(" "));

{
  // A. SUCESSO COM ITENS
  const reg = {};
  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: [LINHA], error: null }, reg),
    "proj-1"
  );

  check("A. sucesso com itens => status OK", r.status === "OK");
  check("A. total e itens corretos", r.total === 1 && r.items.length === 1);
  check("A. revisao anterior e nova preservadas",
    r.items[0].previousRevision === "04" && r.items[0].newRevision === "05");
  check("A. situacao do conteudo normalizada",
    r.items[0].contentStatus === "SOMENTE_NO_CONSTRUMANAGER");
  check("A. filtra pelo projeto", reg.eq?.col === "project_id" && reg.eq?.val === "proj-1");
  check("A. ordena pelas mais recentes",
    reg.order?.col === "detected_at" && reg.order?.opt?.ascending === false);
  check("A. aplica limite", reg.limit === 10);
}

{
  // B. SUCESSO SEM ITENS
  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: [], error: null }),
    "proj-1"
  );

  check("B. sucesso vazio => status OK (NAO indisponivel)", r.status === "OK");
  check("B. total zero", r.status === "OK" && r.total === 0);
  check("B. nao registra erro no servidor", registrados.length === 0);
}

{
  // C1. VIEW AUSENTE — condicao temporaria, identificada
  registrados.length = 0;
  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: null, error: { code: "42P01", message: 'relation "x" does not exist' } }),
    "proj-1"
  );

  check("C1. view ausente => INDISPONIVEL", r.status === "INDISPONIVEL");
  check("C1. motivo identificado como VIEW_AUSENTE", r.reason === "VIEW_AUSENTE");
  check("C1. NAO finge lista vazia", r.status !== "OK");
  check("C1. registra no servidor", registrados.length === 1);
}

{
  // C1b. PostgREST tem codigo proprio para relacao ausente
  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: null, error: { code: "PGRST205", message: "not found in schema cache" } }),
    "proj-1"
  );
  check("C1b. PGRST205 tambem e VIEW_AUSENTE", r.reason === "VIEW_AUSENTE");
}

{
  // C2. PERMISSAO
  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: null, error: { code: "42501", message: "permission denied for view" } }),
    "proj-1"
  );

  check("C2. permissao negada => INDISPONIVEL", r.status === "INDISPONIVEL");
  check("C2. NAO e confundida com view ausente", r.reason === "ERRO_DE_CONSULTA");
}

{
  // C3. CONEXAO
  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: null, error: { message: "fetch failed" } }),
    "proj-1"
  );
  check("C3. erro de conexao => ERRO_DE_CONSULTA", r.reason === "ERRO_DE_CONSULTA");
}

{
  // C4. data nulo sem erro nao pode virar lista vazia
  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: null, error: null }),
    "proj-1"
  );
  check("C4. data nulo sem erro => INDISPONIVEL, nao vazio", r.status === "INDISPONIVEL");
}

{
  // C5. O erro registrado nao vaza segredo nem SQL ao usuario
  registrados.length = 0;
  await getConstrumanagerVersionTransitions(
    fakeSupabase({
      data: null,
      error: {
        code: "42501",
        message: "permission denied; Authorization: Bearer eyJhbGciOi.SEGREDO.xyz; select * from t",
      },
    }),
    "proj-1"
  );

  const r = await getConstrumanagerVersionTransitions(
    fakeSupabase({ data: null, error: { code: "42501", message: "x" } }),
    "proj-1"
  );

  check(
    "C5. o RESULTADO devolvido a UI nao carrega mensagem tecnica",
    !JSON.stringify(r).toLowerCase().includes("bearer") &&
      !JSON.stringify(r).toLowerCase().includes("select") &&
      Object.keys(r).sort().join(",") === "reason,status"
  );

  check(
    "C5. o log do servidor identifica projeto e codigo",
    registrados[0].includes("proj-1") && registrados[0].includes("42501")
  );
}

console.error = erroOriginal;

console.log("");
console.log("-- 12. painel: MONITORAMENTO DE VERSOES INDISPONIVEL --");

const PANEL = readFileSync(
  "apps/web/components/integrations/construmanager-version-transitions.tsx",
  "utf8"
);

check(
  "o painel avisa quando a consulta falha",
  /MONITORAMENTO DE VERSÕES INDISPONÍVEL/.test(PANEL)
);

check(
  "o aviso e vermelho, branco e negrito",
  /VERSION_MONITORING_UNAVAILABLE_CLASS =\s*"border-transparent bg-red-600 text-white font-bold"/.test(
    PANEL
  )
);

check(
  "falha e estado vazio sao caminhos DISTINTOS",
  /result\.status === "INDISPONIVEL"/.test(PANEL) &&
    /items\.length === 0\) return null/.test(PANEL)
);

check(
  "o aviso nao revela SQL, token ou detalhe interno",
  (() => {
    const i = PANEL.indexOf("INDISPONIVEL");
    const bloco = PANEL.slice(i, i + 900);
    return !/select |bearer|token|sqlstate|\.message/i.test(bloco);
  })()
);

check(
  "o aviso diz explicitamente que ausencia nao significa ausencia de versoes",
  /Isto não\s*\n?\s*significa que não existam/.test(PANEL)
);

console.log("");
console.log("-- 13. sincronizacao parcial na interface --");

const SYNC_UI = readFileSync(
  "apps/web/components/integrations/construmanager-metadata-sync.tsx",
  "utf8"
);
const ACTIONS = readFileSync("apps/web/app/[projectId]/integracoes/actions.ts", "utf8");
const STATE = readFileSync("apps/web/app/[projectId]/integracoes/actions-state.ts", "utf8");

check(
  "o estado carrega o aviso de monitoramento",
  /versionMonitoringFailed: boolean;/.test(STATE) &&
    /versionMonitoringFailed: false,/.test(STATE)
);

check(
  "a action marca o resultado parcial quando o detector falha",
  /const versionMonitoringFailed = Boolean\(detectError\);/.test(ACTIONS) &&
    /versionMonitoringFailed,\s*\};/.test(ACTIONS)
);

check(
  "a falha do detector NAO desfaz os metadados (nao ha throw nem rollback)",
  (() => {
    const i = ACTIONS.indexOf("const versionMonitoringFailed");
    const bloco = ACTIONS.slice(i, i + 700);
    return !/throw/.test(bloco) && /revalidatePath/.test(bloco);
  })()
);

check(
  "a action NAO fabrica transicao em caso de falha",
  !/insert into construmanager_version_transitions/i.test(ACTIONS)
);

check(
  "o log do servidor traz o sync_run para reprocessamento",
  /syncRunId: summary\.sync_run_id/.test(ACTIONS)
);

check(
  'a UI NAO mostra "Concluída" quando o monitoramento falha',
  /versionMonitoringFailed\s*\?\s*"Concluída parcialmente"/.test(SYNC_UI)
);

check(
  "a UI mostra a mensagem exigida, em negrito",
  /font-bold[^>]*>\s*\n?\s*METADADOS SINCRONIZADOS, MAS O MONITORAMENTO DE VERSÕES FALHOU/.test(
    SYNC_UI
  )
);

check(
  "a mensagem da UI nao carrega detalhe tecnico",
  (() => {
    const i = SYNC_UI.indexOf("METADADOS SINCRONIZADOS");
    const bloco = SYNC_UI.slice(i - 200, i + 200);
    return !/\.message|error\.|sqlstate/i.test(bloco);
  })()
);

console.log("");
console.log("-- 14. workers: exit code coerente com a falha --");

check(
  "metadata worker: falha do detector lanca (leva a exit 1)",
  /if \(detectError\) \{[\s\S]{0,600}?throw new Error\(detectError\.message\)/.test(
    METADATA_WORKER
  )
);

check(
  "metadata worker: o catch encerra com exit code 1",
  /catch \(error\)[\s\S]{0,300}process\.exit\(1\)/.test(METADATA_WORKER)
);

check(
  "metadata worker: avisa que o sync_run segue reprocessavel",
  /permanece disponivel para reprocessamento/.test(METADATA_WORKER)
);

check(
  "metadata worker: declara que nenhuma ingestao comeca pela falha",
  /Nenhuma ingestao de conteudo e iniciada por esta falha/.test(METADATA_WORKER)
);

check(
  "metadata worker: a falha nao dispara o content worker",
  !/construmanager-content-worker|storeConstrumanagerContent/.test(METADATA_WORKER)
);

check(
  "version monitor: sem execucao pendente e SUCESSO (exit 0)",
  /if \(primeiras === 0 && transicoes === 0 && semMudanca === 0\)[\s\S]{0,220}process\.exit\(0\)/.test(
    MONITOR
  )
);

check(
  "version monitor: erro real encerra com exit code 1",
  /catch \(error\)[\s\S]{0,200}process\.exit\(1\)/.test(MONITOR)
);

check(
  "version monitor: erro e sanitizado antes de logar",
  /sanitizeConstrumanagerContentError\(error\)/.test(MONITOR)
);

check(
  "o workflow deixa o step de metadados falhar (sem continue-on-error)",
  !/continue-on-error/.test(WORKFLOW)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
