// Prepara a CÓPIA DE TRABALHO usada para aplicar as migrations na homologação:
//   <outDir>/supabase/migrations/  = as migrations do repositório (cópia, nunca alteradas)
//                                   + 00000000000001_bootstrap_default_privileges.sql (opcional)
// O bootstrap NÃO entra em supabase/migrations/ do repositório (não reescreve histórico) — ver
// docs/migration-privilegios-inicializacao-limpa.md (opção C). A cópia NUNCA tem
// supabase/.temp/project-ref: o CLI não fica vinculado a nenhum projeto remoto.
//
// Uso: node scripts/homologation/prepare-workdir.mjs --out <dir> [--no-bootstrap]

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");
export const BOOTSTRAP_VERSION_FILE = "00000000000001_bootstrap_default_privileges.sql";

export function prepareWorkdir({ outDir, bootstrap = true, repo = repoRoot }) {
  const out = path.resolve(outDir);
  const repoSupabase = path.join(repo, "supabase");
  if (out === repo || out.startsWith(repoSupabase + path.sep) || out === repoSupabase) {
    throw new Error("Recusado: a cópia de trabalho não pode ficar dentro de supabase/ do repositório.");
  }
  if (existsSync(path.join(out, "supabase", ".temp", "project-ref"))) {
    throw new Error("Recusado: o diretório de trabalho tem vínculo com projeto remoto (.temp/project-ref).");
  }
  const migDir = path.join(out, "supabase", "migrations");
  rmSync(migDir, { recursive: true, force: true });
  mkdirSync(migDir, { recursive: true });
  cpSync(path.join(repo, "supabase", "migrations"), migDir, { recursive: true });
  if (bootstrap) writeFileSync(path.join(migDir, BOOTSTRAP_VERSION_FILE), readFileSync(path.join(repo, "scripts", "sql", "bootstrap-default-privileges.sql"), "utf8"));
  const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  return { outDir: out, count: files.length, first: files[0], bootstrap };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  if (i < 0 || !process.argv[i + 1]) {
    console.error("Uso: prepare-workdir.mjs --out <dir> [--no-bootstrap]");
    process.exit(2);
  }
  const result = prepareWorkdir({ outDir: process.argv[i + 1], bootstrap: !process.argv.includes("--no-bootstrap") });
  console.log(`cópia de trabalho pronta: ${result.count} arquivos de migration (primeiro: ${result.first}; bootstrap: ${result.bootstrap ? "sim" : "não"}) em ${result.outDir}`);
}
