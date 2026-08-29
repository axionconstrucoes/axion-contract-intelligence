// VÍNCULO CONTRATUAL REAL (documents.contractual_*) — migration
// 20260829090000_document_contractual_attachment_linkage.sql (AINDA
// NÃO APLICADA nesta rodada), RPCs link_document_as_contractual_attachment/
// unlink_document_contractual_attachment, Server Actions, UI e pipeline
// do Expert Jurídico.
//
// Sem banco real disponível nesta rodada (a migration não foi
// aplicada) — cobertura por leitura estrutural do SQL/código-fonte
// (mesmo padrão já usado por scripts/test-multi-document-upload.mjs
// para as migrations dessa feature) + execução real das funções PURAS
// (mapeadores, algoritmo de detecção de ciclo reimplementado em JS
// para provar a lógica).
//
// Uso:
//   node scripts/test-document-contractual-attachment-linkage.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("VÍNCULO CONTRATUAL REAL — documents.contractual_* (migration 20260829090000)");
console.log("======================================");
console.log("");

const migration = readSource("supabase/migrations/20260829090000_document_contractual_attachment_linkage.sql");

// ---------- 1/2: mesmo projeto exigido, entre projetos recusado ----------

check("1/2. link_document_as_contractual_attachment: exige filho E pai no MESMO projeto — vínculo entre projetos é recusado", () => {
  assert(migration.includes("if v_child_project_id is distinct from p_project_id then"), "checagem de projeto do filho ausente");
  assert(migration.includes("raise exception 'Documento filho pertence a outro projeto';"));
  assert(migration.includes("and d.project_id = p_project_id"), "resolução do pai deveria filtrar por project_id também");
});

// ---------- concorrência: bloqueio de linha no documento-pai ----------

check("concorrência: a RPC de vínculo lockeia o PAI com FOR SHARE (permite vínculos simultâneos ao mesmo pai, bloqueia UPDATE de kind/project_id concorrente) — nunca um SELECT solto", () => {
  const linkFnBody = migration.slice(
    migration.indexOf("create or replace function public.link_document_as_contractual_attachment"),
    migration.indexOf("alter function public.link_document_as_contractual_attachment")
  );
  const parentSelectIndex = linkFnBody.indexOf("select d.kind\n  into v_parent_kind");
  assert(parentSelectIndex !== -1, "SELECT do pai não encontrado na RPC");
  const forShareIndex = linkFnBody.indexOf("for share;", parentSelectIndex);
  assert(forShareIndex !== -1 && forShareIndex - parentSelectIndex < 300, "o SELECT do pai na RPC de vínculo deveria terminar em FOR SHARE");
});

check("concorrência: o trigger de validação TAMBÉM lockeia o pai com FOR SHARE (nunca confia só no SELECT feito pela RPC antes dele) — redundante de propósito, um lock repetido na mesma transação nunca causa deadlock consigo mesma", () => {
  const triggerFnBody = migration.slice(
    migration.indexOf("create or replace function public.documents_validate_contractual_link"),
    migration.indexOf("create trigger documents_validate_contractual_link_trigger")
  );
  const parentSelectIndex = triggerFnBody.indexOf("select d.project_id, d.kind\n  into v_parent_project_id, v_parent_kind");
  assert(parentSelectIndex !== -1, "SELECT do pai não encontrado no trigger");
  const forShareIndex = triggerFnBody.indexOf("for share;", parentSelectIndex);
  assert(forShareIndex !== -1 && forShareIndex - parentSelectIndex < 300, "o SELECT do pai no trigger de validação deveria terminar em FOR SHARE");
});

check("concorrência: nenhum SELECT solto (sem FOR SHARE/FOR UPDATE) resolve o documento-pai em nenhum dos dois pontos (RPC, trigger) — os únicos 'select ... from public.documents' que leem o pai por id terminam sempre em algum lock", () => {
  const forShareCount = (migration.match(/for share;/g) ?? []).length;
  assert(forShareCount === 2, `esperado FOR SHARE exatamente 2x (RPC de vínculo + trigger de validação), encontrado ${forShareCount}x`);
});

check("prova de concorrência DETERMINÍSTICA (não roteiro manual): runner Node abre 2 sessões psql reais + 1 admin/monitor, chama as RPCs de verdade com usuário autenticado real, e confirma bloqueio via pg_stat_activity — nunca por sleep/timing", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes("pollUntilBlockedBy"), "runner deveria confirmar bloqueio de verdade, não por timing");
  assert(runnerSource.includes("wait_event_type"), "confirmação de bloqueio deveria consultar pg_stat_activity.wait_event_type");
  assert(runnerSource.includes("link_document_as_contractual_attachment"), "runner deveria chamar a RPC real, nunca um UPDATE direto simulando o vínculo");
  assert(runnerSource.includes("set local role authenticated;"), "runner deveria simular uma sessão authenticated real");
  assert(runnerSource.includes("request.jwt.claim.sub"), "runner deveria simular auth.uid() via a claim real do JWT (verificada em auth.uid() do próprio projeto)");
  assert(runnerSource.includes("lock_timeout"), "runner deveria configurar lock_timeout (item 4 do pedido)");
  assert(runnerSource.includes("statement_timeout"), "runner deveria configurar statement_timeout (item 4 do pedido)");
  assert(runnerSource.includes("ACC_CONCURRENCY_TEST_DATABASE_URL"), "runner deveria exigir a connection string explicitamente — nunca adivinhar/usar a do projeto real");
  assert(runnerSource.includes("ACC_CONCURRENCY_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE"), "runner deveria exigir confirmação explícita de que o banco é descartável");
});

// ---------- item 3: prova de QUEM bloqueia quem (pg_blocking_pids), não só wait_event_type ----------

check("CRÍTICO — prova de bloqueio identifica O BLOQUEADOR ESPECÍFICO via pg_blocking_pids(), nunca só wait_event_type='Lock' sozinho (que só prova que ALGO bloqueia, não QUEM)", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes("pg_blocking_pids("), "runner deveria usar pg_blocking_pids() para provar quem é o bloqueador específico");
  assert(
    runnerSource.includes("any(pg_blocking_pids("),
    "a checagem deveria confirmar que o PID esperado do bloqueador está entre os bloqueadores reais (= any(pg_blocking_pids(...)))"
  );
  assert(runnerSource.includes("resolveBackendPid"), "runner deveria resolver o PID de cada sessão real (pg_backend_pid()), não presumir");
  const bothOrderingsUsePidCheck = (runnerSource.match(/await pollUntilBlockedBy\(/g) ?? []).length;
  assert(bothOrderingsUsePidCheck === 2, `pollUntilBlockedBy deveria ser CHAMADO (await) nos dois ordenamentos (encontrado ${bothOrderingsUsePidCheck}x)`);
});

check("prova de concorrência: cobre COMMIT e ROLLBACK da mudança do pai (ordenamento 2), para KIND e para PROJECT_ID — 4 cenários distintos, não só 'kind com rollback'", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes('changeKind: "kind"') && runnerSource.includes('changeKind: "project_id"'), "deveria cobrir tanto kind quanto project_id");
  assert(runnerSource.includes("changeCommits: true") && runnerSource.includes("changeCommits: false"), "deveria cobrir tanto COMMIT quanto ROLLBACK da mudança do pai");
  const scenarioCount = (runnerSource.match(/name: "ORDENAMENTO/g) ?? []).length;
  assert(scenarioCount === 6, `esperado 6 cenários nomeados (2 do ordenamento 1 + 4 do ordenamento 2), encontrado ${scenarioCount}`);
});

check("prova de concorrência: usa 'EDITAL', um valor REAL e verificado de documents_kind_check (nunca presumido) — nunca 'OUTRO' sem checagem prévia", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes("kind = 'EDITAL'"), "runner deveria usar um valor de kind não-contratual real");
  const kindCheckSource = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(kindCheckSource.includes("'EDITAL'"), "EDITAL precisa realmente existir em documents_kind_check — verificado, não presumido");
});

check("prova de concorrência: consulta de estado final consistente (zero linhas sempre) existe como arquivo dedicado, reaproveitado pelo runner após CADA cenário", () => {
  const consistencySource = readSource("scripts/sql/contractual-link-consistency-check.sql");
  assert(
    consistencySource.includes("parent.kind not in ('CONTRATO_BASE', 'ADITIVO')") &&
      consistencySource.includes("parent.project_id is distinct from child.project_id")
  );
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes("contractual-link-consistency-check.sql"));
});

check("prova de concorrência: fixtures reaproveitam a MESMA pré-condição de usuário de teste que supabase/seed.sql já usa (auth-login-test@axion-test.local) — nunca insere direto em auth.users", () => {
  const fixturesSource = readSource("scripts/sql/contractual-link-concurrency-fixtures.sql");
  assert(fixturesSource.includes("auth-login-test@axion-test.local"));
  assert(
    !/\b(insert|update|delete)\s+into\s+auth\.users\b/i.test(fixturesSource) && !/\binto\s+auth\.users\b/i.test(fixturesSource),
    "o fixture nunca deveria escrever diretamente em auth.users — só ler o profile já existente, mesma convenção do seed.sql do projeto (uma menção em comentário/mensagem de erro explicando essa regra é esperada)"
  );
  const seedSource = readSource("supabase/seed.sql");
  assert(seedSource.includes("auth-login-test@axion-test.local"), "confirma que este é o MESMO usuário de teste já usado pelo seed real do projeto, não um novo inventado");
});

check("prova de concorrência: limpeza (cleanup) apaga só os UUIDs fixos dos DOCUMENTOS do fixture, roda em finally mesmo se um cenário falhar", () => {
  const cleanupSource = readSource("scripts/sql/contractual-link-concurrency-cleanup.sql");
  assert(cleanupSource.includes("99999999-9999-4999-8999-999999999911"));
  assert(!/delete from public\.\w+;\s*$/m.test(cleanupSource), "nenhum DELETE sem WHERE (nunca um delete amplo)");
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  const finallyIndex = runnerSource.indexOf("} finally {");
  const cleanupHelperCallIndex = runnerSource.indexOf("closeWorkSessionsThenCleanup([linkSession, changeSession]", finallyIndex);
  assert(finallyIndex !== -1 && cleanupHelperCallIndex !== -1 && cleanupHelperCallIndex > finallyIndex, "a limpeza deveria estar dentro de um bloco finally, via o helper que garante a ordem correta");
});

check("CRÍTICO — descoberto rodando de verdade contra a stack descartável (não presumido): cleanup NUNCA tenta apagar audit_log_entries/project_memberships/projects — são efetivamente permanentes (audit_log_entries é append-only por trigger; a membership ADMINISTRADOR de teste não pode ser removida sem deixar o projeto sem administrador, outro trigger real)", () => {
  const cleanupSource = readSource("scripts/sql/contractual-link-concurrency-cleanup.sql");
  assert(!/delete\s+from\s+public\.audit_log_entries/i.test(cleanupSource), "audit_log_entries é append-only (prevent_audit_log_entry_mutation) — um DELETE aqui sempre falharia");
  assert(!/delete\s+from\s+public\.project_memberships/i.test(cleanupSource), "a membership ADMINISTRADOR de teste não pode ser removida sozinha (prevent_last_administrator_removal) — um DELETE aqui sempre falharia");
  assert(!/delete\s+from\s+public\.projects/i.test(cleanupSource), "projects nunca fica sem audit_log_entries associada (FK restrict) — um DELETE aqui sempre falharia");
  assert(cleanupSource.includes("append-only"), "deveria documentar POR QUE audit/memberships/projects nunca são apagados aqui — descoberta real, não presumida");
});

// ---------- item 4: cleanup só DEPOIS das sessões de trabalho terem terminado de verdade ----------

check("CRÍTICO — ordem de encerramento correta (item 4): as sessões de vínculo/mudança são fechadas e o runner AGUARDA o processo psql delas sair de verdade ANTES de rodar o cleanup — nunca cleanup primeiro, que arriscaria travar numa transação/lock ainda aberto", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  const helperIndex = runnerSource.indexOf("async function closeWorkSessionsThenCleanup(");
  assert(helperIndex !== -1, "deveria existir um helper dedicado que garante a ordem: fechar sessões de trabalho, DEPOIS cleanup");
  const helperBody = runnerSource.slice(helperIndex, runnerSource.indexOf("\n}", helperIndex));
  const closeCallIndex = helperBody.indexOf("workSessions.map((session) => session.close())");
  const cleanupCallIndex = helperBody.indexOf("runCleanup(adminSession)");
  assert(closeCallIndex !== -1 && cleanupCallIndex !== -1 && closeCallIndex < cleanupCallIndex, "o fechamento das sessões de trabalho deveria vir ANTES da chamada de cleanup, dentro do mesmo helper");
  assert(helperBody.includes("await Promise.all("), "o fechamento das sessões de trabalho deveria ser de fato aguardado (await), não fire-and-forget");

  const closeFnIndex = runnerSource.indexOf("function close(");
  const closeFnBody = runnerSource.slice(closeFnIndex, runnerSource.indexOf("\n  return {", closeFnIndex));
  assert(closeFnBody.includes("return exitPromise"), "close() deveria devolver uma Promise que resolve quando o processo psql realmente sai — permitindo ao caller de fato aguardar (item 4)");
  assert(closeFnBody.includes("proc.on(\"exit\"") || runnerSource.includes('proc.on("exit"'), "deveria escutar o evento real de saída do processo, não presumir");
});

// ---------- item 2: validação estrita de ambiente/URL (nunca truthy, nunca porta/host da stack real ou remoto) ----------

check("CRÍTICO — confirmação de ambiente descartável exige a string EXATA \"true\" (comparação estrita ===), nunca um truthy-check que aceitaria \"false\"/\"0\"/\"no\" como confirmação válida", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(
    runnerSource.includes('ACC_CONCURRENCY_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true"'),
    'a checagem deveria ser uma comparação estrita contra a string exata "true", nunca `if (!process.env.X)` (que aceitaria qualquer valor não-vazio, inclusive "false")'
  );
  assert(!/if\s*\(\s*!process\.env\.ACC_CONCURRENCY_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE\s*\)/.test(runnerSource), "não deveria mais existir o truthy-check antigo");
});

check("CRÍTICO — a DATABASE_URL do teste de concorrência só é aceita para localhost/127.0.0.1/::1, com porta na faixa reservada ao banco descartável — a stack Supabase LOCAL EXISTENTE do projeto (portas reais confirmadas em supabase/config.toml) é recusada explicitamente, e nenhum host remoto é aceito mesmo com a confirmação setada", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes("function parseAndValidateDatabaseUrl("), "deveria existir uma função dedicada de validação da URL");
  assert(runnerSource.includes('ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"'), "só localhost/127.0.0.1/::1 deveriam ser aceitos como host");
  assert(runnerSource.includes("LOCAL_STACK_PORT_RANGE"), "deveria existir uma faixa de portas explicitamente reservada para RECUSAR a stack local real");
  assert(runnerSource.includes("EXACT_DISPOSABLE_PORT"), "deveria exigir a PORTA EXATA verificada nesta execução para o banco descartável — nunca uma faixa genérica");
  assert(runnerSource.includes("if (port !== EXACT_DISPOSABLE_PORT)"), "a checagem deveria ser uma comparação exata (!==), nunca um intervalo, contra a porta escolhida nesta execução");
  assert(
    runnerSource.includes('if (containerNameRaw !== EXACT_DISPOSABLE_DB_CONTAINER)'),
    "deveria também exigir o NOME EXATO do container Postgres descartável (psql não está disponível no PATH do host — o transporte real é docker exec)"
  );

  const configSource = readSource("supabase/config.toml");
  // Só linhas de configuração ATIVAS (nunca comentadas com #) — o
  // config.toml tem exemplos comentados (ex.: "# port = 587" sob um
  // bloco SMTP de exemplo) que não são portas reais da stack local.
  const realPorts = configSource
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .flatMap((line) => [...line.matchAll(/\bport\s*=\s*(\d+)/g)])
    .map((m) => Number(m[1]));
  assert(realPorts.length > 0, "deveria haver portas reais configuradas em supabase/config.toml para comparar");
  const rangeMatch = runnerSource.match(/LOCAL_STACK_PORT_RANGE = \[(\d+), (\d+)\]/);
  assert(rangeMatch, "LOCAL_STACK_PORT_RANGE deveria ser um array [min, max] literal");
  const [min, max] = [Number(rangeMatch[1]), Number(rangeMatch[2])];
  for (const port of realPorts) {
    assert(port >= min && port <= max, `porta real ${port} (supabase/config.toml) deveria cair dentro de LOCAL_STACK_PORT_RANGE [${min}, ${max}] para ser corretamente recusada`);
  }

  assert(
    runnerSource.includes("Porta ${port} pertence à faixa da stack Supabase LOCAL EXISTENTE"),
    "deveria haver uma mensagem de erro explícita recusando portas da stack local real"
  );
  assert(
    runnerSource.includes("ACC_CONCURRENCY_TEST_DATABASE_URL aponta para o host"),
    "deveria haver uma mensagem de erro explícita recusando hosts não permitidos"
  );
  assert(
    runnerSource.includes("NUNCA um host remoto, mesmo com a confirmação"),
    "deveria deixar explícito que nenhum host remoto é aceito mesmo com a confirmação de descartável setada"
  );
});

// ---------- item 5: runner sempre roda cleanup ANTES de cada fixture ----------

check("prova de concorrência: runner roda runCleanup ANTES de runFixtures em todo cenário — nunca confia em ON CONFLICT DO UPDATE para 'resetar' uma fixture que sobrou de uma execução anterior interrompida", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  const scenarioFnIndex = runnerSource.indexOf("async function runConcurrencyScenario(");
  const scenarioFnBody = runnerSource.slice(scenarioFnIndex, runnerSource.indexOf("\n// ====", scenarioFnIndex));
  const cleanupIndex = scenarioFnBody.indexOf("await runCleanup(adminSession)");
  const fixturesIndex = scenarioFnBody.indexOf("await runFixtures(adminSession");
  assert(cleanupIndex !== -1 && fixturesIndex !== -1 && cleanupIndex < fixturesIndex, "runCleanup deveria rodar antes de runFixtures em runConcurrencyScenario");

  const optimisticFnIndex = runnerSource.indexOf("async function runOptimisticConcurrencyScenarios(");
  const optimisticFnBody = runnerSource.slice(optimisticFnIndex, runnerSource.indexOf("\n// ----------", optimisticFnIndex + 10));
  const cleanupIndex2 = optimisticFnBody.indexOf("await runCleanup(adminSession)");
  const fixturesIndex2 = optimisticFnBody.indexOf("await runFixtures(adminSession");
  assert(cleanupIndex2 !== -1 && fixturesIndex2 !== -1 && cleanupIndex2 < fixturesIndex2, "runCleanup deveria rodar antes de runFixtures também no cenário de conflito otimista (item 7)");
});

check("fixtures: DOCUMENTOS nunca usam ON CONFLICT DO UPDATE resetando colunas contratuais diretamente (o trigger recusaria isso fora de uma RPC real) — INSERT direto, protegido pela pré-limpeza do runner. PROJECTS/MEMBERSHIPS usam ON CONFLICT DO NOTHING de propósito (descoberto rodando de verdade: são permanentes, nunca apagados — ver item de cleanup)", () => {
  const fixturesSource = readSource("scripts/sql/contractual-link-concurrency-fixtures.sql");
  // Remove linhas de comentário SQL antes de checar — o próprio
  // arquivo documenta em comentário que "ON CONFLICT DO UPDATE" foi
  // removido, o que faria essa frase aparecer no texto sem ser código
  // real (mesma armadilha já vista antes nesta suíte com citações
  // multi-linha).
  const fixturesCodeOnly = fixturesSource
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  assert(!/on conflict[^;]*do update/is.test(fixturesCodeOnly), "fixtures nunca deveriam usar ON CONFLICT DO UPDATE em lugar nenhum (fora de comentário) — nem projects/memberships (idempotência ali é DO NOTHING) nem documents (o trigger recusaria)");
  assert(fixturesSource.includes("on conflict (id) do nothing"), "projects deveria ser idempotente via ON CONFLICT DO NOTHING (permanente, nunca apagado pelo cleanup)");
  assert(fixturesSource.includes("on conflict (project_id, user_id) do nothing"), "project_memberships deveria ser idempotente via ON CONFLICT DO NOTHING (a membership ADMINISTRADOR nunca pode ser removida sozinha)");
  assert(
    !/^\\quit\s*$/m.test(fixturesSource),
    "fixtures não deveriam mais conter um \\quit como COMANDO real (uma menção em comentário explicando por que foi removido é esperada) — mataria a sessão persistente do runner antes do marcador de conclusão, travando o runner"
  );
  assert(fixturesSource.includes("into strict"), "a checagem de pré-condição do usuário de teste deveria usar SELECT ... INTO STRICT (erro real e detectável, não um \\if silencioso)");
  assert(fixturesSource.includes("raise exception 'FIXTURE_PRECONDITION_MISSING"), "ausência do profile de teste deveria produzir um erro SQL real e detectável");
});

// ---------- item 6: exec() com SQLSTATE determinístico, throw-by-default em erro inesperado ----------

check("CRÍTICO — exec() do runner captura SQLSTATE determinístico via as variáveis especiais do psql (:SQLSTATE/:ERROR), nunca depende de reconhecer o texto 'ERROR'/'ERRO' na saída (que pode variar por locale/idioma do cliente)", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes("ACC_KV sqlstate=:SQLSTATE"), "deveria ecoar o SQLSTATE real da última operação via a variável especial do psql");
  assert(runnerSource.includes("ACC_KV error=:ERROR"), "deveria ecoar o ERROR real da última operação via a variável especial do psql");
  assert(!/stdout\.includes\(["']ERROR["']\)|stdout\.includes\(["']ERRO["']\)/.test(runnerSource), "não deveria decidir sucesso/erro varrendo a saída em busca do texto ERROR/ERRO");
});

check("CRÍTICO — exec() falha automaticamente (throw) em QUALQUER erro SQL não explicitamente esperado; um erro só é aceito quando o caller declara o SQLSTATE/mensagem esperados, e um erro que não bate com o esperado TAMBÉM falha o teste", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  const validateFnIndex = runnerSource.indexOf("function validateExpectation(");
  assert(validateFnIndex !== -1, "deveria existir uma função dedicada de validação de expectativa de erro");
  const validateFnBody = runnerSource.slice(validateFnIndex, runnerSource.indexOf("\n  }\n\n  async function resolveBackendPid", validateFnIndex));
  assert(validateFnBody.includes("erro SQL NÃO ESPERADO"), "um erro sem 'expect' declarado deveria lançar explicitamente como não-esperado");
  assert(validateFnBody.includes("SQLSTATE inesperado"), "um erro esperado, mas com SQLSTATE diferente do declarado, também deveria falhar");
  assert(validateFnBody.includes("messagePattern") && validateFnBody.includes("não bate com o padrão"), "um erro esperado, mas com mensagem que não bate com o padrão declarado, também deveria falhar");
  assert(validateFnBody.includes("esperava erro"), "uma operação que deveria ter falhado (mustError) mas teve sucesso também deveria falhar o teste");
});

check("todas as etapas de setup/fixtures/autenticação/commit/rollback/cleanup passam pelo mesmo exec() com validação de erro por padrão — nenhuma chamada 'crua' ao processo psql que ignore erro silenciosamente", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes('await session.exec("begin;")') || runnerSource.includes("await session.exec(\"begin;\")"), "begin deveria passar por exec()");
  assert(runnerSource.includes('await session.exec("commit;")'), "commit deveria passar por exec()");
  assert(runnerSource.includes("set local role authenticated"), "a elevação de role deveria passar por exec() (um statement por vez, não embutido em SQL multi-statement)");
  const authFnIndex = runnerSource.indexOf("function beginAuthenticatedTransaction(");
  const authFnBody = runnerSource.slice(authFnIndex, runnerSource.indexOf("\n}", authFnIndex));
  const execCallCount = (authFnBody.match(/session\.exec\(/g) ?? []).length;
  assert(execCallCount === 3, `beginAuthenticatedTransaction deveria dividir begin/set role/set jwt claim em 3 chamadas exec() separadas (uma por statement, para atribuição correta de SQLSTATE), encontrado ${execCallCount}`);
});

// ---------- item 7: conflito otimista testado contra a RPC REAL (não reimplementação em JS) ----------

check("CRÍTICO — teste de NULL é contra a RPC REAL do Postgres (não reimplementação da condição SQL em JavaScript): usa DOIS pais contratuais válidos fixturados (contrato-base + aditivo) e passa um SQL NULL de verdade para p_confirm_parent_change", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(runnerSource.includes("async function runOptimisticConcurrencyScenarios("), "deveria existir uma suíte dedicada de conflito otimista contra a RPC real");
  assert(runnerSource.includes("aditivoB"), "deveria usar o segundo pai contratual válido fixturado (aditivo)");
  assert(runnerSource.includes("confirm: null") && runnerSource.includes('confirmLiteral = confirm === null ? "null"'), "deveria passar um SQL NULL literal (não apenas 'undefined' do JS) para p_confirm_parent_change");
  assert(runnerSource.includes("CONFIRMATION_REQUIRED"), "deveria validar a mensagem real devolvida pela RPC, não reimplementar a checagem em JS");
  assert(runnerSource.includes("CONFLICT_STALE_PARENT"), "deveria também cobrir o caso de pai esperado desatualizado (stale)");

  const fixturesSource = readSource("scripts/sql/contractual-link-concurrency-fixtures.sql");
  assert(fixturesSource.includes("'ADITIVO', 'Aditivo de teste"), "fixtures deveriam realmente criar um segundo pai contratual válido (ADITIVO), não só o contrato-base");
});

check("teste de NULL verifica, no BANCO, após cada tentativa recusada (false, NULL, pai desatualizado), que o pai realmente NÃO mudou — nunca confia só no código de retorno da RPC", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  const fnIndex = runnerSource.indexOf("async function runOptimisticConcurrencyScenarios(");
  const fnBody = runnerSource.slice(fnIndex, runnerSource.indexOf("\n// ----------", fnIndex + 10));
  const verificationCalls = (fnBody.match(/await currentParentOf\(/g) ?? []).length;
  assert(verificationCalls >= 5, `esperava pelo menos 5 verificações de estado real do pai no banco (uma por etapa relevante), encontrado ${verificationCalls}`);
  assert(fnBody.includes("NULL NÃO PODE CONTORNAR A CONFIRMAÇÃO"), "deveria haver uma asserção explícita de que SQL NULL não contorna a exigência de confirmação (a armadilha de 'not NULL' avaliando NULL)");
});

// ---------- item 8: verificação de estado final por CONTAGEM exata, nunca texto localizado ----------

check("CRÍTICO — verificação de estado final (consistência + zero-fixtures-remanescentes) é por CONTAGEM/BOOLEANO exato via ACC_KV (\\gset + \\echo), nunca por texto localizado como '(0 rows)'/'(0 linhas)'", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  assert(!/\(0 rows\)|\(0 linhas\)/.test(runnerSource), "o runner não deveria mais depender de texto de confirmação localizado");
  assert(runnerSource.includes("kvPattern") && runnerSource.includes("ACC_KV"), "o runner deveria fazer parsing determinístico das linhas ACC_KV key=value");
  assert(runnerSource.includes('Number(result.kv.remaining_fixture_count)') || runnerSource.includes("remaining_fixture_count"), "a verificação de zero-fixtures deveria comparar um número exato, não texto");
  assert(runnerSource.includes("invalidCount !== 0") || runnerSource.includes("invalid_link_count"), "a verificação de consistência deveria comparar um número exato, não texto");

  const consistencySource = readSource("scripts/sql/contractual-link-consistency-check.sql");
  assert(consistencySource.includes("count(*)") && consistencySource.includes("\\gset"), "consistency-check.sql deveria usar count(*) + \\gset, não uma tabela solta para o humano ler visualmente");

  const cleanupSource = readSource("scripts/sql/contractual-link-concurrency-cleanup.sql");
  assert(cleanupSource.includes("acc_remaining_fixture_count") && cleanupSource.includes("\\gset"), "cleanup.sql deveria produzir uma contagem determinística final, não depender de inspeção visual");
});

// ---------- 3: autorreferência recusada ----------

check("3. autorreferência (documento pai de si mesmo) recusada em DUAS camadas: CHECK constraint no banco + trigger", () => {
  assert(migration.includes("check (contractual_parent_document_id is distinct from id)"), "CHECK constraint de autorreferência ausente");
  assert(migration.includes("if new.contractual_parent_document_id = new.id then"), "trigger deveria também checar autorreferência");
  assert(migration.includes("raise exception 'Documento não pode ser pai de si mesmo';"));
});

// ---------- 4: ciclo recusado (estrutural + reimplementação em JS da mesma lógica) ----------

check("4. ciclo recusado: trigger chama documents_contractual_link_would_cycle antes de aceitar o vínculo", () => {
  assert(migration.includes("if public.documents_contractual_link_would_cycle(new.id, new.contractual_parent_document_id) then"));
  assert(migration.includes("raise exception 'Vínculo recusado: geraria um ciclo entre documentos';"));
});

// Reimplementação em JS do MESMO algoritmo SQL (documents_contractual_link_would_cycle):
// percorre a cadeia de pais a partir de startingParentId; se encontrar
// childId, há ciclo. Prova a lógica, não a function SQL real (sem
// banco disponível para testar isso de ponta a ponta nesta rodada).
function wouldCycle(childId, startingParentId, parentById) {
  let currentId = startingParentId;
  let depth = 0;
  while (true) {
    if (currentId === childId) return true;
    depth += 1;
    if (depth > 50) return true;
    const nextParentId = parentById.get(currentId) ?? null;
    if (nextParentId === null) return false;
    currentId = nextParentId;
  }
}

check("4b. algoritmo de detecção de ciclo (reimplementado em JS a partir do SQL): ciclo direto A<->B é recusado", () => {
  const parentById = new Map([["B", "A"]]); // B's parent is A
  assert(wouldCycle("A", "B", parentById) === true, "vincular A como filho de B deveria detectar o ciclo A->B->A");
});

check("4c. algoritmo de detecção de ciclo: cadeia sem ciclo (A -> B -> C) é aceita", () => {
  const parentById = new Map([["B", "C"]]); // B's parent is C
  assert(wouldCycle("A", "B", parentById) === false, "vincular A a B (que já aponta para C) não deveria ser um ciclo");
});

check("4d. algoritmo de detecção de ciclo: ciclo indireto de 3 nós (A -> B -> C -> A) é recusado", () => {
  const parentById = new Map([
    ["B", "C"],
    ["C", "A"],
  ]);
  assert(wouldCycle("A", "B", parentById) === true, "vincular A a B, onde B->C->A, deveria detectar o ciclo indireto");
});

check("4e. algoritmo de detecção de ciclo: profundidade acima de 50 é tratada como ciclo (fail-closed), mesmo sem um ciclo real — nunca percorre indefinidamente", () => {
  // Cadeia linear de 60 documentos sem nenhum ciclo real (doc59 -> doc58
  // -> ... -> doc0, sem voltar). O limite de profundidade (>50) deveria
  // interromper e devolver "ciclo" mesmo aqui — comportamento fail-closed
  // documentado na migration (seção 2), nunca um loop sem fim.
  const parentById = new Map();
  for (let i = 59; i >= 1; i -= 1) {
    parentById.set(`doc${i}`, `doc${i - 1}`);
  }
  assert(
    wouldCycle("nunca-presente", "doc59", parentById) === true,
    "cadeia com mais de 50 elos deveria ser tratada como ciclo (fail-closed), mesmo sendo uma cadeia linear sem ciclo real"
  );
});

check("4f. migration documenta o limite de profundidade (> 50) e o comportamento fail-closed explicitamente", () => {
  assert(migration.includes("v_depth > 50"));
  assert(migration.includes("return true;"), "acima do limite, a function deveria devolver true (trata como ciclo)");
  assert(/fail-closed/i.test(migration));
});

// ---------- 5/6: pai inválido / tipo inválido recusado ----------

check("5. pai inexistente é recusado (RPC: v_parent_kind fica null quando o pai não é encontrado/válido; trigger: 'not found')", () => {
  assert(migration.includes("if v_parent_kind is null then"));
  assert(migration.includes("raise exception 'Documento pai inválido para este projeto';"));
  assert(migration.includes("if not found then\n    raise exception 'Documento pai não encontrado';"));
});

check("6. pai de tipo diferente de CONTRATO_BASE/ADITIVO é recusado — no RPC (WHERE d.kind in (...)) e no trigger (segunda camada, fail-closed inclusive contra NULL)", () => {
  assert(migration.includes("and d.kind in ('CONTRATO_BASE', 'ADITIVO')\n  for share;"), "RPC deveria filtrar o pai por kind, sob FOR SHARE");
  assert(
    migration.includes("if v_parent_kind is null or v_parent_kind not in ('CONTRATO_BASE', 'ADITIVO') then"),
    "trigger deveria validar o tipo do pai de novo, rejeitando também NULL explicitamente (fail-closed)"
  );
  assert(migration.includes("raise exception 'Documento pai precisa ser do tipo CONTRATO_BASE ou ADITIVO';"));
});

check("6b. filho CONTRATO_BASE é recusado — contrato-base é SEMPRE documento principal, nunca anexo de outro (CHECK constraint + trigger)", () => {
  assert(
    migration.includes("check (\n    contractual_parent_document_id is null\n    or kind not in ('CONTRATO_BASE', 'ADITIVO')\n  );"),
    "CHECK constraint documents_contractual_instrument_never_child_check ausente ou com forma inesperada"
  );
  assert(migration.includes("documents_contractual_instrument_never_child_check"));
  assert(migration.includes("if new.kind in ('CONTRATO_BASE', 'ADITIVO') then"), "trigger deveria recusar CONTRATO_BASE/ADITIVO como filho de novo");
  assert(migration.includes("raise exception 'Contrato-base e aditivo nunca podem ser anexo de outro documento';"));
});

check("6c. filho ADITIVO é recusado — MESMA CHECK constraint e trigger do 6b cobrem os dois valores juntos (CONTRATO_BASE e ADITIVO), nunca uma regra separada por tipo", () => {
  const checkBlock = migration.slice(
    migration.indexOf("documents_contractual_instrument_never_child_check"),
    migration.indexOf("documents_contractual_instrument_never_child_check") + 300
  );
  assert(checkBlock.includes("'CONTRATO_BASE', 'ADITIVO'"), "a mesma CHECK deveria cobrir os dois valores, não só CONTRATO_BASE");
});

// ---------- 7/8: membro não ACTIVE / sem permissão recusado (via can_manage_project_documents reaproveitada) ----------

check("7/8. membro não ACTIVE e usuário sem permissão são recusados por REAPROVEITAR can_manage_project_documents — nenhuma regra paralela criada", () => {
  const linkOccurrences = (migration.match(/if not public\.can_manage_project_documents\(p_project_id\) then/g) ?? []).length;
  assert(linkOccurrences === 2, `esperado can_manage_project_documents chamada 2x (link + unlink), encontrado ${linkOccurrences}x`);
  assert(!migration.includes("create or replace function public.can_manage_project_documents"), "esta migration não deveria redefinir can_manage_project_documents — só reaproveitar a existente (20260825130000)");
  assert(!/status\s*=\s*'ACTIVE'/.test(migration), "esta migration não deveria reimplementar a checagem de status ACTIVE — isso já vive dentro de can_manage_project_documents");
});

// ---------- 9: fundamento vazio recusado ----------

check("9. fundamento da incorporação curto/vazio (menos de 20 caracteres úteis após normalizar QUALQUER whitespace, não só trim() de espaço comum) é recusado — RPC (atalho, mensagem amigável), trigger (segunda camada) E uma CHECK constraint (garantia real, inclusive contra escrita privilegiada com triggers desabilitados E sem depender de EXECUTE em nenhuma function)", () => {
  assert(migration.includes("v_basis := public.normalize_contractual_text(p_incorporation_basis);"));
  assert(migration.includes("if v_basis is null or length(v_basis) < 20 then"), "RPC deveria recusar fundamento com menos de 20 caracteres úteis");
  assert(migration.includes("Fundamento da incorporação deve ter pelo menos 20 caracteres úteis"));
  assert(
    migration.includes("v_normalized_basis := public.normalize_contractual_text(new.contractual_incorporation_basis);"),
    "trigger deveria normalizar o fundamento com a mesma função"
  );
  assert(
    migration.includes("if v_normalized_basis is null or length(v_normalized_basis) < 20 then"),
    "trigger deveria recusar fundamento curto de novo"
  );
  assert(
    migration.includes("documents_contractual_incorporation_basis_length_check"),
    "deveria existir uma CHECK constraint de comprimento — garantia que vale mesmo com triggers desabilitados"
  );
  // A CHECK usa a expressão INLINADA (só builtins), NUNCA chama
  // public.normalize_contractual_text() — ver check 9d para o motivo
  // (permissão) e a prova de que a function não é referenciada ali.
  assert(
    migration.includes(
      "nullif(regexp_replace(contractual_incorporation_basis, '^\\s+|\\s+$', '', 'g'), '') is not null"
    ),
    "a CHECK constraint deveria checar IS NOT NULL explicitamente sobre a expressão inlinada (NULL numa CHECK é aceito, não rejeitado — precisa ser determinado)"
  );
  assert(
    migration.includes(
      "length(nullif(regexp_replace(contractual_incorporation_basis, '^\\s+|\\s+$', '', 'g'), '')) >= 20"
    )
  );
  assert(migration.includes("length(contractual_incorporation_basis) <= 2000"), "deveria haver um limite máximo (2000 caracteres) contra abuso/crescimento desnecessário da auditoria");
});

check("9b. normalize_contractual_text remove QUALQUER whitespace (tab/quebra de linha, não só espaço comum) das pontas e devolve NULL quando só sobra whitespace — MESMA regra nos QUATRO lugares (RPC de vínculo, trigger, RPC de desvinculação chamam a function; a CHECK usa a mesma expressão inlinada)", () => {
  assert(migration.includes("create or replace function public.normalize_contractual_text(p_value text)"));
  assert(migration.includes("select nullif(regexp_replace(p_value, '^\\s+|\\s+$', '', 'g'), '');"));
  assert(migration.includes("language sql"));
  assert(migration.includes("immutable"), "precisa ser IMMUTABLE (mesmo não sendo mais chamada pela CHECK, continua sendo usada pelas 3 outras validações procedurais)");

  // Só CHAMADAS de verdade (atribuição "v_x := public.normalize_contractual_text(...)")
  // — ignora a definição, os REVOKE/ALTER OWNER e as menções em
  // comentário. RPC de vínculo (1) + trigger (1) + RPC de desvinculação
  // (1) = exatamente 3; a CHECK NUNCA aparece nesta lista.
  const procedureCalls = migration.match(/:= public\.normalize_contractual_text\(/g) ?? [];
  assert(procedureCalls.length === 3, `esperado normalize_contractual_text CHAMADA (não só mencionada) em exatamente 3 lugares procedurais, encontrado ${procedureCalls.length}`);

  const inlineRegexUsages = (
    migration.match(/regexp_replace\(contractual_incorporation_basis, '\^\\s\+\|\\s\+\$', '', 'g'\)/g) ?? []
  ).length;
  // A CHECK usa a MESMA expressão regex inlinada 2x (uma vez no IS NOT
  // NULL, outra vez no length(...) >= 20) — mesma regra, sem chamar a
  // function.
  assert(inlineRegexUsages === 2, `esperado a expressão regex inlinada 2x na CHECK constraint, encontrado ${inlineRegexUsages}`);
});

check("9c. mínimo de 20 e máximo de 2000 aplicados de forma consistente nos QUATRO lugares: CHECK constraint, RPC de vínculo, trigger, RPC de desvinculação", () => {
  const min20Occurrences = (migration.match(/< 20|>= 20/g) ?? []).length;
  assert(min20Occurrences >= 4, `esperado o limite mínimo (20) referenciado em pelo menos 4 lugares, encontrado ${min20Occurrences}`);
  const max2000Occurrences = (migration.match(/> 2000|<= 2000/g) ?? []).length;
  assert(max2000Occurrences >= 4, `esperado o limite máximo (2000) referenciado em pelo menos 4 lugares, encontrado ${max2000Occurrences}`);
});

check("9d. a CHECK constraint de comprimento do fundamento NUNCA chama nenhuma function custom (só builtins: regexp_replace/nullif/length) — elimina qualquer dependência de GRANT EXECUTE, protegendo inclusive uploads/escritas diretas de roles sem esse grant", () => {
  const startIndex = migration.indexOf("add constraint documents_contractual_incorporation_basis_length_check");
  const checkClauseStart = migration.indexOf("check (", startIndex);
  const checkClauseEnd = migration.indexOf(");", checkClauseStart);
  const checkBlock = migration.slice(checkClauseStart, checkClauseEnd);
  assert(!checkBlock.includes("public."), "a CHECK constraint não deveria chamar nenhuma function do schema public — só builtins");
  assert(!checkBlock.includes("normalize_contractual_text"), "a CHECK constraint não deveria referenciar normalize_contractual_text de forma alguma");
});

check("9e. investigação registrada: existe pelo menos um caminho de escrita direta em documents fora das RPCs desta migration (link-email-attachment-to-document.ts) — motivo real, não hipotético, para a CHECK nunca depender de EXECUTE numa function", () => {
  assert(
    migration.includes("link-email-attachment-to-document.ts"),
    "a migration deveria documentar a evidência concreta encontrada (não apenas uma preocupação abstrata)"
  );
  const linkerSource = readSource("apps/web/lib/email/attachments/link-email-attachment-to-document.ts");
  assert(linkerSource.includes('.from("documents")') && linkerSource.includes(".insert("), "a evidência citada na migration deveria corresponder a um INSERT real neste arquivo");
});

// ---------- 10/11: vínculo e troca de pai geram auditoria ----------

check("10/11. link_document_as_contractual_attachment grava DOCUMENT_CONTRACTUAL_ATTACHMENT_LINKED com pai/fundamento/usuário/data ANTERIORES e NOVOS (auditoria completa, cobre também TROCA de pai)", () => {
  assert(migration.includes("'DOCUMENT_CONTRACTUAL_ATTACHMENT_LINKED',"));
  assert(migration.includes("Pai anterior: %s. Pai novo: %s"));
  assert(migration.includes("Fundamento anterior: %s. Fundamento novo: %s."));
  assert(migration.includes("Usuário anterior do vínculo: %s. Usuário novo do vínculo: %s."), "auditoria deveria registrar usuário anterior e novo");
  assert(migration.includes("Data anterior do vínculo: %s. Data nova do vínculo: %s."), "auditoria deveria registrar data anterior e nova");
  assert(migration.includes("Ator desta ação: %s. Momento desta ação: %s."), "auditoria deveria registrar ator e momento da própria ação");
  assert(migration.includes("v_previous_parent_id"), "deveria capturar o pai anterior antes do UPDATE, para poder registrar a troca");
  assert(migration.includes("v_previous_linked_by"), "deveria capturar o usuário anterior do vínculo antes do UPDATE");
  assert(migration.includes("v_previous_linked_at"), "deveria capturar a data anterior do vínculo antes do UPDATE");
});

check("auditoria (link) fica na MESMA transação do UPDATE — nenhum COMMIT/savepoint intermediário na function, então uma falha no INSERT de auditoria reverte o vínculo inteiro", () => {
  const fnBody = migration.slice(
    migration.indexOf("create or replace function public.link_document_as_contractual_attachment"),
    migration.indexOf("alter function public.link_document_as_contractual_attachment")
  );
  const fnBodyCodeOnly = fnBody
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert(!/\bcommit\b/i.test(fnBodyCodeOnly), "a function não deveria conter nenhum COMMIT em código executável — a transação é sempre a do chamador (menção em comentário explicando isso é esperada)");
  assert(!/\bsavepoint\b/i.test(fnBodyCodeOnly), "a function não deveria conter nenhum SAVEPOINT em código executável que isolasse a auditoria de uma falha");
  const updateIndex = fnBody.indexOf("update public.documents");
  const insertAuditIndex = fnBody.indexOf("insert into public.audit_log_entries");
  assert(updateIndex !== -1 && insertAuditIndex !== -1 && updateIndex < insertAuditIndex, "o UPDATE do vínculo deveria vir antes do INSERT de auditoria, na mesma function/transação");
});

// ---------- 12/13: desvinculação exige justificativa e gera auditoria ----------

check("12. unlink_document_contractual_attachment exige justificativa (p_reason) com pelo menos 20 caracteres ÚTEIS (mesma normalize_contractual_text do vínculo) — RPC recusa antes de qualquer escrita", () => {
  assert(migration.includes("v_reason := public.normalize_contractual_text(p_reason);"));
  assert(migration.includes("if v_reason is null or length(v_reason) < 20 then"));
  assert(migration.includes("Justificativa da desvinculação deve ter pelo menos 20 caracteres úteis"));
});

check("13. unlink_document_contractual_attachment grava DOCUMENT_CONTRACTUAL_ATTACHMENT_UNLINKED com pai/fundamento/usuário/data ANTERIORES *e os NOVOS explicitamente* ('(nenhum)'/'(nenhuma)'), a justificativa e ator/momento da ação — nunca deixa os valores novos só implícitos em 'removido'", () => {
  assert(migration.includes("'DOCUMENT_CONTRACTUAL_ATTACHMENT_UNLINKED',"));
  assert(migration.includes("Justificativa da desvinculação: %s."));
  assert(migration.includes("Pai anterior: %s. Pai novo: (nenhum)."), "auditoria deveria declarar explicitamente 'Pai novo: (nenhum)'");
  assert(migration.includes("Fundamento anterior: %s. Fundamento novo: (nenhum)."), "auditoria deveria declarar explicitamente 'Fundamento novo: (nenhum)'");
  assert(migration.includes("Usuário anterior do vínculo: %s. Usuário novo do vínculo: (nenhum)."), "auditoria deveria declarar explicitamente 'Usuário novo do vínculo: (nenhum)'");
  assert(migration.includes("Data anterior do vínculo: %s. Data nova do vínculo: (nenhuma)."), "auditoria deveria declarar explicitamente 'Data nova do vínculo: (nenhuma)'");
  assert(migration.includes("Ator desta ação: %s. Momento desta ação: %s."));
});

check("auditoria (unlink) também na MESMA transação do UPDATE — nenhum COMMIT/savepoint intermediário", () => {
  const fnBody = migration.slice(
    migration.indexOf("create or replace function public.unlink_document_contractual_attachment"),
    migration.indexOf("alter function public.unlink_document_contractual_attachment")
  );
  assert(!/\bcommit\b/i.test(fnBody));
  assert(!/\bsavepoint\b/i.test(fnBody));
  const updateIndex = fnBody.indexOf("update public.documents");
  const insertAuditIndex = fnBody.indexOf("insert into public.audit_log_entries");
  assert(updateIndex !== -1 && insertAuditIndex !== -1 && updateIndex < insertAuditIndex);
});

// ---------- 14: metadados preenchidos no servidor ----------

check("14. usuário e data do vínculo são SEMPRE preenchidos no servidor (auth.uid()/now()) — nunca aceitos como parâmetro do cliente", () => {
  assert(migration.includes("v_user_id := auth.uid();"));
  assert(!/p_(linked_by|user_id|linked_at|linkedAt)/.test(migration), "nenhuma RPC deveria aceitar usuário/data como parâmetro vindo do cliente");
  assert(migration.includes("contractual_linked_by_user_id = v_user_id,"));
  assert(migration.includes("contractual_linked_at = now()"));
});

// ---------- concorrência otimista: pai esperado + confirmação de troca ----------

check("concorrência otimista: link_document_as_contractual_attachment tem p_expected_parent_document_id e p_confirm_parent_change na assinatura", () => {
  assert(
    migration.includes(
      "create or replace function public.link_document_as_contractual_attachment(\n  p_project_id uuid,\n  p_child_document_id uuid,\n  p_parent_document_id uuid,\n  p_incorporation_basis text,\n  p_expected_parent_document_id uuid,\n  p_confirm_parent_change boolean default false\n)"
    ),
    "assinatura da RPC não tem os dois novos parâmetros na forma esperada"
  );
});

check("concorrência otimista: recusa com CONFLICT_STALE_PARENT quando o pai atual (relido sob FOR UPDATE do filho) é diferente do pai esperado pelo caller", () => {
  assert(
    migration.includes("if v_previous_parent_id is distinct from p_expected_parent_document_id then"),
    "deveria comparar o pai atual (já lido) com o esperado"
  );
  assert(migration.includes("CONFLICT_STALE_PARENT:"), "mensagem deveria ter o prefixo estável CONFLICT_STALE_PARENT (o Server Action casa por esse prefixo)");
});

check("concorrência otimista: trocar para um pai DIFERENTE de um vínculo já existente exige p_confirm_parent_change = true; atualizar só o fundamento do MESMO pai nunca exige isso", () => {
  const linkFnBody = migration.slice(
    migration.indexOf("create or replace function public.link_document_as_contractual_attachment"),
    migration.indexOf("alter function public.link_document_as_contractual_attachment")
  );
  assert(
    linkFnBody.includes(
      "if v_previous_parent_id is not null\n     and v_previous_parent_id is distinct from p_parent_document_id\n     and p_confirm_parent_change is not true then"
    ),
    "condição de troca de pai não encontrada na forma esperada — precisa exigir pai anterior não nulo, pai novo diferente do anterior e p_confirm_parent_change IS NOT TRUE"
  );
  assert(linkFnBody.includes("CONFIRMATION_REQUIRED:"), "mensagem deveria ter o prefixo estável CONFIRMATION_REQUIRED");
});

check("CRÍTICO — NULL não contorna a confirmação: a condição usa 'p_confirm_parent_change IS NOT TRUE', NUNCA 'not p_confirm_parent_change'. Em PL/pgSQL, 'not NULL' avalia NULL (não TRUE) e o IF inteiro (AND com esse NULL) nunca dispara — uma troca de pai passaria sem confirmação se o caller enviasse NULL. 'IS NOT TRUE' é sempre um booleano determinado: TRUE para FALSE ou para NULL, FALSE só para TRUE.", () => {
  assert(
    !migration.includes("and not p_confirm_parent_change"),
    "a forma vulnerável a NULL (not p_confirm_parent_change) não deveria mais existir em lugar nenhum da migration"
  );
  assert(migration.includes("p_confirm_parent_change is not true"), "deveria usar exatamente IS NOT TRUE");
  assert(
    migration.includes("`not p_confirm_parent_change`") || migration.includes('"not p_confirm_parent_change"'),
    "a migration deveria documentar POR QUE a forma antiga era vulnerável (nunca só corrigir silenciosamente)"
  );
});

check("concorrência otimista: p_confirm_parent_change é validado DENTRO da RPC (servidor) — nunca só confiado a um checkbox do navegador", () => {
  const linkFnBody = migration.slice(
    migration.indexOf("create or replace function public.link_document_as_contractual_attachment"),
    migration.indexOf("alter function public.link_document_as_contractual_attachment")
  );
  assert(linkFnBody.includes("p_confirm_parent_change is not true"), "a validação de confirmação deveria estar dentro do corpo da function, não delegada ao chamador");
});

// Reimplementação em JS EXATA da lógica de decisão da RPC (mesma
// técnica de wouldCycle acima) — prova o COMPORTAMENTO dos 5 cenários
// pedidos sem precisar de um Postgres real. `null`/`undefined` em JS
// representam SQL NULL; a função abaixo espelha
// "v_previous_parent_id IS DISTINCT FROM p_expected_parent_document_id"
// e "... AND p_confirm_parent_change IS NOT TRUE" caractere por
// caractere.
function isDistinctFrom(a, b) {
  // SQL IS DISTINCT FROM: null tratado como um valor comparável (dois
  // nulls NÃO são distintos entre si), nunca propaga NULL como em `=`.
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return a !== b;
}

function decideLinkOutcome({ previousParentId, expectedParentId, newParentId, confirmParentChange }) {
  if (isDistinctFrom(previousParentId, expectedParentId)) {
    return "CONFLICT_STALE_PARENT";
  }
  if (
    previousParentId !== null &&
    isDistinctFrom(previousParentId, newParentId) &&
    confirmParentChange !== true // espelha "IS NOT TRUE": false OU null (OU qualquer outra coisa) => bloqueia
  ) {
    return "CONFIRMATION_REQUIRED";
  }
  return "OK";
}

check("cenário: p_confirm_parent_change = false ao trocar de pai existente → RECUSADO (CONFIRMATION_REQUIRED)", () => {
  const outcome = decideLinkOutcome({
    previousParentId: "parent-A",
    expectedParentId: "parent-A",
    newParentId: "parent-B",
    confirmParentChange: false,
  });
  assert(outcome === "CONFIRMATION_REQUIRED", `esperado CONFIRMATION_REQUIRED, obtido ${outcome}`);
});

check("cenário CRÍTICO: p_confirm_parent_change = null (NÃO omitido — enviado explicitamente) ao trocar de pai existente → RECUSADO (CONFIRMATION_REQUIRED), NUNCA passa silenciosamente", () => {
  const outcome = decideLinkOutcome({
    previousParentId: "parent-A",
    expectedParentId: "parent-A",
    newParentId: "parent-B",
    confirmParentChange: null,
  });
  assert(outcome === "CONFIRMATION_REQUIRED", `NULL não deveria contornar a confirmação — esperado CONFIRMATION_REQUIRED, obtido ${outcome}`);
});

check("cenário: p_confirm_parent_change = true ao trocar de pai existente → PERMITIDO", () => {
  const outcome = decideLinkOutcome({
    previousParentId: "parent-A",
    expectedParentId: "parent-A",
    newParentId: "parent-B",
    confirmParentChange: true,
  });
  assert(outcome === "OK", `esperado OK, obtido ${outcome}`);
});

check("cenário: MESMO pai (só atualizando o fundamento) → PERMITIDO SEM confirmação, mesmo com confirmParentChange=false/null", () => {
  for (const confirmParentChange of [false, null, undefined]) {
    const outcome = decideLinkOutcome({
      previousParentId: "parent-A",
      expectedParentId: "parent-A",
      newParentId: "parent-A",
      confirmParentChange,
    });
    assert(outcome === "OK", `atualizar o fundamento do mesmo pai nunca deveria exigir confirmação (confirmParentChange=${confirmParentChange}), obtido ${outcome}`);
  }
});

check("cenário: pai esperado pelo caller DESATUALIZADO (divergente do real) → CONFLICT_STALE_PARENT, verificado ANTES da checagem de confirmação", () => {
  const outcome = decideLinkOutcome({
    previousParentId: "parent-A",
    expectedParentId: "parent-B", // a tela achava que já era B — desatualizada
    newParentId: "parent-C",
    confirmParentChange: true, // mesmo confirmando, o conflito de staleness vem primeiro
  });
  assert(outcome === "CONFLICT_STALE_PARENT", `esperado CONFLICT_STALE_PARENT, obtido ${outcome}`);
});

check("cenário: primeiro vínculo (sem pai anterior, expectedParentId=null) nunca exige confirmação, mesmo com confirmParentChange=false/null", () => {
  for (const confirmParentChange of [false, null, undefined]) {
    const outcome = decideLinkOutcome({
      previousParentId: null,
      expectedParentId: null,
      newParentId: "parent-A",
      confirmParentChange,
    });
    assert(outcome === "OK", `primeiro vínculo nunca deveria exigir confirmação, obtido ${outcome} (confirmParentChange=${confirmParentChange})`);
  }
});

check("Server Action linkDocumentAsContractualAttachmentAction envia p_expected_parent_document_id/p_confirm_parent_change e distingue CONFLICT_STALE_PARENT de CONFIRMATION_REQUIRED por prefixo estável (nunca por texto livre)", () => {
  const actionsSource = readSource("apps/web/app/[projectId]/documentos/actions.ts");
  assert(actionsSource.includes("p_expected_parent_document_id: expectedParentDocumentId,"));
  assert(actionsSource.includes("p_confirm_parent_change: confirmParentChange,"));
  assert(actionsSource.includes('error.message.includes("CONFLICT_STALE_PARENT")'));
  assert(actionsSource.includes('error.message.includes("CONFIRMATION_REQUIRED")'));
  assert(actionsSource.includes("conflict: true,"));
  assert(actionsSource.includes("confirmationRequired: true,"));
});

check("UI: LinkContractualAttachmentControl envia expectedParentDocumentId (o que a TELA acha que é o pai atual, currentParentId) e confirmParentChange (estado real do checkbox) — nunca hardcoded", () => {
  const controlSource = readSource("apps/web/components/documents/link-contractual-attachment-control.tsx");
  assert(controlSource.includes('name="expectedParentDocumentId" value={currentParentId ?? ""}'));
  assert(controlSource.includes('name="confirmParentChange" value={changeConfirmed ? "true" : "false"}'));
  assert(controlSource.includes("state.conflict"), "a UI deveria reagir ao estado de conflito (sugerir recarregar)");
  assert(controlSource.includes("window.location.reload()"), "conflito deveria oferecer recarregar a página, nunca reenviar o mesmo formulário desatualizado");
});

// ---------- 15/16: PUBLIC/anon sem execução, search_path fixo ----------

check("15. as duas RPCs revogam PUBLIC/anon e concedem SÓ a authenticated — SEM grant a service_role (a RPC exige auth.uid(), uma chamada com a chave de service role não tem usuário autenticado; nenhum grant foi inventado sem caso de uso real)", () => {
  for (const fn of [
    "link_document_as_contractual_attachment(uuid, uuid, uuid, text, uuid, boolean)",
    "unlink_document_contractual_attachment(uuid, uuid, text)",
  ]) {
    assert(migration.includes(`revoke execute on function public.${fn} from public;`), `${fn} deveria revogar de public`);
    assert(migration.includes(`revoke execute on function public.${fn} from anon;`), `${fn} deveria revogar de anon`);
    assert(migration.includes(`grant execute on function public.${fn} to authenticated;`), `${fn} deveria conceder a authenticated`);
    assert(!migration.includes(`grant execute on function public.${fn} to service_role;`), `${fn} NÃO deveria conceder a service_role (nenhum auth.uid() disponível nesse contexto)`);
  }
});

check("15b. as QUATRO functions auxiliares/trigger (normalize, cycle, validate, protect-integrity) revogam PUBLIC, anon E authenticated — nunca expostas como RPC, só uso interno", () => {
  for (const fn of [
    "normalize_contractual_text(text)",
    "documents_contractual_link_would_cycle(uuid, uuid)",
    "documents_validate_contractual_link()",
    "documents_protect_contractual_link_integrity()",
  ]) {
    assert(migration.includes(`revoke execute on function public.${fn} from public;`), `${fn} deveria revogar de public`);
    assert(migration.includes(`revoke execute on function public.${fn} from anon;`), `${fn} deveria revogar de anon`);
    assert(migration.includes(`revoke execute on function public.${fn} from authenticated;`), `${fn} deveria revogar de authenticated também — nunca chamável como RPC`);
  }
});

check("16. search_path fixo (set search_path = '') em TODAS as 6 functions novas desta migration (normalize, cycle, validate-link trigger, protect-integrity trigger, link, unlink) — nenhuma resolução ambígua de schema", () => {
  // Âncora de início de linha (^create..., multiline) — nunca um
  // .split() por substring solta, que também capturaria a MENÇÃO a
  // "create or replace function" dentro de um comentário explicativo.
  const functionStarts = [...migration.matchAll(/^create or replace function/gm)];
  assert(functionStarts.length === 6, `esperado 6 functions novas, encontrado ${functionStarts.length}`);

  const functionNames = migration.match(/^create or replace function public\.(\w+)/gm) ?? [];
  assert(
    functionNames.length === 6 &&
      new Set(functionNames.map((s) => s.replace("create or replace function public.", ""))).size === 6,
    "os 6 nomes de function deveriam ser distintos"
  );

  const boundaries = [...functionStarts.map((m) => m.index), migration.length];
  for (let i = 0; i < functionStarts.length; i += 1) {
    const block = migration.slice(boundaries[i], boundaries[i + 1]);
    assert(/set search_path = ''/.test(block), `uma function não tem search_path fixo: ${block.slice(0, 80)}...`);
  }
});

// ---------- integridade estrutural: kind/project_id protegidos ----------

check("mudança inválida do TIPO do pai é recusada: um documento que é pai de anexo(s) vinculado(s) não pode deixar de ser CONTRATO_BASE/ADITIVO", () => {
  assert(migration.includes("documents_protect_contractual_link_integrity"));
  assert(migration.includes("before update of kind, project_id on public.documents"));
  assert(migration.includes("where contractual_parent_document_id = old.id"), "deveria checar se o documento sendo alterado tem filhos vinculados");
  assert(
    migration.includes(
      "raise exception\n        'Documento não pode mudar de tipo: é pai de anexo(s) contratual(is) vinculado(s) (contrato-base/aditivo precisam continuar CONTRATO_BASE/ADITIVO enquanto tiverem anexos)';"
    )
  );
});

check("mudança inválida de PROJETO do pai é recusada: um documento que é pai de anexo(s) vinculado(s) não pode mudar de projeto", () => {
  assert(
    migration.includes(
      "raise exception\n        'Documento não pode mudar de projeto: é pai de anexo(s) contratual(is) vinculado(s) neste projeto';"
    )
  );
});

check("mudança inválida de PROJETO do FILHO é recusada: um documento vinculado como anexo não pode mudar de projeto — nunca produziria um vínculo entre projetos diferentes", () => {
  assert(migration.includes("if old.contractual_parent_document_id is not null"));
  assert(
    migration.includes(
      "raise exception\n      'Documento vinculado como anexo contratual não pode mudar de projeto — isso produziria um vínculo entre projetos diferentes';"
    )
  );
});

check("o trigger de integridade NÃO bloqueia alterações legítimas de kind/project_id em documentos SEM nenhum vínculo (nem pai, nem filho) — só entra em ação quando v_has_children é true OU o documento é filho vinculado", () => {
  const fnSource = migration.slice(
    migration.indexOf("create or replace function public.documents_protect_contractual_link_integrity"),
    migration.indexOf("create trigger documents_protect_contractual_link_integrity_trigger")
  );
  assert(fnSource.includes("if v_has_children then"), "a checagem de tipo/projeto do pai deveria estar condicionada a ter filhos");
  assert(fnSource.includes("if old.contractual_parent_document_id is not null"), "a checagem de projeto do filho deveria estar condicionada a ter um pai");
  // Early return quando nada relevante mudou.
  assert(fnSource.includes("if new.kind is not distinct from old.kind\n     and new.project_id is not distinct from old.project_id then\n    return new;"));
});

check("o trigger de integridade NUNCA é gated pela GUC acc.contractual_link_rpc — é uma garantia de consistência de dados que vale sempre, para todo mundo, inclusive as próprias RPCs (que nunca tocam kind/project_id)", () => {
  const fnSource = migration.slice(
    migration.indexOf("create or replace function public.documents_protect_contractual_link_integrity"),
    migration.indexOf("create trigger documents_protect_contractual_link_integrity_trigger")
  );
  assert(!fnSource.includes("acc.contractual_link_rpc"), "este trigger não deveria depender da GUC de coordenação das RPCs");
});

// ---------- linked_by_user_id precisa ser auth.uid() ----------

check("contractual_linked_by_user_id diferente de auth.uid() é recusado pelo trigger — mesmo com a GUC setada, ninguém pode vincular 'em nome de' outro usuário", () => {
  assert(migration.includes("if new.contractual_linked_by_user_id is distinct from auth.uid() then"));
  assert(
    migration.includes(
      "raise exception 'contractual_linked_by_user_id deve ser exatamente o usuário autenticado (auth.uid()) da transação que está escrevendo';"
    )
  );
});

// ---------- nenhuma inferência de aprovação/vigência do aditivo ----------

check("nenhuma inferência de aprovação/vigência de aditivo em nenhum lugar do código: nem coluna de status em documents, nem lógica no mapeador do contexto do Expert, nem afirmação no SQL", () => {
  assert(!/status\s+text|is_approved|is_active|vigente\s+boolean|aprovado\s+boolean/i.test(migration), "a migration não deveria criar nenhuma coluna de status/aprovação/vigência — esse fato não existe no schema e não deve ser inventado aqui");

  const mapContextSource = readSource("apps/web/lib/ai/context/map-contractual-link-context.ts");
  // "vigente" aparece legitimamente em "versão vigente do pai"
  // (parentCurrentVersionLabel — rótulo da versão mais recente, um
  // conceito diferente de "aditivo vigente/aprovado") — a checagem real
  // é: nenhum campo/lógica de APROVAÇÃO ou de STATUS do documento é
  // calculado aqui.
  assert(!/aprovad/i.test(mapContextSource), "o mapeador puro do contexto do Expert nunca deveria calcular/inferir aprovação do aditivo — só repassa fatos (kind, fundamento, quem/quando)");
  assert(!/\bstatus\b/i.test(mapContextSource), "o mapeador não deveria referenciar nenhum campo de status");
  assert(!mapContextSource.includes("isVigente") && !mapContextSource.includes("is_vigente"), "o mapeador não deveria calcular nenhum booleano de vigência");

  const identitySource = readSource("apps/web/lib/ai/experts/legal-consultant/identity.ts").replace(/\s+/g, " ");
  assert(
    identitySource.includes("não existe nenhum campo de status/aprovação de aditivo no contexto fornecido"),
    "o prompt deveria deixar explícito que o código não fornece esse fato — só o Expert pode concluir isso a partir de outras fontes"
  );
});

// ---------- 17/18/19: agrupamento (já cobertos por test-group-contractual-documents.mjs) ----------

check("17/18/19. agrupamento (contrato+anexos / aditivo+anexos / anexos de pais diferentes nunca se misturam) já coberto por scripts/test-group-contractual-documents.mjs — reaproveitado, não duplicado aqui", () => {
  const groupingTestSource = readSource("scripts/test-group-contractual-documents.mjs");
  assert(groupingTestSource.includes("anexos de grupos diferentes NUNCA se misturam"));
  assert(groupingTestSource.includes("groupDocumentsByContractualStructure"));
});

// ---------- comentário técnico corrigido sobre SECURITY DEFINER ----------

check("comentário sobre privilégios de SECURITY DEFINER está tecnicamente correto: as 5 functions procedurais rodam com os privilégios do DONO da function (postgres), nunca de 'quem escreve em documents' — e explica que auth.uid() continua correto mesmo assim", () => {
  assert(
    !migration.includes("que roda com os privilégios de quem escreve em"),
    "o comentário tecnicamente incorreto (SECURITY DEFINER roda como o dono, não como o chamador) não deveria mais existir"
  );
  assert(migration.includes("SOBRE SECURITY DEFINER"), "deveria haver uma nota explicando o modelo de privilégios correto");
  assert(migration.includes("e rodam com os privilégios"), "deveria explicar que as 5 functions SECURITY DEFINER rodam com os privilégios do dono, não do chamador");
  assert(
    migration.includes("auth.uid()` continua"),
    "deveria explicar que auth.uid() continua refletindo o usuário autenticado da requisição independentemente do role de execução"
  );
});

check("CRÍTICO — afirmação corrigida: normalize_contractual_text NÃO é SECURITY DEFINER (é INVOKER, o padrão do Postgres quando a cláusula não é declarada) — a migration não afirma mais 'todas as 6 functions são SECURITY DEFINER'; afirma corretamente que são 5 de 6", () => {
  assert(
    !/todas as 6 functions.*SECURITY DEFINER|as 6.*SECURITY DEFINER.*sempre/i.test(migration),
    "a migration não deveria mais afirmar que todas as 6 functions são SECURITY DEFINER"
  );
  assert(
    migration.includes("das 6 functions desta migration, CINCO são\n-- SECURITY DEFINER"),
    "deveria afirmar explicitamente que são 5 de 6, não as 6"
  );
  assert(
    migration.includes("A SEXTA — normalize_contractual_text (seção 1) — é DELIBERADAMENTE\n-- INVOKER"),
    "deveria identificar normalize_contractual_text como a exceção INVOKER, e que isso é deliberado"
  );
  assert(
    migration.includes("chamador EFETIVO de\n-- normalize_contractual_text(), nesses 3 pontos, sempre é postgres"),
    "deveria explicar POR QUE ser invoker funciona: o chamador efetivo nos 3 usos é sempre postgres (as 3 chamadoras já são SECURITY DEFINER)"
  );
});

check("CRÍTICO — verificação estrutural direta: normalize_contractual_text() NÃO tem a linha 'security definer' no seu CREATE; as outras 5 functions TÊM", () => {
  const normalizeBlock = migration.slice(
    migration.indexOf("create or replace function public.normalize_contractual_text"),
    migration.indexOf("$$;", migration.indexOf("create or replace function public.normalize_contractual_text"))
  );
  assert(!/^security definer$/m.test(normalizeBlock), "normalize_contractual_text não deveria ter 'security definer' — function pura, invoker, deliberado");
  assert(normalizeBlock.includes("language sql") && normalizeBlock.includes("immutable"), "normalize_contractual_text deveria continuar language sql + immutable");

  for (const fnStart of [
    "create or replace function public.documents_contractual_link_would_cycle(",
    "create or replace function public.documents_validate_contractual_link()",
    "create or replace function public.documents_protect_contractual_link_integrity()",
    "create or replace function public.link_document_as_contractual_attachment(",
    "create or replace function public.unlink_document_contractual_attachment(",
  ]) {
    const idx = migration.indexOf(fnStart);
    assert(idx !== -1, `function não encontrada: ${fnStart}`);
    const body = migration.slice(idx, migration.indexOf("$$;", idx));
    assert(/^security definer$/m.test(body), `${fnStart} deveria ter 'security definer'`);
  }
});

check("owner explícito e determinístico nas TODAS as 6 functions (não só as 2 RPCs) — nunca depende implicitamente de 'quem executou a migration'", () => {
  const ownerStatements = migration.match(/^alter function public\.\w+\([^)]*\) owner to postgres;/gm) ?? [];
  assert(ownerStatements.length === 6, `esperado 6 declarações explícitas de owner, encontrado ${ownerStatements.length}`);
  for (const fn of [
    "normalize_contractual_text(text)",
    "documents_contractual_link_would_cycle(uuid, uuid)",
    "documents_validate_contractual_link()",
    "documents_protect_contractual_link_integrity()",
    "link_document_as_contractual_attachment(uuid, uuid, uuid, text, uuid, boolean)",
    "unlink_document_contractual_attachment(uuid, uuid, text)",
  ]) {
    assert(
      migration.includes(`alter function public.${fn} owner to postgres;`),
      `${fn} deveria ter owner explícito`
    );
  }
});

check("a alegação de que 'postgres' é a role correta é rastreável a uma verificação real já registrada no histórico do repositório (register_project_document_upload, migration 20260825130000) — nunca presumida do zero nesta migration", () => {
  const dewrapped = migration.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
  assert(dewrapped.includes("register_project_document_upload, migration 20260825130000"));
  const referencedMigrationSource = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(
    referencedMigrationSource.includes("confirmado por consulta read-only a pg_proc"),
    "a migration referenciada deveria mesmo conter essa verificação — nunca uma citação inventada"
  );
});

check("auth.uid() do PRÓPRIO projeto foi verificado (não presumido) antes de desenhar a simulação de sessão autenticada do runner de concorrência — lê request.jwt.claim.sub", () => {
  const runnerSource = readSource("scripts/sql/run-contractual-link-concurrency-test.mjs");
  const fixturesSource = readSource("scripts/sql/contractual-link-concurrency-fixtures.sql");
  assert(runnerSource.includes("request.jwt.claim.sub"));
  // A pré-condição do usuário de teste (mesmo padrão de supabase/seed.sql)
  // já é, em si, a evidência de que este projeto segue o padrão
  // Supabase-padrão de auth.uid() — não inventamos uma técnica nova.
  assert(fixturesSource.includes("handle_new_user") || fixturesSource.includes("auth-login-test@axion-test.local"));
});

// ---------- vínculo no nível de documents, nunca de document_versions ----------

check("vínculo é no nível de documents, nunca de document_versions", () => {
  assert(!/alter table public\.document_versions\s+add column contractual/.test(migration), "as colunas contractual_* deveriam estar em documents, nunca em document_versions");
  assert(migration.includes("alter table public.documents\n  add column contractual_parent_document_id"));
});

// ---------- ON DELETE RESTRICT e índice ----------

check("contractual_parent_document_id: ON DELETE RESTRICT + índice para o documento pai", () => {
  assert(/contractual_parent_document_id uuid\s*\n\s*references public\.documents \(id\) on delete restrict/.test(migration));
  assert(migration.includes("create index documents_contractual_parent_document_id_idx"));
});

check("delete_project_document (RPC pré-existente): já traduz qualquer foreign_key_violation numa mensagem amigável — cobre automaticamente a nova RESTRICT sem precisar de nenhuma alteração nessa RPC", () => {
  const deleteRpcSource = readSource("supabase/migrations/20260825030844_reload_document_delete_rpc_cache.sql");
  assert(deleteRpcSource.includes("when foreign_key_violation then"));
  assert(deleteRpcSource.includes("'Documento não pode ser excluído porque ainda possui vínculos protegidos.'"));
});

// ---------- 21: nenhuma inferência pelo nome ----------

check("21. nenhuma inferência de vínculo pelo nome/título — nem no SQL (só id/kind/project_id), nem nos mapeadores puros da aplicação, nem na Server Action", () => {
  // A única referência a "title" no SQL é para popular a auditoria
  // (legível para humanos) ou o rótulo do dropdown — nunca para decidir
  // um vínculo.
  assert(!/where\s+.*title\s*=/i.test(migration), "nenhuma cláusula WHERE desta migration deveria comparar por título");

  const actionsSource = readSource("apps/web/app/[projectId]/documentos/actions.ts");
  assert(
    !/childDocumentId\s*=.*title|parentDocumentId\s*=.*title/i.test(actionsSource),
    "a Server Action nunca deveria resolver ids a partir de título"
  );

  const linkFieldsSource = readSource("apps/web/lib/documents/map-contractual-link-fields.ts");
  assert(!/\btitle\b/i.test(linkFieldsSource), "o mapeador puro de campos de vínculo não deveria referenciar título");
});

// ---------- 20: Expert recebe o vínculo estruturado ----------

const { mapContractualLinkContext } = await import("../apps/web/lib/ai/context/map-contractual-link-context.ts");

check("20. Expert recebe o vínculo ESTRUTURADO (FATOS): documento filho (implícito, é o ContextClause.documentId), documento pai, tipo do pai, fundamento, quem/quando vinculou, versão vigente do pai — NUNCA uma conclusão de precedência pré-computada", () => {
  const parentById = new Map([["parent-1", { id: "parent-1", kind: "ADITIVO", title: "Aditivo 01" }]]);
  const versionLabelById = new Map([["parent-1", "2.0"]]);

  const link = mapContractualLinkContext(
    {
      contractual_parent_document_id: "parent-1",
      contractual_incorporation_basis: "Cláusula 4.2 incorpora esta proposta.",
      contractual_linked_by_user_id: "user-1",
      contractual_linked_at: "2026-08-29T10:00:00Z",
    },
    parentById,
    versionLabelById
  );

  assert(link !== null);
  assert(link.parentDocumentId === "parent-1", "documento pai ausente");
  assert(link.parentDocumentKind === "ADITIVO", "tipo do pai ausente");
  assert(link.parentDocumentTitle === "Aditivo 01");
  assert(link.parentCurrentVersionLabel === "2.0", "versão vigente do pai ausente");
  assert(link.incorporationBasis === "Cláusula 4.2 incorpora esta proposta.", "fundamento ausente");
  assert(link.linkedByUserId === "user-1", "usuário do vínculo ausente");
  assert(link.linkedAt === "2026-08-29T10:00:00Z", "data do vínculo ausente");
  // NUNCA uma conclusão de precedência pré-computada: sem status/
  // aprovação de aditivo no schema, o código não tem como saber se um
  // ADITIVO está vigente — só o Expert, olhando o resto do contexto,
  // pode concluir isso (ver identity.ts, seção "contractualLink").
  assert(!("precedenceLevel" in link), "o mapeador não deveria calcular nenhuma conclusão de precedência — só fatos");
});

check("20b. sem vínculo (contractual_parent_document_id null): mapContractualLinkContext retorna null — nunca fabrica um vínculo", () => {
  const link = mapContractualLinkContext(
    {
      contractual_parent_document_id: null,
      contractual_incorporation_basis: null,
      contractual_linked_by_user_id: null,
      contractual_linked_at: null,
    },
    new Map(),
    new Map()
  );
  assert(link === null);
});

check("20c. ContextClause (apps/web/lib/ai/context/types.ts) tem o campo contractualLink, SEM nenhum campo de precedência pré-calculada — o pipeline real do Expert (EventAnalysisContext -> JSON.stringify no provider) recebe isso automaticamente, não precisa de nenhuma mudança no provider", () => {
  const typesSource = readSource("apps/web/lib/ai/context/types.ts");
  assert(typesSource.includes("contractualLink: ContextContractualLink | null;"), "ContextClause deveria ter contractualLink");
  assert(
    !/precedenceLevel\s*[:?]/.test(typesSource),
    "ContextContractualLink não deveria mais DECLARAR nenhum campo de precedência pré-calculada — só fatos (menção em comentário explicando a remoção é esperada)"
  );
  assert(typesSource.includes('parentDocumentKind: "CONTRATO_BASE" | "ADITIVO";'), "parentDocumentKind deveria ser tipado como fato (união dos dois valores reais aceitos como pai), não string genérica");

  const providerSource = readSource("apps/web/lib/ai/providers/anthropic-provider.ts");
  assert(providerSource.includes("JSON.stringify(payload"), "o provider deveria serializar o contexto inteiro genericamente — nenhum campo específico precisa ser adicionado ali para o novo campo chegar ao modelo");
});

check("20e. legal-consultant/identity.ts explica como usar os FATOS de contractualLink — anexo de ADITIVO exige confirmar aprovação/vigência por outras fontes, nunca presumida só pela existência do vínculo", () => {
  // readSource lê o TEXTO BRUTO do arquivo .ts (nunca importado/avaliado
  // aqui) — os backticks do template literal aparecem escapados
  // (\`contractualLink\`) no código-fonte, não como backtick puro.
  const identitySource = readSource("apps/web/lib/ai/experts/legal-consultant/identity.ts");
  assert(identitySource.includes("contractualLink"), "deveria haver uma seção explicando contractualLink");
  const normalized = identitySource.replace(/\s+/g, " ");
  assert(
    normalized.includes("A EXISTÊNCIA do vínculo, sozinha, NUNCA prova que o aditivo está aprovado/vigente"),
    "deveria deixar explícito que o vínculo sozinho não prova aprovação/vigência do aditivo"
  );
});

check("CRÍTICO — 20d. build-event-context.ts (pipeline REAL) agora chama mapContractualLinkContext de verdade — não fica mais hardcoded contractualLink: null; resolve pai + versão vigente do pai", () => {
  const builderSource = readSource("apps/web/lib/ai/context/build-event-context.ts");
  assert(!builderSource.includes("contractualLink: null,"), "não deveria mais hardcodar null — o mapeador real está conectado nesta rodada");
  assert(builderSource.includes("mapContractualLinkContext(contractualLink, parentById, parentCurrentVersionLabelById)"), "deveria chamar o mapeador real com os 3 argumentos esperados");
  assert(builderSource.includes('import { mapContractualLinkContext } from "./map-contractual-link-context";'), "deveria importar o mapeador real, não reimplementar a lógica");
});

check("CRÍTICO — build-event-context.ts nunca quebra contra um banco SEM a migration aplicada: select estendido com fallback automático em 42703 (undefined_column), refeito sem as colunas contractual_*", () => {
  const builderSource = readSource("apps/web/lib/ai/context/build-event-context.ts");
  assert(builderSource.includes('extended.error.code === "42703"'), "deveria detectar especificamente 42703 (undefined_column), não qualquer erro");
  assert(builderSource.includes("EXTENDED_DOCUMENT_COLUMNS"), "deveria haver uma consulta estendida dedicada com fallback");
  assert(
    builderSource.includes('await supabase.from("documents").select("id,kind,title").in("id", documentIds)'),
    "o fallback deveria refazer a MESMA consulta original (id,kind,title), nunca lançar um erro fatal só porque a migration ainda não foi aplicada"
  );
});

check("CRÍTICO — document-management.ts (getManagedDocuments, pipeline REAL da aba Documentos) agora chama mapContractualLinkFields de verdade — não fica mais hardcoded null nos 5 campos de vínculo", () => {
  const managementSource = readSource("apps/web/lib/document-management.ts");
  assert(!managementSource.includes("parentDocumentId: null,\n    contractualIncorporationBasis: null,"), "não deveria mais hardcodar os 5 campos como null — o mapeador real está conectado nesta rodada");
  assert(managementSource.includes("...mapContractualLinkFields("), "deveria espalhar o resultado do mapeador real na linha de cada documento");
  assert(managementSource.includes('import { mapContractualLinkFields } from "@/lib/documents/map-contractual-link-fields";'));
});

check("document-management.ts: getManagedDocuments filtra deleted_at is null (lixeira) via o helper CANÔNICO withActiveDocumentFilter — nunca uma reimplementação inline divergente (refatorado nesta rodada; a lógica de fallback 42703 agora vive só em active-document-filter.ts)", () => {
  const managementSource = readSource("apps/web/lib/document-management.ts");
  assert(
    managementSource.includes('import { withActiveDocumentFilter } from "@/lib/documents/active-document-filter"'),
    "deveria importar o helper canônico, nunca reimplementar o fallback 42703 localmente"
  );
  assert(managementSource.includes('.is("deleted_at", null)'), "a lista principal deveria excluir documentos na lixeira");
  assert(
    /withActiveDocumentFilter\(\(filterActive\)\s*=>\s*\{/.test(managementSource),
    "a query principal deveria estar envolvida pelo helper canônico"
  );
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
