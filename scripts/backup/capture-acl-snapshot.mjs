// Captura um snapshot das ACLs de public — owner, GRANT/REVOKE por
// função, SECURITY DEFINER, search_path e o ALTER DEFAULT PRIVILEGES
// vigente no schema — para servir de "gabarito" contra o qual uma
// restauração pode ser conferida automaticamente, sem depender de
// acesso ao remoto no momento da comparação (útil especialmente num
// cenário real de disaster recovery, onde o remoto pode estar
// indisponível).
//
// Nunca imprime senha nem connection string: no modo --linked, quem
// resolve a conexão é sempre o CLI Supabase autenticado (mesmo
// mecanismo já usado por `supabase db query --linked` durante esta
// sessão); no modo --container, a conexão é `docker exec <container>
// psql -U postgres -d postgres` (trust auth local, sem senha).
//
// Uso:
//   node scripts/backup/capture-acl-snapshot.mjs --linked --out snapshot.json [--backup-dir <pasta-do-backup>]
//   node scripts/backup/capture-acl-snapshot.mjs --container <nome> --out snapshot.json

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Chama o CLI Supabase pelo seu próprio ponto de entrada JS
// (node_modules/supabase/dist/supabase.js — é isto que
// node_modules/.bin/supabase(.cmd) já invoca por baixo, via
// `node "…/supabase.js" %*`), rodado com process.execPath. Isso
// elimina completamente qualquer shell — nunca passa por "npx", nunca
// por "cmd.exe": Node é um binário real, CreateProcess o inicia
// diretamente, argumentos vão sempre em array (nunca concatenados
// numa linha), então nem espaço em caminho/usuário nem metacaractere
// em argumento tem qualquer interpretação especial — chegam intactos
// ao processo (testado com um caminho real de espaço, "…Temp\\claude
// test dir with spaces\\test query.sql", contra o remoto de verdade).
// Funciona igual em Windows/Linux/macOS: process.execPath e o próprio
// supabase.js são multiplataforma, nenhum branch de SO necessário.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SUPABASE_CLI_ENTRY = path.join(REPO_ROOT, "node_modules", "supabase", "dist", "supabase.js");

function runSupabaseCli(cliArgs, options) {
  if (!existsSync(SUPABASE_CLI_ENTRY)) {
    throw new Error(
      `CLI Supabase não encontrado em ${SUPABASE_CLI_ENTRY} — rode "npm install" na raiz do repositório.`
    );
  }
  return run(process.execPath, [SUPABASE_CLI_ENTRY, ...cliArgs], options);
}

const args = process.argv.slice(2);
function flagValue(name) {
  const idx = args.indexOf(name);
  return idx === -1 ? null : args[idx + 1];
}
const hasFlag = (name) => args.includes(name);

const mode = hasFlag("--linked") ? "linked" : flagValue("--container") ? "container" : null;
const outPath = flagValue("--out");
const backupDir = flagValue("--backup-dir");
const container = flagValue("--container");

if (!mode || !outPath) {
  console.error(
    "Uso: node capture-acl-snapshot.mjs (--linked | --container <nome>) --out <arquivo.json> [--backup-dir <pasta>]"
  );
  process.exit(1);
}

// SQL única, sem segredos no resultado: função, argumentos de
// identidade, owner, proacl NORMALIZADA (só role=privilégios, sem o
// "grantor" — irrelevante para comparação de acesso), security
// definer, e o search_path declarado (proconfig).
const FUNCTIONS_SQL = `
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_userbyid(p.proowner) as owner,
  coalesce(
    (
      select string_agg(
        split_part(a.acl::text, '/', 1),
        ','
        order by split_part(a.acl::text, '/', 1)
      )
      from unnest(p.proacl) as a(acl)
    ),
    ''
  ) as normalized_acl,
  p.prosecdef as security_definer,
  coalesce(
    (select cfg from unnest(p.proconfig) cfg where cfg like 'search_path=%'),
    '<not set>'
  ) as search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname, identity_args;
`.trim();

const DEFAULT_ACL_SQL = `
select
  n.nspname as schema,
  d.defaclobjtype as object_type,
  coalesce(
    string_agg(distinct split_part(a.acl::text, '/', 1), ',' order by split_part(a.acl::text, '/', 1)),
    ''
  ) as normalized_default_acl
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
left join unnest(d.defaclacl) as a(acl) on true
where n.nspname = 'public'
group by n.nspname, d.defaclobjtype
order by d.defaclobjtype;
`.trim();

const VERSION_SQL = `select version();`;

function run(cmd, cmdArgs, { input } = {}) {
  // shell: false sempre — nenhum comando aqui passa por interpretação
  // de shell, então nem espaço em caminho/usuário nem aspas embutidas
  // em argumento quebram nada (array de argumentos vai direto para o
  // processo, nunca concatenado numa linha).
  const result = spawnSync(cmd, cmdArgs, { input, encoding: "utf8", shell: false });
  if (result.error) {
    throw new Error(`${cmd} falhou ao iniciar: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} falhou (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

const FIELD_SEP = "|";

// Criado sob demanda (só o modo --linked precisa escrever SQL em
// arquivo) e sempre removido no finally de main() — nunca deixa
// arquivo temporário para trás, sucesso ou falha.
let tmpDir = null;
function getTmpDir() {
  if (!tmpDir) {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "acl-snapshot-"));
  }
  return tmpDir;
}

function queryLinked(sql) {
  // Escreve a SQL num arquivo temporário e usa -f: o CLI já espera um
  // caminho de arquivo para SQL multi-linha (nunca precisaria caber
  // numa única linha de argumento de qualquer forma).
  const sqlFile = path.join(getTmpDir(), `query-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(sqlFile, sql, "utf8");
  const out = runSupabaseCli(["db", "query", "--linked", "-f", sqlFile]);
  const jsonStart = out.indexOf("{");
  const parsed = JSON.parse(out.slice(jsonStart));
  return parsed.rows ?? [];
}

function queryContainer(sql) {
  const out = run("docker", [
    "exec",
    container,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-t",
    "-A",
    "-F",
    FIELD_SEP,
    "-c",
    sql,
  ]);
  return out
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.split(FIELD_SEP));
}

// Project ref real do Supabase: sempre 20 caracteres alfanuméricos
// minúsculos (ex.: "plbcvwostmdmdmrziwmd"). Validado antes de entrar
// no snapshot — defesa em profundidade contra uma saída inesperada do
// CLI (nunca confiar cegamente em texto externo que vai para um
// arquivo consultado depois por outra ferramenta).
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function getProjectRefLinked() {
  const out = runSupabaseCli(["projects", "list", "--output", "json"]);
  const projects = JSON.parse(out.slice(out.indexOf("[")));
  const linked = projects.find((p) => p.linked);
  if (!linked) {
    return "<desconhecido>";
  }
  if (!PROJECT_REF_PATTERN.test(linked.ref)) {
    throw new Error(
      `project ref retornado pelo CLI não bate com o formato esperado (20 caracteres alfanuméricos minúsculos): "${linked.ref}"`
    );
  }
  return linked.ref;
}

function getBackupChecksums(dir) {
  const checksumFile = path.join(dir, "checksums-sha256.txt");
  if (!existsSync(checksumFile)) {
    return { source: null, files: {} };
  }
  const content = readFileSync(checksumFile, "utf8");
  const files = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (match) {
      files[match[2].trim()] = match[1];
    }
  }
  return { source: checksumFile, files };
}

function main() {
  const timestamp = new Date().toISOString();
  let functionsRaw, defaultAclRaw, versionRaw, projectRef;

  if (mode === "linked") {
    functionsRaw = queryLinked(FUNCTIONS_SQL).map((r) => [
      r.schema,
      r.function_name,
      r.identity_args,
      r.owner,
      r.normalized_acl,
      String(r.security_definer),
      r.search_path,
    ]);
    defaultAclRaw = queryLinked(DEFAULT_ACL_SQL).map((r) => [r.schema, r.object_type, r.normalized_default_acl]);
    const versionRows = queryLinked(VERSION_SQL);
    versionRaw = versionRows[0]?.version ?? "<desconhecida>";
    projectRef = getProjectRefLinked();
  } else {
    functionsRaw = queryContainer(FUNCTIONS_SQL);
    defaultAclRaw = queryContainer(DEFAULT_ACL_SQL);
    versionRaw = queryContainer(VERSION_SQL)[0]?.[0] ?? "<desconhecida>";
    projectRef = `local:${container}`;
  }

  const functions = functionsRaw.map(([schema, function_name, identity_args, owner, normalized_acl, security_definer, search_path]) => ({
    schema,
    function_name,
    identity_args,
    owner,
    normalized_acl,
    security_definer: security_definer === "t" || security_definer === "true",
    search_path,
  }));

  const defaultAcl = defaultAclRaw.map(([schema, object_type, normalized_default_acl]) => ({
    schema,
    object_type,
    normalized_default_acl,
  }));

  const snapshot = {
    captured_at: timestamp,
    mode,
    project_ref: projectRef,
    postgres_version: versionRaw,
    backup_checksums: backupDir ? getBackupChecksums(backupDir) : null,
    function_count: functions.length,
    functions,
    default_acl: defaultAcl,
  };

  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`Snapshot salvo em ${outPath} (${functions.length} funções, modo=${mode}).`);
}

try {
  main();
} finally {
  // Sempre roda, sucesso ou falha — nenhum arquivo SQL temporário
  // (escrito só no modo --linked, via getTmpDir()) fica para trás.
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
