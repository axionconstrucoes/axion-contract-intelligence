// Runner DETERMINÍSTICO da prova de concorrência E de conflito
// otimista do vínculo contratual
// (migration 20260829090000_document_contractual_attachment_linkage.sql).
//
// Roda contra o banco descartável do "PLANO DE VALIDAÇÃO EM POSTGRES
// REAL" do relatório (stack Supabase completa e temporária), nunca
// contra o Supabase local existente do projeto nem contra remoto.
//
// SEGURANÇA DE AMBIENTE (fail-closed em 4 camadas independentes):
//   1. ACC_CONCURRENCY_TEST_DATABASE_URL precisa apontar para
//      localhost/127.0.0.1/::1 — QUALQUER outro host é recusado, MESMO
//      com a confirmação abaixo setada.
//   2. A porta precisa ser EXATAMENTE a porta verificada e escolhida
//      nesta execução (EXACT_DISPOSABLE_PORT) — nunca uma faixa
//      genérica, nunca uma porta da stack local real do projeto
//      (54320-54329, ver supabase/config.toml) nem a porta padrão do
//      Postgres (5432).
//   3. ACC_CONCURRENCY_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser
//      exatamente a string "true" — "false"/"0"/"no"/qualquer coisa
//      não-vazia-mas-diferente de "true" é recusado (comparação
//      estrita, nunca um `if (valor)` que aceitaria qualquer string
//      não vazia).
//   4. ACC_CONCURRENCY_TEST_DB_CONTAINER precisa ser exatamente o nome
//      do container Postgres da stack descartável desta execução —
//      nunca um prefixo/padrão. `psql` não está disponível no PATH
//      deste host (verificado nesta rodada); o transporte real é
//      `docker exec -i <container> psql`, então o NOME do container é
//      quem efetivamente decide com qual banco o runner fala — mais
//      uma camada, não uma substituição da validação de porta acima.
//
// Abre sessões psql persistentes (cada exec() envia UM comando SQL por
// vez — nunca vários statements num só envio, para nunca perder a
// atribuição de SQLSTATE de um erro no meio de um lote) e uma conexão
// de MONITOR que confirma bloqueio de verdade via pg_stat_activity +
// pg_blocking_pids (nunca por timing/sleep, nunca só wait_event_type
// sozinho — isso não prova QUEM está bloqueando).
//
// Requer `docker` no PATH (o `psql` usado é o de DENTRO do container).
//
// Uso (só depois de ter um banco descartável real, nunca antes) — a
// porta E o container abaixo precisam bater EXATAMENTE com
// EXACT_DISPOSABLE_PORT / EXACT_DISPOSABLE_DB_CONTAINER:
//   ACC_CONCURRENCY_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55511/postgres" \
//   ACC_CONCURRENCY_TEST_DB_CONTAINER="supabase_db_acc-disposable-20260829" \
//   ACC_CONCURRENCY_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-contractual-link-concurrency-test.mjs

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

// ---------- validação estrita de ambiente (item 2) ----------

// PORTA EXATA da stack descartável desta execução — verificada REAL
// (Get-NetTCPConnection, containers Docker, netsh excludedportrange)
// imediatamente antes de subir a stack com `supabase start`
// (project_id "acc-disposable-20260829", ver relatório desta rodada).
// NUNCA uma faixa genérica: um intervalo largo (ex.: 55000-55999)
// aceitaria por engano uma porta de OUTRA stack descartável esquecida
// rodando, ou uma porta historicamente usada por outra configuração
// local deste mesmo host (ver aviso do usuário sobre 55021/55023/
// 55024, que por sinal caem dentro da faixa de exclusão administrada
// do Windows 54947-55046 — mais um motivo para nunca confiar numa
// faixa ampla sem verificação real a cada execução).
const EXACT_DISPOSABLE_PORT = 55511;
// Faixa real da stack Supabase local deste projeto — ver
// supabase/config.toml (portas 54320-54329) — recusada explicitamente,
// mesmo que caia fora da porta exata escolhida por acidente de digitação.
const LOCAL_STACK_PORT_RANGE = [54300, 54399];
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parseAndValidateDatabaseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`ACC_CONCURRENCY_TEST_DATABASE_URL não é uma URL válida: ${rawUrl}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Error(
      `ACC_CONCURRENCY_TEST_DATABASE_URL aponta para o host "${hostname}" — só localhost/127.0.0.1/::1 são aceitos. ` +
        "NUNCA um host remoto, mesmo com a confirmação de ambiente descartável setada."
    );
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port)) {
    throw new Error("ACC_CONCURRENCY_TEST_DATABASE_URL precisa especificar uma porta explícita.");
  }
  if (port >= LOCAL_STACK_PORT_RANGE[0] && port <= LOCAL_STACK_PORT_RANGE[1]) {
    throw new Error(
      `Porta ${port} pertence à faixa da stack Supabase LOCAL EXISTENTE deste projeto (${LOCAL_STACK_PORT_RANGE[0]}-${LOCAL_STACK_PORT_RANGE[1]}, ver supabase/config.toml) — recusado. ` +
        `Use a porta exata verificada para o banco descartável desta execução (${EXACT_DISPOSABLE_PORT}).`
    );
  }
  if (port !== EXACT_DISPOSABLE_PORT) {
    throw new Error(
      `Porta ${port} não é a porta EXATA verificada e escolhida para a stack descartável desta execução (${EXACT_DISPOSABLE_PORT}). ` +
        "Nunca uma faixa genérica — se a stack descartável estiver noutra porta, atualize EXACT_DISPOSABLE_PORT aqui só depois de reverificar portas livres de verdade (Get-NetTCPConnection + docker ps + netsh excludedportrange)."
    );
  }

  return parsed;
}

const DATABASE_URL_RAW = process.env.ACC_CONCURRENCY_TEST_DATABASE_URL;
if (!DATABASE_URL_RAW) {
  console.error(
    "ACC_CONCURRENCY_TEST_DATABASE_URL não está setada — recusando executar (fail-closed). " +
      "Aponte para um banco DESCARTÁVEL (ver 'PLANO DE VALIDAÇÃO EM POSTGRES REAL' no relatório)."
  );
  process.exit(1);
}

let DATABASE_URL;
try {
  parseAndValidateDatabaseUrl(DATABASE_URL_RAW);
  DATABASE_URL = DATABASE_URL_RAW;
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Comparação ESTRITA — "false", "0", "no", "" ou qualquer outra coisa
// diferente da string exata "true" é recusado. Nunca um `if (valor)`
// truthy-check, que aceitaria qualquer string não vazia (inclusive a
// literal "false").
if (process.env.ACC_CONCURRENCY_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error(
    'Confirmação explícita ausente ou incorreta. Exporte ACC_CONCURRENCY_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE="true" ' +
      "(comparação estrita — nenhum outro valor é aceito) para confirmar que a URL aponta para um banco descartável."
  );
  process.exit(1);
}

// TRANSPORTE REAL: `psql` não está disponível no PATH deste host
// (verificado nesta rodada — nenhum binário psql.exe encontrado) — em
// vez de abrir mão da prova real, o runner conecta via
// `docker exec -i <container> psql` diretamente no container Postgres
// da stack descartável (o mesmo `psql`, dentro do container onde ele
// sempre existe — imagem oficial do Postgres). ACC_CONCURRENCY_TEST_DATABASE_URL
// continua validada acima (host/porta) por documentação/defesa em
// profundidade, mas quem decide COM QUAL container o runner realmente
// fala é o nome exato abaixo — verificado nesta execução via `docker
// ps` (nunca um prefixo/padrão, nunca "qualquer container supabase_db_*").
const EXACT_DISPOSABLE_DB_CONTAINER = "supabase_db_acc-disposable-20260829";
const containerNameRaw = process.env.ACC_CONCURRENCY_TEST_DB_CONTAINER;
if (containerNameRaw !== EXACT_DISPOSABLE_DB_CONTAINER) {
  console.error(
    `ACC_CONCURRENCY_TEST_DB_CONTAINER precisa ser exatamente "${EXACT_DISPOSABLE_DB_CONTAINER}" (obtido: ${JSON.stringify(containerNameRaw)}) — ` +
      "nunca um prefixo/padrão, nunca o container da stack local real (supabase_db_axion-contract-intelligence)."
  );
  process.exit(1);
}

function readSqlFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

// ---------- sessão psql persistente, um statement por exec() ----------

const SESSION_SAFETY_STATEMENTS = ["set lock_timeout = '30s';", "set statement_timeout = '60s';"];

function createPsqlSession(label) {
  const proc = spawn(
    "docker",
    ["exec", "-i", EXACT_DISPOSABLE_DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=0"],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let stdoutBuffer = "";
  let stderrBuffer = "";
  proc.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
  });
  proc.stderr.on("data", (chunk) => {
    // O texto REAL da mensagem de erro do Postgres (ex.: "pai de
    // anexo(s) contratual(is) vinculado(s)") sai no stderr do psql, não
    // no stdout — só o \echo ACC_KV (sqlstate/error/echoVars) vai para
    // o stdout. A DECISÃO de sucesso/erro nunca depende disto (sempre o
    // par determinístico sqlstate/error) — mas messagePattern (quando o
    // caller pede) precisa do texto real, então acumulado aqui e
    // devolvido junto no resultado (bug real encontrado rodando de
    // verdade nesta rodada: sem isto, todo messagePattern falhava
    // silenciosamente contra uma string vazia).
    stderrBuffer += chunk.toString("utf8");
  });

  let exited = false;
  let exitResolvers = [];
  proc.on("exit", () => {
    exited = true;
    for (const resolve of exitResolvers) resolve();
    exitResolvers = [];
  });
  proc.on("error", (err) => {
    throw new Error(`[${label}] não foi possível iniciar "docker exec ... psql" — docker está no PATH e o container ${EXACT_DISPOSABLE_DB_CONTAINER} está rodando? (${err.message})`);
  });

  let backendPid = null;
  // Declarado ANTES do IIFE de `ready` abaixo (que chama execRaw()
  // imediatamente, de forma síncrona até o primeiro await) — senão
  // execRaw() acessaria esta variável ainda em temporal dead zone
  // (ReferenceError real, capturado ao rodar de verdade contra a stack
  // descartável nesta rodada, nunca visto em node --check/leitura
  // estrutural).
  let sqlBeingRun = "";
  let ready = (async () => {
    for (const sql of SESSION_SAFETY_STATEMENTS) {
      await execRaw(sql, {});
    }
  })();

  function waitForMarker(marker, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (stdoutBuffer.includes(marker)) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`[${label}] timeout (${timeoutMs}ms) esperando conclusão de: ${JSON.stringify(sqlBeingRun)}`));
        }
      }, 100);
    });
  }

  // execRaw: envia EXATAMENTE um comando SQL, seguido de KV
  // determinísticos (sqlstate/error via as variáveis especiais do
  // psql, + qualquer echoVar pedido, capturados via \gset no próprio
  // SQL do caller) e um marcador de conclusão. NUNCA envia dois
  // statements num só write — cada exec() é atômico para fins de
  // atribuição de SQLSTATE.
  async function execRaw(sql, { timeoutMs = 15000, echoVars = [], waitForCompletion = true } = {}) {
    sqlBeingRun = sql;
    const marker = `__ACC_DONE_${label}_${Math.random().toString(36).slice(2)}__`;
    stdoutBuffer = "";
    stderrBuffer = "";
    proc.stdin.write(`${sql}\n`);
    for (const varName of echoVars) {
      proc.stdin.write(`\\echo ACC_KV ${varName}=:${varName}\n`);
    }
    proc.stdin.write(`\\echo ACC_KV sqlstate=:SQLSTATE\n`);
    proc.stdin.write(`\\echo ACC_KV error=:ERROR\n`);
    proc.stdin.write(`\\echo ${marker}\n`);

    const donePromise = waitForMarker(marker, timeoutMs).then(() => parseResult(stdoutBuffer, stderrBuffer));

    if (!waitForCompletion) {
      // Dispara e NÃO espera — usado deliberadamente para a operação
      // que se espera ficar bloqueada (senão o próprio await travaria
      // o runner). O caller confirma o bloqueio via
      // pollUntilBlockedBy() e só depois decide quando de fato esperar
      // esta promise.
      return donePromise;
    }
    return donePromise;
  }

  function parseResult(rawStdout, rawStderr) {
    const kv = {};
    const kvPattern = /^ACC_KV (\w+)=(.*)$/gm;
    let match;
    while ((match = kvPattern.exec(rawStdout)) !== null) {
      kv[match[1]] = match[2].trim();
    }
    return {
      // stdout+stderr combinados — o texto REAL da mensagem de erro do
      // Postgres (para messagePattern) sai no stderr do psql, nunca no
      // stdout (que só tem as linhas ACC_KV). Mantido no campo
      // "stdout" por compatibilidade com quem já lê result.stdout.
      stdout: rawStdout + rawStderr,
      stderr: rawStderr,
      sqlstate: kv.sqlstate ?? null,
      isError: kv.error === "t" || kv.error === "true",
      kv,
    };
  }

  // exec(): API pública. Por padrão, QUALQUER erro SQL não explicitamente
  // esperado FALHA o runner imediatamente (item 6) — nunca passa
  // despercebido. Para aceitar um erro esperado, o caller passa
  // `expect: { sqlstate?, messagePattern? }`; se o erro real não bater
  // com o esperado, TAMBÉM falha (nunca aceita "qualquer erro" como
  // sinônimo do esperado).
  async function exec(sql, { timeoutMs = 15000, echoVars = [], waitForCompletion = true, expect = null } = {}) {
    await ready;
    const resultPromise = execRaw(sql, { timeoutMs, echoVars, waitForCompletion });
    if (!waitForCompletion) {
      // O caller é responsável por validar expect() depois de esperar
      // esta promise explicitamente (usado só no caminho "dispara e
      // deixa bloqueado" dos cenários de concorrência).
      return resultPromise;
    }
    const result = await resultPromise;
    validateExpectation(sql, result, expect);
    return result;
  }

  function validateExpectation(sql, result, expect) {
    if (!result.isError) {
      if (expect && expect.mustError) {
        throw new Error(`[${label}] esperava erro (${JSON.stringify(expect)}) mas "${sql.slice(0, 80)}" teve sucesso (sqlstate=${result.sqlstate}).`);
      }
      return;
    }
    // result.isError === true
    if (!expect || !expect.mustError) {
      throw new Error(
        `[${label}] erro SQL NÃO ESPERADO em "${sql.slice(0, 80)}" (sqlstate=${result.sqlstate}). Saída: ${result.stdout.slice(0, 500)}`
      );
    }
    if (expect.sqlstate && result.sqlstate !== expect.sqlstate) {
      throw new Error(
        `[${label}] erro com SQLSTATE inesperado em "${sql.slice(0, 80)}": esperado ${expect.sqlstate}, obtido ${result.sqlstate}.`
      );
    }
    if (expect.messagePattern && !expect.messagePattern.test(result.stdout)) {
      throw new Error(
        `[${label}] erro não bate com o padrão de mensagem esperado (${expect.messagePattern}) em "${sql.slice(0, 80)}". Saída: ${result.stdout.slice(0, 500)}`
      );
    }
  }

  async function resolveBackendPid() {
    const result = await exec("select pg_backend_pid() as acc_pid \\gset", { echoVars: ["acc_pid"] });
    const pid = Number(result.kv.acc_pid);
    if (!Number.isInteger(pid)) throw new Error(`[${label}] não foi possível resolver pg_backend_pid()`);
    backendPid = pid;
    return backendPid;
  }

  // close(): termina o processo e devolve uma Promise que só resolve
  // quando o processo REALMENTE saiu — nunca um fire-and-forget. Isso
  // é o que garante rollback de qualquer transação aberta (o Postgres
  // sempre desfaz uma transação cuja conexão cai) ANTES do caller
  // seguir para o cleanup (item 4).
  function close({ timeoutMs = 10000 } = {}) {
    if (exited) return Promise.resolve();
    const exitPromise = new Promise((resolve) => {
      exitResolvers.push(resolve);
      setTimeout(resolve, timeoutMs); // nunca trava para sempre — resolve de qualquer forma após o timeout
    });
    try {
      proc.stdin.write("\\q\n");
    } catch {
      // stdin já pode estar fechado
    }
    try {
      proc.stdin.end();
    } catch {
      // idem
    }
    // Fallback: se \q não bastar (sessão travada num comando
    // bloqueado), SIGTERM força o encerramento da conexão de qualquer
    // forma — o Postgres trata isso como desconexão abrupta e desfaz a
    // transação aberta.
    setTimeout(() => {
      if (!exited) proc.kill("SIGTERM");
    }, 2000);
    return exitPromise;
  }

  return {
    exec,
    resolveBackendPid,
    close,
    get backendPid() {
      return backendPid;
    },
  };
}

// ---------- monitor: confirma QUEM bloqueia quem, de verdade (item 3) ----------

async function pollUntilBlockedBy(monitorSession, targetPid, blockerPid, { timeoutMs = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await monitorSession.exec(
      `select (
         (select wait_event_type from pg_stat_activity where pid = ${targetPid}) = 'Lock'
         and ${blockerPid} = any(pg_blocking_pids(${targetPid}))
       ) as acc_blocked_by_expected \\gset`,
      { echoVars: ["acc_blocked_by_expected"] }
    );
    if (result.kv.acc_blocked_by_expected === "t" || result.kv.acc_blocked_by_expected === "true") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

// ---------- setup/teardown determinísticos (itens 4 e 5) ----------

const TEST_USER_EMAIL = "auth-login-test@axion-test.local";

async function resolveTestUserId(session) {
  const result = await session.exec(
    // max(uuid) NÃO EXISTE no Postgres (só tipos com aggregate max/min
    // registrado, uuid não é um deles — descoberto rodando de verdade
    // contra a stack descartável nesta rodada, SQLSTATE 42883
    // undefined_function). max(id::text) funciona e é suficiente aqui
    // (só precisamos de "um valor", nunca literalmente o maior).
    `select count(*) as acc_count, max(id::text) as acc_id from public.profiles where email = '${TEST_USER_EMAIL}' \\gset`,
    { echoVars: ["acc_count", "acc_id"] }
  );
  if (result.kv.acc_count !== "1") {
    throw new Error(
      `FIXTURE_PRECONDITION_MISSING: esperado exatamente 1 profile com email ${TEST_USER_EMAIL}, encontrado ${result.kv.acc_count}. ` +
        "Crie o usuário Auth de teste antes (mesma pré-condição de supabase/seed.sql) — nunca insira direto em auth.users."
    );
  }
  return result.kv.acc_id;
}

async function runCleanup(session) {
  // O próprio arquivo já ecoa `ACC_KV remaining_fixture_count=...` no
  // final (\gset + \echo) — não precisamos pedir echoVars extras, só
  // ler a KV que ele já produz.
  const sql = readSqlFile("scripts/sql/contractual-link-concurrency-cleanup.sql");
  const result = await session.exec(sql);
  const remaining = Number(result.kv.remaining_fixture_count);
  if (!Number.isInteger(remaining) || remaining !== 0) {
    throw new Error(`CLEANUP_INCOMPLETE: ${result.kv.remaining_fixture_count} linha(s) de fixture ainda presentes depois da limpeza — nunca deveria acontecer.`);
  }
}

async function runFixtures(session, _testUserId) {
  // O runner já verificou a pré-condição do usuário de teste
  // separadamente (resolveTestUserId) — o arquivo mantém seu próprio
  // guard (DO block + RAISE EXCEPTION) para uso manual via `psql -f`,
  // mas o runner não depende dele: valida o resultado por contagem
  // real (verifyFixturesCreated), não por parsing do caminho de erro.
  const sql = readSqlFile("scripts/sql/contractual-link-concurrency-fixtures.sql");
  await session.exec(sql, { timeoutMs: 10000 });
  await verifyFixturesCreated(session);
}

async function verifyFixturesCreated(session) {
  const result = await session.exec(
    `select
       (select count(*) from public.projects where id in ('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999902')) as acc_projects,
       (select count(*) from public.project_memberships where project_id in ('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999902')) as acc_memberships,
       (select count(*) from public.documents where id in ('99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999912','99999999-9999-4999-8999-999999999913')) as acc_documents \\gset`,
    { echoVars: ["acc_projects", "acc_memberships", "acc_documents"] }
  );
  if (result.kv.acc_projects !== "2" || result.kv.acc_memberships !== "2" || result.kv.acc_documents !== "3") {
    throw new Error(
      `FIXTURES_INCOMPLETE: esperado 2 projects/2 memberships/3 documents, obtido ${result.kv.acc_projects}/${result.kv.acc_memberships}/${result.kv.acc_documents}.`
    );
  }
}

async function runConsistencyCheck(session) {
  // O próprio arquivo já ecoa `ACC_KV invalid_link_count=...`.
  const sql = readSqlFile("scripts/sql/contractual-link-consistency-check.sql");
  const result = await session.exec(sql);
  const invalidCount = Number(result.kv.invalid_link_count);
  if (!Number.isInteger(invalidCount) || invalidCount !== 0) {
    throw new Error(`ESTADO FINAL INCONSISTENTE: ${result.kv.invalid_link_count} vínculo(s) para pai de kind/project_id inválido.`);
  }
}

// ---------- fixtures fixas ----------

const FIXED_IDS = {
  projectA: "99999999-9999-4999-8999-999999999901",
  projectB: "99999999-9999-4999-8999-999999999902",
  contractA: "99999999-9999-4999-8999-999999999911", // CONTRATO_BASE, pai válido A
  child: "99999999-9999-4999-8999-999999999912",
  aditivoB: "99999999-9999-4999-8999-999999999913", // ADITIVO, pai válido B
};

function beginAuthenticatedTransaction(session, testUserId) {
  return (async () => {
    await session.exec("begin;");
    await session.exec("set local role authenticated;");
    await session.exec(`set local request.jwt.claim.sub = '${testUserId}';`);
  })();
}

function linkRpcSql({ projectId = FIXED_IDS.projectA, childId = FIXED_IDS.child, parentId, basis, expectedParentId, confirm }) {
  const basisLiteral = basis ?? "Fundamento de teste de concorrência, com bem mais de vinte caracteres úteis para passar na validação.";
  const expectedLiteral = expectedParentId === null ? "null" : `'${expectedParentId}'`;
  const confirmLiteral = confirm === null ? "null" : String(confirm);
  return `select link_document_as_contractual_attachment(
  p_project_id := '${projectId}',
  p_child_document_id := '${childId}',
  p_parent_document_id := '${parentId}',
  p_incorporation_basis := '${basisLiteral.replace(/'/g, "''")}',
  p_expected_parent_document_id := ${expectedLiteral},
  p_confirm_parent_change := ${confirmLiteral}
);`;
}

async function currentParentOf(session, documentId) {
  const result = await session.exec(
    `select contractual_parent_document_id as acc_parent from public.documents where id = '${documentId}' \\gset`,
    { echoVars: ["acc_parent"] }
  );
  return result.kv.acc_parent === "" ? null : result.kv.acc_parent;
}

// ============================================================
// CENÁRIOS DE CONCORRÊNCIA (lock do documento-pai)
// ============================================================
//
// ORDENAMENTO 1 (vínculo começa antes da mudança do pai): a sessão
// "mudanca" tenta alterar kind/project_id do pai ENQUANTO a sessão
// "vinculo" ainda segura o FOR SHARE (transação aberta, sem commit) —
// "mudanca" fica bloqueada; ao "vinculo" COMMITAR, "mudanca" prossegue
// e deveria ser RECUSADA pelo trigger de integridade.
//
// ORDENAMENTO 2 (mudança do pai começa antes do vínculo): a sessão
// "mudanca" já mudou kind/project_id (segura o lock de UPDATE) —
// "vinculo" tenta o FOR SHARE e fica bloqueado; ao "mudanca" terminar
// (COMMIT ou ROLLBACK), "vinculo" prossegue.

const concurrencyScenarios = [
  {
    name: "ORDENAMENTO 1 — vínculo primeiro; mudança de KIND do pai é recusada após o commit",
    ordering: 1,
    changeKind: "kind",
    expectChangeError: { mustError: true, messagePattern: /pai de anexo\(s\) contratual\(is\) vinculado\(s\)/ },
  },
  {
    name: "ORDENAMENTO 1 — vínculo primeiro; mudança de PROJECT_ID do pai é recusada após o commit",
    ordering: 1,
    changeKind: "project_id",
    expectChangeError: { mustError: true, messagePattern: /pai de anexo\(s\) contratual\(is\) vinculado\(s\)/ },
  },
  {
    name: "ORDENAMENTO 2 — mudança de KIND do pai faz COMMIT; vínculo concorrente é recusado (pai inválido)",
    ordering: 2,
    changeKind: "kind",
    changeCommits: true,
    expectLinkOutcome: { mustError: true, messagePattern: /Documento pai inválido para este projeto/ },
  },
  {
    name: "ORDENAMENTO 2 — mudança de KIND do pai faz ROLLBACK; vínculo concorrente PROSSEGUE normalmente",
    ordering: 2,
    changeKind: "kind",
    changeCommits: false,
    expectLinkOutcome: { mustError: false },
  },
  {
    name: "ORDENAMENTO 2 — mudança de PROJECT_ID do pai faz COMMIT; vínculo concorrente é recusado (pai inválido, projeto errado)",
    ordering: 2,
    changeKind: "project_id",
    changeCommits: true,
    expectLinkOutcome: { mustError: true, messagePattern: /Documento pai inválido para este projeto/ },
  },
  {
    name: "ORDENAMENTO 2 — mudança de PROJECT_ID do pai faz ROLLBACK; vínculo concorrente PROSSEGUE normalmente",
    ordering: 2,
    changeKind: "project_id",
    changeCommits: false,
    expectLinkOutcome: { mustError: false },
  },
];

function changeSql(changeKind) {
  if (changeKind === "kind") {
    // 'EDITAL' é um valor REAL de documents_kind_check (migration
    // 20260825130000) — verificado, nunca presumido.
    return `update public.documents set kind = 'EDITAL' where id = '${FIXED_IDS.contractA}';`;
  }
  return `update public.documents set project_id = '${FIXED_IDS.projectB}' where id = '${FIXED_IDS.contractA}';`;
}

// close() de forma ordenada: SEMPRE fecha as sessões de TRABALHO
// primeiro (garantindo rollback de qualquer transação aberta pela
// própria desconexão) e só then abre/reaproveita uma sessão
// administrativa livre para cleanup — nunca cleanup antes disso (item 4).
async function closeWorkSessionsThenCleanup(workSessions, adminSession) {
  await Promise.all(workSessions.map((session) => session.close()));
  await runCleanup(adminSession);
}

async function runConcurrencyScenario(scenario, { testUserId }) {
  console.log(`\n=== ${scenario.name} ===`);

  const linkSession = createPsqlSession("vinculo");
  const changeSession = createPsqlSession("mudanca");
  const adminSession = createPsqlSession("admin");

  try {
    await runCleanup(adminSession); // pré-limpeza (item 5) — nunca confia em estado anterior
    await runFixtures(adminSession, testUserId);

    if (scenario.ordering === 1) {
      await beginAuthenticatedTransaction(linkSession, testUserId);
      await linkSession.exec(
        linkRpcSql({ parentId: FIXED_IDS.contractA, expectedParentId: null, confirm: false })
      );
      // FOR SHARE da RPC segue detido pela transação ainda aberta.

      const changeBackendPid = await changeSession.resolveBackendPid();
      const linkBackendPid = await linkSession.resolveBackendPid();
      const changeResultPromise = changeSession.exec(changeSql(scenario.changeKind), { waitForCompletion: false });

      const blocked = await pollUntilBlockedBy(adminSession, changeBackendPid, linkBackendPid);
      if (!blocked) {
        throw new Error("mudança do pai deveria ter ficado bloqueada ESPECIFICAMENTE pela sessão de vínculo, mas não confirmou (wait_event_type/pg_blocking_pids)");
      }

      await linkSession.exec("commit;");
      const changeResult = await changeResultPromise;
      // Validação manual (waitForCompletion:false não valida sozinho):
      if (scenario.expectChangeError.mustError && !changeResult.isError) {
        throw new Error(`mudança do pai deveria ter sido recusada, mas teve sucesso (sqlstate=${changeResult.sqlstate})`);
      }
      if (scenario.expectChangeError.mustError && !scenario.expectChangeError.messagePattern.test(changeResult.stdout)) {
        throw new Error(`mudança do pai recusada, mas com mensagem inesperada: ${changeResult.stdout.slice(0, 300)}`);
      }
      await changeSession.exec("rollback;");
    } else {
      await changeSession.exec("begin;");
      await changeSession.exec(changeSql(scenario.changeKind));

      const linkBackendPid = await linkSession.resolveBackendPid();
      const changeBackendPid = await changeSession.resolveBackendPid();
      await beginAuthenticatedTransaction(linkSession, testUserId);
      const linkResultPromise = linkSession.exec(
        linkRpcSql({ parentId: FIXED_IDS.contractA, expectedParentId: null, confirm: false }),
        { waitForCompletion: false }
      );

      const blocked = await pollUntilBlockedBy(adminSession, linkBackendPid, changeBackendPid);
      if (!blocked) {
        throw new Error("vínculo deveria ter ficado bloqueado ESPECIFICAMENTE pela sessão de mudança do pai, mas não confirmou");
      }

      await changeSession.exec(scenario.changeCommits ? "commit;" : "rollback;");
      const linkResult = await linkResultPromise;

      if (scenario.expectLinkOutcome.mustError) {
        if (!linkResult.isError) {
          throw new Error(`vínculo deveria ter sido recusado, mas teve sucesso (sqlstate=${linkResult.sqlstate})`);
        }
        if (!scenario.expectLinkOutcome.messagePattern.test(linkResult.stdout)) {
          throw new Error(`vínculo recusado, mas com mensagem inesperada: ${linkResult.stdout.slice(0, 300)}`);
        }
        await linkSession.exec("rollback;");
      } else {
        if (linkResult.isError) {
          throw new Error(`vínculo deveria ter prosseguido normalmente, mas falhou (sqlstate=${linkResult.sqlstate}): ${linkResult.stdout.slice(0, 300)}`);
        }
        await linkSession.exec("commit;");
      }
    }

    await runConsistencyCheck(adminSession);

    console.log(`OK   ${scenario.name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${scenario.name}`);
    console.log(`     ${error.message}`);
    return false;
  } finally {
    // Ordem correta (item 4): 1) fecha as sessões de TRABALHO (garante
    // rollback via encerramento de conexão) 2) só ENTÃO cleanup numa
    // sessão administrativa livre 3) verificação por contagem
    // (embutida em runCleanup/runConsistencyCheck).
    try {
      await closeWorkSessionsThenCleanup([linkSession, changeSession], adminSession);
    } catch (cleanupError) {
      console.log(`     (AVISO: limpeza pós-cenário falhou: ${cleanupError.message})`);
    }
    await adminSession.close();
  }
}

// ============================================================
// CENÁRIOS DE CONFLITO OTIMISTA (item 7) — contra a RPC REAL, com
// DOIS pais contratuais válidos (contractA=CONTRATO_BASE,
// aditivoB=ADITIVO), nunca uma reimplementação em JS.
// ============================================================

async function runOptimisticConcurrencyScenarios({ testUserId }) {
  console.log(`\n=== CONFLITO OTIMISTA — teste real contra a RPC (não reimplementação em JS) ===`);
  const session = createPsqlSession("otimista");
  const adminSession = createPsqlSession("admin-otimista");

  try {
    await runCleanup(adminSession);
    await runFixtures(adminSession, testUserId);

    // 1) Vincula ao pai A (fresh) → sucesso.
    await beginAuthenticatedTransaction(session, testUserId);
    await session.exec(linkRpcSql({ parentId: FIXED_IDS.contractA, expectedParentId: null, confirm: false }));
    await session.exec("commit;");
    let current = await currentParentOf(adminSession, FIXED_IDS.child);
    if (current !== FIXED_IDS.contractA) throw new Error(`esperado pai=A após vínculo inicial, obtido ${current}`);
    console.log("OK   1) vínculo inicial ao pai A");

    // 2) Troca para pai B com confirm=false → CONFIRMATION_REQUIRED; pai não muda.
    await beginAuthenticatedTransaction(session, testUserId);
    await session.exec(
      linkRpcSql({ parentId: FIXED_IDS.aditivoB, expectedParentId: FIXED_IDS.contractA, confirm: false }),
      { expect: { mustError: true, messagePattern: /CONFIRMATION_REQUIRED/ } }
    );
    await session.exec("rollback;");
    current = await currentParentOf(adminSession, FIXED_IDS.child);
    if (current !== FIXED_IDS.contractA) throw new Error(`confirm=false deveria ter deixado o pai inalterado (A), obtido ${current}`);
    console.log("OK   2) confirm=false recusado (CONFIRMATION_REQUIRED), pai inalterado");

    // 3) Troca para pai B com confirm=NULL (SQL NULL de verdade) → CONFIRMATION_REQUIRED; pai não muda.
    await beginAuthenticatedTransaction(session, testUserId);
    await session.exec(
      linkRpcSql({ parentId: FIXED_IDS.aditivoB, expectedParentId: FIXED_IDS.contractA, confirm: null }),
      { expect: { mustError: true, messagePattern: /CONFIRMATION_REQUIRED/ } }
    );
    await session.exec("rollback;");
    current = await currentParentOf(adminSession, FIXED_IDS.child);
    if (current !== FIXED_IDS.contractA) throw new Error(`confirm=NULL deveria ter deixado o pai inalterado (A), obtido ${current} — NULL NÃO PODE CONTORNAR A CONFIRMAÇÃO`);
    console.log("OK   3) confirm=NULL (SQL NULL real) recusado (CONFIRMATION_REQUIRED), pai inalterado — prova real, não só JS");

    // 4) Troca para pai B com confirm=true → sucesso; pai passa a ser B.
    await beginAuthenticatedTransaction(session, testUserId);
    await session.exec(linkRpcSql({ parentId: FIXED_IDS.aditivoB, expectedParentId: FIXED_IDS.contractA, confirm: true }));
    await session.exec("commit;");
    current = await currentParentOf(adminSession, FIXED_IDS.child);
    if (current !== FIXED_IDS.aditivoB) throw new Error(`confirm=true deveria ter trocado o pai para B, obtido ${current}`);
    console.log("OK   4) confirm=true permitido, pai agora é B");

    // 5) Atualiza só o fundamento do MESMO pai (B) com confirm=false → sucesso, sem confirmação.
    await beginAuthenticatedTransaction(session, testUserId);
    await session.exec(
      linkRpcSql({
        parentId: FIXED_IDS.aditivoB,
        expectedParentId: FIXED_IDS.aditivoB,
        confirm: false,
        basis: "Fundamento atualizado, mesmo pai B, sem trocar de pai — mais de vinte caracteres.",
      })
    );
    await session.exec("commit;");
    current = await currentParentOf(adminSession, FIXED_IDS.child);
    if (current !== FIXED_IDS.aditivoB) throw new Error(`atualizar fundamento do mesmo pai não deveria mudar o pai, obtido ${current}`);
    console.log("OK   5) atualizar fundamento do MESMO pai com confirm=false: sucesso sem exigir confirmação");

    // 6) Mesmo teste, confirm=NULL.
    await beginAuthenticatedTransaction(session, testUserId);
    await session.exec(
      linkRpcSql({
        parentId: FIXED_IDS.aditivoB,
        expectedParentId: FIXED_IDS.aditivoB,
        confirm: null,
        basis: "Fundamento atualizado de novo, mesmo pai B, confirm NULL — mais de vinte caracteres.",
      })
    );
    await session.exec("commit;");
    current = await currentParentOf(adminSession, FIXED_IDS.child);
    if (current !== FIXED_IDS.aditivoB) throw new Error(`atualizar fundamento do mesmo pai (confirm=NULL) não deveria mudar o pai, obtido ${current}`);
    console.log("OK   6) atualizar fundamento do MESMO pai com confirm=NULL: sucesso sem exigir confirmação");

    // 7) Pai esperado desatualizado (a tela ainda acha que é A, mas já é B) → CONFLICT_STALE_PARENT; pai não muda.
    await beginAuthenticatedTransaction(session, testUserId);
    await session.exec(
      linkRpcSql({ parentId: FIXED_IDS.contractA, expectedParentId: FIXED_IDS.contractA, confirm: true }),
      { expect: { mustError: true, messagePattern: /CONFLICT_STALE_PARENT/ } }
    );
    await session.exec("rollback;");
    current = await currentParentOf(adminSession, FIXED_IDS.child);
    if (current !== FIXED_IDS.aditivoB) throw new Error(`pai esperado desatualizado deveria ter deixado o pai inalterado (B), obtido ${current}`);
    console.log("OK   7) pai esperado desatualizado recusado (CONFLICT_STALE_PARENT), pai inalterado");

    console.log(`OK   CONFLITO OTIMISTA (7 sub-cenários) — todos passaram`);
    return true;
  } catch (error) {
    console.log(`FAIL CONFLITO OTIMISTA`);
    console.log(`     ${error.message}`);
    return false;
  } finally {
    try {
      await closeWorkSessionsThenCleanup([session], adminSession);
    } catch (cleanupError) {
      console.log(`     (AVISO: limpeza pós-cenário falhou: ${cleanupError.message})`);
    }
    await adminSession.close();
  }
}

// ---------- orquestração ----------

async function main() {
  const setupSession = createPsqlSession("setup");
  let testUserId;
  try {
    testUserId = await resolveTestUserId(setupSession);
  } finally {
    await setupSession.close();
  }

  let passed = 0;
  let failed = 0;

  for (const scenario of concurrencyScenarios) {
    const ok = await runConcurrencyScenario(scenario, { testUserId });
    if (ok) passed += 1;
    else failed += 1;
  }

  const optimisticOk = await runOptimisticConcurrencyScenarios({ testUserId });
  if (optimisticOk) passed += 1;
  else failed += 1;

  console.log(`\n======================================`);
  console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
  console.log(`======================================`);
  process.exitCode = failed > 0 ? 1 : 0;
}

await main();
