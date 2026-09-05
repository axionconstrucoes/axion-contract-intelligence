// Pacote D — automacao da ingestao de conteudo.
//
// Prova que a automacao nasce desligada, que dry-run nao grava, que dois
// workers nunca pegam o mesmo vinculo, que o backoff e o teto de
// tentativas funcionam, e que arquivo grande sai da fila sem bloquea-la.
//
// Nenhuma chamada real, nenhum Supabase, nenhum download: banco falso em
// memoria que reproduz a semantica das RPCs da migration.
//
// Uso: node scripts/test-construmanager-automation.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  resolveAutomationConfig,
  computeBackoffSeconds,
  evaluateSizePolicy,
  hasTimeBudgetFor,
  MAX_ITEMS_CEILING,
  MAX_FILE_BYTES_CEILING,
  MAX_AUTO_ATTEMPTS,
} = await import("../apps/web/lib/integrations/construmanager/automation-policy.ts");

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

// Ambiente completo e valido, usado como base das variacoes.
const ENV_OK = {
  CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED: "true",
  CONSTRUMANAGER_AUTO_DRY_RUN: "false",
  CONSTRUMANAGER_AUTO_MAX_ITEMS: "2",
  CONSTRUMANAGER_AUTO_MAX_FILE_BYTES: "52428800",
  CONSTRUMANAGER_AUTO_TIME_BUDGET_MS: "600000",
};

console.log("");
console.log("PACOTE D — AUTOMACAO DA INGESTAO DE CONTEUDO");
console.log("============================================");
console.log("");
console.log("-- 1. a automacao nasce desligada (fail-closed) --");

check(
  "ambiente vazio => desligada",
  resolveAutomationConfig({}).enabled === false
);

check(
  "ambiente vazio => motivo explicito, nunca silencio",
  (resolveAutomationConfig({}).reason ?? "").includes("CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED")
);

for (const valor of ["", "TRUE", "True", "1", "yes", "sim", " true ", "true\n"]) {
  const env = { ...ENV_OK, CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED: valor };
  const esperado = valor.trim() === "true";
  check(
    `habilitacao com ${JSON.stringify(valor)} => ${esperado ? "ligada" : "desligada"}`,
    resolveAutomationConfig(env).enabled === esperado
  );
}

check(
  "config desligada tem dryRun=true e limites zerados",
  (() => {
    const d = resolveAutomationConfig({});
    return d.config.dryRun === true && d.config.maxItems === 0 && d.config.maxFileBytes === 0;
  })()
);

console.log("");
console.log("-- 2. kill switch tem precedencia --");

check(
  "kill switch desliga mesmo com tudo habilitado",
  resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_KILL_SWITCH: "true" }).enabled === false
);

check(
  "kill switch aparece no motivo",
  (resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_KILL_SWITCH: "true" }).reason ?? "")
    .toLowerCase()
    .includes("kill switch")
);

check(
  "kill switch com outro valor NAO desliga",
  resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_KILL_SWITCH: "false" }).enabled === true
);

console.log("");
console.log("-- 3. variavel ausente ou fora de faixa desliga tudo --");

for (const chave of [
  "CONSTRUMANAGER_AUTO_MAX_ITEMS",
  "CONSTRUMANAGER_AUTO_MAX_FILE_BYTES",
  "CONSTRUMANAGER_AUTO_TIME_BUDGET_MS",
]) {
  const env = { ...ENV_OK };
  delete env[chave];
  check(`${chave} ausente => desligada`, resolveAutomationConfig(env).enabled === false);
}

check(
  "maxItems=0 => desligada",
  resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_MAX_ITEMS: "0" }).enabled === false
);

check(
  `maxItems acima do teto (${MAX_ITEMS_CEILING}) => desligada`,
  resolveAutomationConfig({
    ...ENV_OK,
    CONSTRUMANAGER_AUTO_MAX_ITEMS: String(MAX_ITEMS_CEILING + 1),
  }).enabled === false
);

check(
  "maxFileBytes acima do limite do bucket => desligada",
  resolveAutomationConfig({
    ...ENV_OK,
    CONSTRUMANAGER_AUTO_MAX_FILE_BYTES: String(MAX_FILE_BYTES_CEILING + 1),
  }).enabled === false
);

check(
  "valor nao numerico ('10abc') => desligada, nao vira 10",
  resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_MAX_ITEMS: "10abc" }).enabled === false
);

check(
  "notacao cientifica ('1e3') => desligada",
  resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_MAX_ITEMS: "1e3" }).enabled === false
);

check(
  "negativo => desligada",
  resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_MAX_ITEMS: "-5" }).enabled === false
);

console.log("");
console.log("-- 4. dry-run e o padrao --");

check(
  "sem CONSTRUMANAGER_AUTO_DRY_RUN => dryRun continua true",
  (() => {
    const env = { ...ENV_OK };
    delete env.CONSTRUMANAGER_AUTO_DRY_RUN;
    const d = resolveAutomationConfig(env);
    return d.enabled === true && d.config.dryRun === true;
  })()
);

for (const valor of ["", "FALSE", "False", "0", "nao", "no"]) {
  check(
    `dryRun permanece ligado com ${JSON.stringify(valor)}`,
    resolveAutomationConfig({ ...ENV_OK, CONSTRUMANAGER_AUTO_DRY_RUN: valor }).config.dryRun === true
  );
}

check(
  'apenas "false" exato desliga o dry-run',
  resolveAutomationConfig(ENV_OK).config.dryRun === false
);

console.log("");
console.log("-- 5. politica de tamanho: grande sai da fila, nao bloqueia --");

const LIMITE = 52428800; // 50 MB

check(
  "arquivo pequeno e elegivel",
  evaluateSizePolicy(7538716, LIMITE).eligible === true
);

check(
  "arquivo exatamente no limite e elegivel",
  evaluateSizePolicy(LIMITE, LIMITE).eligible === true
);

check(
  "um byte acima do limite ja NAO e elegivel",
  evaluateSizePolicy(LIMITE + 1, LIMITE).eligible === false
);

check(
  "IFC #38350763 (262,9 MiB) NAO entra na fila de download",
  evaluateSizePolicy(275687647, LIMITE).eligible === false
);

check(
  "IFC vira REFERENCIA_EXTERNA, nao decisao humana",
  evaluateSizePolicy(275687647, LIMITE).classification === "REFERENCIA_EXTERNA"
);

check(
  "IFC recebe o motivo de POLITICA DE ARMAZENAMENTO",
  evaluateSizePolicy(275687647, LIMITE).reason === "ACIMA_DO_LIMITE_DE_ARMAZENAMENTO"
);

check(
  "tamanho grande NUNCA e classificado como decisao humana",
  evaluateSizePolicy(275687647, LIMITE).classification !== "DECISAO_HUMANA"
);

check(
  "tamanho desconhecido e ANOMALIA (decisao humana), nao referencia externa",
  (() => {
    const v = evaluateSizePolicy(null, LIMITE);
    return v.classification === "DECISAO_HUMANA" && v.reason === "TAMANHO_DESCONHECIDO";
  })()
);

check(
  "tamanho negativo e tratado como desconhecido",
  evaluateSizePolicy(-1, LIMITE).reason === "TAMANHO_DESCONHECIDO"
);

check(
  "arquivo pequeno segue ELEGIVEL (fluxo normal de ingestao)",
  evaluateSizePolicy(1363238, LIMITE).classification === "ELEGIVEL"
);

check(
  "o motivo sempre acompanha um detalhe legivel",
  [evaluateSizePolicy(null, LIMITE), evaluateSizePolicy(275687647, LIMITE)].every(
    (v) => typeof v.detail === "string" && v.detail.length > 0
  )
);

check(
  "mudanca controlada do limite reclassifica: com teto de 500 MB o IFC volta a ser elegivel",
  evaluateSizePolicy(275687647, 524288000).classification === "ELEGIVEL"
);

console.log("");
console.log("-- 6. backoff e teto de tentativas --");

check("1a falha => 5 min", computeBackoffSeconds(1) === 300);
check("2a falha => 30 min", computeBackoffSeconds(2) === 1800);
check("3a falha => 2 h", computeBackoffSeconds(3) === 7200);
check("backoff e crescente", computeBackoffSeconds(1) < computeBackoffSeconds(2) && computeBackoffSeconds(2) < computeBackoffSeconds(3));
check("valor invalido nao vira 0 (nunca retry imediato)", computeBackoffSeconds(NaN) >= 300);
check("teto de tentativas automaticas e 3", MAX_AUTO_ATTEMPTS === 3);

console.log("");
console.log("-- 7. orcamento de tempo --");

check("cabe mais um item no inicio", hasTimeBudgetFor(0, 600000, 180000) === true);
check("nao cabe quando falta menos que a reserva", hasTimeBudgetFor(500000, 600000, 180000) === false);
check("limite exato ainda cabe", hasTimeBudgetFor(420000, 600000, 180000) === true);

// ------------------------------------------------------------
// Banco falso: reproduz a semantica das RPCs da migration.
// ------------------------------------------------------------

function fakeDb() {
  const db = {
    links: [],
    blobs: [],
    storage: [],
    audit: [],
    now: 1000000,
  };

  db.seed = (itens) => {
    db.links = itens.map((i) => ({
      id: i.id,
      project_id: "P",
      download_status: i.status ?? "PENDENTE",
      auto_attempts: i.auto ?? 0,
      download_attempts: i.att ?? 0,
      requires_human_decision: false,
      human_decision_reason: null,
      human_decision_at: null,
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: null,
      content_blob_id: null,
      download_error: null,
      size_bytes: i.size ?? 1000,
    }));
  };

  // claim_construmanager_content_targets: FOR UPDATE SKIP LOCKED
  // reproduzido como "quem chega primeiro leva".
  db.claim = (worker, limit, maxBytes, leaseSeconds) => {
    const elegiveis = db.links.filter(
      (l) =>
        // Mesma clausula da migration: fila normal OU lease expirado.
        (["PENDENTE", "ERRO"].includes(l.download_status) ||
          (l.download_status === "BAIXANDO" &&
            l.lease_expires_at !== null &&
            l.lease_expires_at <= db.now)) &&
        !l.requires_human_decision &&
        (l.next_attempt_at === null || l.next_attempt_at <= db.now) &&
        (l.lease_expires_at === null || l.lease_expires_at <= db.now) &&
        l.size_bytes !== null &&
        l.size_bytes <= maxBytes
    );

    const pegos = elegiveis.slice(0, limit);

    for (const l of pegos) {
      l.download_status = "BAIXANDO";
      l.lease_owner = worker;
      l.lease_expires_at = db.now + leaseSeconds * 1000;
      l.auto_attempts += 1;
      l.download_attempts += 1;
      l.download_error = null;
    }

    return pegos.map((l) => ({ link_id: l.id, size_bytes: l.size_bytes }));
  };

  db.fail = (id, erro, backoffSeconds, maxAuto) => {
    const l = db.links.find((x) => x.id === id);
    const esgotado = l.auto_attempts >= maxAuto;

    l.download_status = "ERRO";
    l.download_error = erro;
    l.lease_owner = null;
    l.lease_expires_at = null;
    l.next_attempt_at = esgotado ? null : db.now + backoffSeconds * 1000;
    l.requires_human_decision = esgotado;

    if (esgotado) {
      l.human_decision_reason = "TENTATIVAS_AUTOMATICAS_ESGOTADAS";
      l.human_decision_at = db.now;
      db.audit.push({
        action: "CONSTRUMANAGER_CONTENT_REQUIRES_HUMAN_DECISION",
        entity_id: id,
      });
    }

    return { auto_attempts: l.auto_attempts, requires_human_decision: esgotado };
  };

  db.flagHuman = (id, reason) => {
    const l = db.links.find((x) => x.id === id);
    if (l.requires_human_decision) return; // idempotente
    l.requires_human_decision = true;
    l.human_decision_reason = reason;
    l.human_decision_at = db.now;
    l.lease_owner = null;
    l.lease_expires_at = null;
    l.next_attempt_at = null;
    db.audit.push({ action: "CONSTRUMANAGER_CONTENT_REQUIRES_HUMAN_DECISION", entity_id: id });
  };

  db.release = (id, worker) => {
    const l = db.links.find((x) => x.id === id);
    if (l.lease_owner !== worker || l.download_status !== "BAIXANDO") return;
    l.download_status = "PENDENTE";
    l.lease_owner = null;
    l.lease_expires_at = null;
    l.auto_attempts = Math.max(l.auto_attempts - 1, 0);
    l.download_attempts = Math.max(l.download_attempts - 1, 0);
  };

  db.complete = (id, sha, size) => {
    const l = db.links.find((x) => x.id === id);
    let blob = db.blobs.find((b) => b.sha256 === sha);
    let reused = true;

    if (!blob) {
      blob = { id: `blob-${db.blobs.length + 1}`, sha256: sha, size_bytes: size };
      db.blobs.push(blob);
      db.storage.push({ name: `sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}` });
      reused = false;
    }

    l.download_status = "ARMAZENADO";
    l.content_blob_id = blob.id;
    l.lease_owner = null;
    l.lease_expires_at = null;
    l.next_attempt_at = null;
    l.download_error = null;

    return { blob_id: blob.id, blob_reused: reused };
  };

  return db;
}

console.log("");
console.log("-- 8. aquisicao unica e workers concorrentes --");

{
  const db = fakeDb();
  db.seed([{ id: "a" }, { id: "b" }, { id: "c" }]);

  const w1 = db.claim("worker-1", 2, 1e9, 600);
  const w2 = db.claim("worker-2", 2, 1e9, 600);

  check("worker 1 adquire 2 alvos", w1.length === 2);
  check("worker 2 adquire apenas o alvo restante", w2.length === 1);

  const ids1 = w1.map((x) => x.link_id);
  const ids2 = w2.map((x) => x.link_id);

  check(
    "os conjuntos sao DISJUNTOS — nenhum vinculo processado duas vezes",
    ids1.every((id) => !ids2.includes(id))
  );

  check(
    "cada vinculo tem no maximo um dono de lease",
    db.links.every((l) => l.lease_owner === null || typeof l.lease_owner === "string")
  );

  const terceiro = db.claim("worker-3", 5, 1e9, 600);
  check("nada sobra para um terceiro worker", terceiro.length === 0);

  check(
    "aquisicao incrementa tentativa automatica",
    db.links.filter((l) => l.auto_attempts === 1).length === 3
  );
}

console.log("");
console.log("-- 9. lease expirado permite retomada --");

{
  const db = fakeDb();
  db.seed([{ id: "a" }]);

  db.claim("worker-morto", 1, 1e9, 600);
  check("com lease vivo, ninguem mais pega", db.claim("worker-novo", 1, 1e9, 600).length === 0);

  db.now += 601 * 1000; // lease expirou
  const retomada = db.claim("worker-novo", 1, 1e9, 600);

  check("lease expirado libera o item", retomada.length === 1);
  check("novo dono assume o lease", db.links[0].lease_owner === "worker-novo");
  check("interrupcao nao criou blob orfao", db.blobs.length === 0 && db.storage.length === 0);
}

console.log("");
console.log("-- 10. tres tentativas e depois decisao humana --");

{
  const db = fakeDb();
  db.seed([{ id: "a" }]);

  const r = [];
  for (let i = 1; i <= 3; i += 1) {
    db.now += 1;
    db.links[0].next_attempt_at = null;
    db.links[0].lease_expires_at = null;
    db.claim("w", 1, 1e9, 600);
    r.push(db.fail("a", `falha ${i}`, computeBackoffSeconds(i), MAX_AUTO_ATTEMPTS));
  }

  check("1a falha nao exige decisao humana", r[0].requires_human_decision === false);
  check("2a falha nao exige decisao humana", r[1].requires_human_decision === false);
  check("3a falha EXIGE decisao humana", r[2].requires_human_decision === true);
  check("apos esgotar, next_attempt_at fica nulo (nao reagenda)", db.links[0].next_attempt_at === null);
  check("motivo registrado", db.links[0].human_decision_reason === "TENTATIVAS_AUTOMATICAS_ESGOTADAS");
  check("alerta auditavel gerado uma vez", db.audit.length === 1);
  check("erro preservado para diagnostico", db.links[0].download_error === "falha 3");

  db.now += 10 * 60 * 60 * 1000;
  check(
    "item esgotado NUNCA volta para a fila automatica",
    db.claim("w", 5, 1e9, 600).length === 0
  );
}

console.log("");
console.log("-- 11. arquivo grande sai sem bloquear a fila --");

{
  const db = fakeDb();
  db.seed([
    { id: "grande", size: 275687647 },
    { id: "pequeno1", size: 7538716 },
    { id: "pequeno2", size: 1363238 },
  ]);

  const LIM = 52428800;

  for (const l of db.links) {
    const v = evaluateSizePolicy(l.size_bytes, LIM);
    if (!v.eligible) db.flagHuman(l.id, v.reason);
  }

  check(
    "o grande foi marcado para decisao humana",
    db.links.find((l) => l.id === "grande").requires_human_decision === true
  );

  const pegos = db.claim("w", 10, LIM, 600);

  check("os pequenos continuam sendo processados", pegos.length === 2);
  check("o grande nao foi adquirido", !pegos.some((p) => p.link_id === "grande"));
  check(
    "o grande nao consumiu tentativa (nao virou ciclo de erro)",
    db.links.find((l) => l.id === "grande").auto_attempts === 0
  );

  db.flagHuman("grande", "ACIMA_DO_LIMITE_AUTOMATICO");
  check("sinalizar duas vezes nao duplica alerta", db.audit.length === 1);
}

console.log("");
console.log("-- 12. deduplicacao preservada --");

{
  const db = fakeDb();
  db.seed([{ id: "cabeca" }, { id: "versao" }]);
  db.claim("w", 2, 1e9, 600);

  const SHA = "fd81a22303ab5257006e7f858d79171d15883378da1feb67feb4b1de985894d1";

  const r1 = db.complete("cabeca", SHA, 7538716);
  const r2 = db.complete("versao", SHA, 7538716);

  check("primeiro download cria o blob", r1.blob_reused === false);
  check("segundo download REAPROVEITA o blob", r2.blob_reused === true);
  check("apenas 1 blob para os dois vinculos", db.blobs.length === 1);
  check("apenas 1 objeto no Storage", db.storage.length === 1);
  check("os dois vinculos apontam para o mesmo blob", r1.blob_id === r2.blob_id);
  check(
    "os dois ficam ARMAZENADO",
    db.links.every((l) => l.download_status === "ARMAZENADO")
  );
}

console.log("");
console.log("-- 13. interrupcao nao deixa orfao --");

{
  const db = fakeDb();
  db.seed([{ id: "a" }, { id: "b" }]);
  db.claim("w", 2, 1e9, 600);

  // Rodada estourou o orcamento: devolve o que nao processou.
  db.release("a", "w");
  db.release("b", "w");

  check("itens voltam para PENDENTE", db.links.every((l) => l.download_status === "PENDENTE"));
  check("leases foram devolvidos", db.links.every((l) => l.lease_owner === null));
  check(
    "tentativa nao consumida e devolvida (nao gasta o teto de 3)",
    db.links.every((l) => l.auto_attempts === 0)
  );
  check("nenhum blob ou objeto criado", db.blobs.length === 0 && db.storage.length === 0);
  check("release de outro worker nao tem efeito", (() => {
    db.claim("w", 1, 1e9, 600);
    const antes = db.links[0].download_status;
    db.release(db.links[0].id, "outro-worker");
    return db.links[0].download_status === antes;
  })());
}

// ------------------------------------------------------------
// Auditoria do codigo real
// ------------------------------------------------------------

const migration = readFileSync(
  "supabase/migrations/20260905180000_construmanager_content_automation.sql",
  "utf8"
);

const worker = readFileSync("scripts/construmanager-content-worker.mjs", "utf8");
const workflow = readFileSync(".github/workflows/construmanager-content-ingestion.yml", "utf8");
const policy = readFileSync(
  "apps/web/lib/integrations/construmanager/automation-policy.ts",
  "utf8"
);

const stripSql = (s) => s.replace(/^\s*--.*$/gm, " ");
const migrationBody = stripSql(migration);

console.log("");
console.log("-- 14. migration: seguranca e escopo --");

check(
  "toda funcao que toca tabela e SECURITY DEFINER",
  // normalize_construmanager_revision e a unica excecao, e de proposito:
  // e uma funcao pura (language sql immutable) que so normaliza texto.
  // Dar privilegio elevado a ela seria conceder poder sem necessidade.
  (migrationBody.match(/security definer/g) ?? []).length ===
    (migrationBody.match(/create or replace function/g) ?? []).length - 1
);

check(
  "a unica funcao sem SECURITY DEFINER e a normalizadora pura",
  /create or replace function public\.normalize_construmanager_revision[\s\S]{0,400}?language sql[\s\S]{0,80}?immutable/.test(
    migrationBody
  ) &&
    !/create or replace function public\.normalize_construmanager_revision[\s\S]{0,400}?security definer/.test(
      migrationBody
    )
);

check(
  "TODAS as funcoes usam search_path vazio, inclusive a pura",
  (migrationBody.match(/set search_path = ''/g) ?? []).length ===
    (migrationBody.match(/create or replace function/g) ?? []).length
);

check(
  "grants sao exclusivos de service_role",
  /grant execute on function %s to service_role/.test(migrationBody) &&
    /revoke all on function %s from authenticated/.test(migrationBody) &&
    /revoke all on function %s from anon/.test(migrationBody) &&
    /revoke all on function %s from public/.test(migrationBody)
);

check(
  "nenhuma RPC de CONTEUDO concede execucao a authenticated",
  (() => {
    // O bloco de grants das RPCs de conteudo (service_role apenas).
    const blocos = migrationBody.split("foreach fn in array array[");
    const conteudo = blocos.find((b) =>
      b.slice(0, 400).includes("claim_construmanager_content_targets")
    );
    return Boolean(conteudo) && !/grant execute on function[^;]*to authenticated/.test(conteudo);
  })()
);

check(
  "o detector de versao E concedido a authenticated, de proposito (caminho pos-sync na UI)",
  (() => {
    const blocos = migrationBody.split("foreach fn in array array[");
    // O bloco certo e aquele cuja LISTA (primeiras linhas) nomeia o
    // detector — nao qualquer bloco que o mencione mais adiante.
    const detector = blocos.find((b) =>
      b.slice(0, 200).includes("detect_construmanager_version_transitions")
    );
    return Boolean(detector) && /grant execute on function[^;]*to authenticated/.test(detector);
  })()
);

check(
  "aquisicao usa FOR UPDATE SKIP LOCKED",
  /for update of l skip locked/i.test(migrationBody)
);

check(
  "a nova tabela de metricas tem RLS habilitada",
  /alter table public\.construmanager_content_runs enable row level security/.test(migrationBody)
);

check(
  "metricas so permitem SELECT a membros do projeto",
  /create policy construmanager_content_runs_select_members[\s\S]{0,200}for select[\s\S]{0,120}is_project_member/.test(
    migrationBody
  )
);

check(
  "a migration NAO altera as tabelas do Pacote B",
  !/alter table public\.construmanager_(documents|document_versions|folders)/.test(migrationBody)
);

check(
  "a migration NAO altera a tabela de blobs",
  !/alter table public\.construmanager_content_blobs/.test(migrationBody)
);

check(
  "as 5 RPCs do Pacote C nao sao redefinidas",
  !/create or replace function public\.(begin|fail|find)_construmanager_content_(download|blob)\s*\(/.test(
    migrationBody
  ) &&
    !/create or replace function public\.complete_construmanager_content_download\s*\(/.test(
      migrationBody
    ) &&
    !/create or replace function public\.ensure_construmanager_content_links\s*\(/.test(
      migrationBody
    )
);

check(
  "a conclusao delega a dedup a RPC do Pacote C",
  /from public\.complete_construmanager_content_download\(/.test(migrationBody)
);

check(
  "falha NUNCA limpa content_blob_id",
  !/content_blob_id\s*=\s*null/i.test(migrationBody)
);

check(
  "nenhum comando destrutivo",
  !/\bdrop table\b|\btruncate\b|\bdelete from\b/i.test(migrationBody)
);

console.log("");
console.log("-- 15. worker: seguranca e comportamento --");

check(
  "o worker checa a politica ANTES de abrir conexao",
  worker.indexOf("resolveAutomationConfig(process.env)") < worker.indexOf("createClient(")
);

check(
  "automacao desligada encerra sem tocar em nada",
  /if \(!decision\.enabled\)[\s\S]{0,260}process\.exit\(0\)/.test(worker)
);

check(
  "dry-run sai antes de qualquer escrita ou download",
  (() => {
    const i = worker.indexOf("if (config.dryRun)");
    const fim = worker.indexOf("EXECUCAO REAL");
    const bloco = worker.slice(i, fim);
    return (
      i > -1 &&
      /process\.exit\(0\)/.test(bloco) &&
      !/\.rpc\(/.test(bloco) &&
      !/downloadConstrumanagerContent\(/.test(bloco) &&
      !/\.upload\(/.test(bloco)
    );
  })()
);

check(
  "o worker reutiliza o download do Pacote C (nao reimplementa)",
  /downloadConstrumanagerContent/.test(worker) && /buildContentStoragePath/.test(worker)
);

check(
  "o worker nao reimplementa leitura de ZIP nem SHA-256",
  !/createHash\(/.test(worker) && !/readZipDirectory|extractZipEntry/.test(worker)
);

check(
  "erros sao sanitizados antes de gravar",
  /sanitizeConstrumanagerContentError\(error\)/.test(worker)
);

check(
  "nenhum segredo literal no worker",
  !/sb_secret_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{20,}\.|password\s*[:=]\s*["'][^"']{4,}/.test(worker)
);

check(
  "a chave so vem de variavel de ambiente",
  /requiredEnv\("SUPABASE_SECRET_KEY"\)/.test(worker)
);

check(
  "nenhuma chave e impressa em log",
  !/console\.log[^\n]*(SECRET|token\.access_token|apikey)/i.test(worker)
);

check(
  "processamento sequencial (sem Promise.all sobre downloads)",
  !/Promise\.all\(/.test(worker)
);

check(
  "leases sao devolvidos no caminho de erro tambem",
  (worker.match(/release_construmanager_content_lease/g) ?? []).length >= 2
);

check(
  "o worker usa somente as RPCs de sistema para escrever",
  !/rpc\("begin_construmanager_content_download"/.test(worker) &&
    !/rpc\("fail_construmanager_content_download"/.test(worker)
);

console.log("");
console.log("-- 16. workflow nasce desativado --");

check(
  "nao existe gatilho schedule ativo",
  !/^\s{2}schedule:/m.test(workflow)
);

check(
  "o schedule esta comentado e sinalizado",
  /#\s*schedule:/.test(workflow) && /DESATIVADO/.test(workflow)
);

check(
  "existe apenas disparo manual",
  /workflow_dispatch:/.test(workflow)
);

check(
  "concorrencia impede duas rodadas simultaneas",
  /concurrency:[\s\S]{0,120}group: construmanager-content-ingestion/.test(workflow)
);

check(
  "ha timeout explicito no job",
  /timeout-minutes:\s*\d+/.test(workflow)
);

check(
  "nenhum segredo literal no workflow",
  !/sb_secret_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{20,}\./.test(workflow)
);

check(
  "segredos vem de secrets/vars do agendador",
  /\$\{\{ secrets\.SUPABASE_SECRET_KEY \}\}/.test(workflow) &&
    /\$\{\{ vars\.CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED \}\}/.test(workflow)
);

console.log("");
console.log("-- 17. contingencia manual preservada --");

const componente = readFileSync(
  "apps/web/components/integrations/construmanager-content-download.tsx",
  "utf8"
);

const actions = readFileSync("apps/web/app/[projectId]/integracoes/actions.ts", "utf8");

check(
  "o botao manual continua existindo",
  /name="linkId" value=\{item\.linkId\}/.test(componente)
);

check(
  "o botao manual mantem o destaque magenta",
  /CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS/.test(componente)
);

check(
  "download em lote continua oculto",
  /const SHOW_BATCH_DOWNLOAD = false;/.test(componente)
);

check(
  "a action manual segue exigindo sessao autenticada",
  /export async function downloadConstrumanagerContentAction[\s\S]{0,400}await requireUser\(supabase\)/.test(
    actions
  )
);

check(
  "a action manual nao foi alterada para usar RPC de sistema",
  !/_system"/.test(actions)
);

check(
  "a politica nao importa Supabase nem rede (modulo puro)",
  !/@supabase|createClient|fetch\(/.test(policy)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
