// Aplica as migrations na HOMOLOGAÇÃO — somente com a trava de segurança satisfeita.
// Padrão = PLANO (nada é conectado nem alterado). `--apply` executa `supabase db push`.
//
// Variáveis de ambiente (nunca argumentos, nunca impressas):
//   HML_DB_URL            connection string do banco de HOMOLOGAÇÃO
//   ACC_HML_PROJECT_REF   ref do projeto de homologação
//   ACC_PROD_PROJECT_REF  ref(s) de PRODUÇÃO (obrigatório: a trava recusa esses refs)
//   ACC_HML_CONFIRM       STAGING-ONLY-NOT-PRODUCTION
//
// Uso: node scripts/homologation/apply-migrations.mjs --workdir <dir> [--no-bootstrap] [--apply]
// Esta ferramenta NUNCA usa `supabase link`, `--linked` nem `--include-all`.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertStagingTarget, GuardError, parseRefList } from "./staging-guard.mjs";
import { prepareWorkdir } from "./prepare-workdir.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workdir = arg("workdir");
  if (!workdir) {
    console.error("Uso: apply-migrations.mjs --workdir <dir> [--no-bootstrap] [--apply]");
    process.exit(2);
  }
  let guard;
  try {
    guard = assertStagingTarget({
      dbUrl: process.env.HML_DB_URL,
      stagingRef: process.env.ACC_HML_PROJECT_REF,
      productionRefs: parseRefList(process.env.ACC_PROD_PROJECT_REF),
      confirm: process.env.ACC_HML_CONFIRM,
    });
  } catch (error) {
    if (error instanceof GuardError) {
      console.error(`RECUSADO [${error.code}]: ${error.message}`);
      process.exit(3);
    }
    throw error;
  }
  const prepared = prepareWorkdir({ outDir: workdir, bootstrap: !process.argv.includes("--no-bootstrap") });
  console.log(`alvo validado (homologação, id ${guard.fingerprint}); ${prepared.count} migrations na cópia de trabalho (bootstrap: ${prepared.bootstrap ? "sim" : "não"}).`);
  if (!process.argv.includes("--apply")) {
    console.log("MODO PLANO: nada foi conectado nem aplicado. Reexecute com --apply para executar `supabase db push`.");
    process.exit(0);
  }
  const result = spawnSync("npx", ["supabase", "db", "push", "--db-url", process.env.HML_DB_URL, "--workdir", prepared.outDir], { stdio: "inherit", shell: process.platform === "win32" });
  process.exit(result.status ?? 1);
}
