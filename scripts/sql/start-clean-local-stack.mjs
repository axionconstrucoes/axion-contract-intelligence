// Sobe (up) ou derruba (down) um stack Supabase local TOTALMENTE DESCARTÁVEL e identificado, para validar
// as migrations a partir de uma inicialização LIMPA (Postgres + Auth + Storage + API).
//
// Segurança: o stack usa um diretório de trabalho temporário com CÓPIA das migrations e do config.toml
// (sem supabase/.temp, logo sem vínculo com o projeto remoto); project_id obrigatoriamente "acc-disposable-*";
// portas 57xxx (nunca as do desenvolvimento 54xxx); nunca usa link/--linked/db push/db remote.
//
// Uso:
//   node scripts/sql/start-clean-local-stack.mjs up   --name acc-disposable-clean --port 57320 --workdir <dir> [--no-bootstrap]
//   node scripts/sql/start-clean-local-stack.mjs down --name acc-disposable-clean --workdir <dir>
//
// `--no-bootstrap` reproduz a inicialização limpa SEM o bootstrap de privilégios (falha em 20260920170000).

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOOTSTRAP_MIGRATION_FILE,
  EXCLUDED_SERVICES,
  assertDisposableName,
  assertSafeBasePort,
  buildDisposableConfig,
} from "./lib/clean-stack-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const cli = path.join(repo, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function run(args, options = {}) {
  const result = spawnSync(`"${cli}"`, args.map((value) => (/\s/.test(value) ? `"${value}"` : value)), { stdio: "inherit", shell: true, ...options });
  return result.status ?? 1;
}

const command = process.argv[2];
const name = arg("name");
const workdir = arg("workdir");
if (!["up", "down"].includes(command) || !name || !workdir) {
  console.error("Uso: start-clean-local-stack.mjs <up|down> --name acc-disposable-... --workdir <dir> [--port 57320] [--no-bootstrap]");
  process.exit(2);
}
assertDisposableName(name);
const workPath = path.resolve(workdir);

if (existsSync(path.join(workPath, "supabase", ".temp", "project-ref"))) {
  console.error("Recusado: o diretório de trabalho tem vínculo com projeto remoto (.temp/project-ref).");
  process.exit(2);
}

if (command === "down") {
  process.exit(run(["stop", "--workdir", workPath, "--no-backup"]));
}

const basePort = Number(arg("port", "57320"));
assertSafeBasePort(basePort);
if (existsSync(path.join(workPath, "supabase")) && readdirSync(path.join(workPath, "supabase")).length > 0) {
  console.error("Recusado: o diretório de trabalho já contém um projeto Supabase; use um diretório novo e vazio.");
  process.exit(2);
}

const supabaseDir = path.join(workPath, "supabase");
mkdirSync(supabaseDir, { recursive: true });
cpSync(path.join(repo, "supabase", "migrations"), path.join(supabaseDir, "migrations"), { recursive: true });
writeFileSync(path.join(supabaseDir, "seed.sql"), "");
if (!process.argv.includes("--no-bootstrap")) {
  writeFileSync(
    path.join(supabaseDir, "migrations", BOOTSTRAP_MIGRATION_FILE),
    readFileSync(path.join(here, "bootstrap-default-privileges.sql"), "utf8")
  );
}
writeFileSync(path.join(supabaseDir, "config.toml"), buildDisposableConfig(readFileSync(path.join(repo, "supabase", "config.toml"), "utf8"), name, basePort));

console.log(`[stack descartável] project_id=${name} api=127.0.0.1:${basePort + 1} db=127.0.0.1:${basePort + 2} workdir=${workPath}`);
console.log(`[stack descartável] containers esperados: supabase_db_${name}, supabase_auth_${name}, supabase_storage_${name}, supabase_kong_${name}, supabase_rest_${name}`);
console.log(`[stack descartável] bootstrap de privilégios: ${process.argv.includes("--no-bootstrap") ? "DESLIGADO" : "ligado (versão 00000000000001, só na cópia)"}`);
process.exit(run(["start", "--workdir", workPath, "-x", EXCLUDED_SERVICES]));
