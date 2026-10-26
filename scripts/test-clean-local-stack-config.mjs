// Config do stack Supabase local descartável: identificação, portas e guardas (puro, sem Docker).
// Uso: node scripts/test-clean-local-stack-config.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as stack from "./sql/lib/clean-stack-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoConfig = readFileSync(path.join(here, "..", "supabase", "config.toml"), "utf8").replace(/\r\n/g, "\n");
const bootstrap = readFileSync(path.join(here, "sql", "bootstrap-default-privileges.sql"), "utf8");
const starter = readFileSync(path.join(here, "sql", "start-clean-local-stack.mjs"), "utf8");

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

check("só aceita nomes 'acc-disposable-*' e recusa o projeto de desenvolvimento", () => {
  stack.assertDisposableName("acc-disposable-clean");
  for (const bad of ["axion-contract-intelligence", "producao", "acc-disposable-", "acc-disposable-CLEAN", "x".repeat(60)]) {
    assert.throws(() => stack.assertDisposableName(bad), bad);
  }
});

check("só aceita porta base 57000+ (nunca 54xxx do desenvolvimento nem 56322)", () => {
  stack.assertSafeBasePort(57320);
  for (const bad of [54320, 56320, 57321, 59995, 1.5, "57320"]) assert.throws(() => stack.assertSafeBasePort(bad), String(bad));
});

check("config derivada: project_id único, portas 573xx e nenhuma porta 5432x do desenvolvimento", () => {
  const toml = stack.buildDisposableConfig(repoConfig, "acc-disposable-clean", 57320);
  assert.match(toml, /^project_id = "acc-disposable-clean"$/m);
  assert.ok(!/axion-contract-intelligence/.test(toml));
  assert.ok(!/\b5432\d\b/.test(toml), "nenhuma porta do desenvolvimento");
  assert.match(toml, /\[api\][\s\S]*?port = 57321/);
  assert.match(toml, /\[db\][\s\S]*?\nport = 57322/);
  assert.match(toml, /shadow_port = 57320/);
});

check("serviços pesados desligados na config derivada (studio, analytics, realtime, edge runtime, e-mail local)", () => {
  const toml = stack.buildDisposableConfig(repoConfig, "acc-disposable-clean", 57320);
  for (const section of ["studio", "analytics", "realtime", "edge_runtime", "local_smtp"]) {
    assert.match(toml, new RegExp(`\\[${section}\\]\\s*(?:#[^\\n]*\\n\\s*)*enabled = false`), section);
  }
});

check("bootstrap de privilégios: só ALTER DEFAULT PRIVILEGES para postgres/public, idempotente, sem DROP/DELETE", () => {
  const statements = bootstrap.split("\n").filter((line) => line.trim() && !line.trim().startsWith("--"));
  assert.equal(statements.length, 3);
  for (const line of statements) assert.match(line, /^alter default privileges for role postgres in schema public grant all on (tables|sequences|functions) to anon, authenticated, service_role;$/);
  assert.ok(!/drop |delete |truncate /i.test(bootstrap));
});

check("o iniciador nunca vincula/envia ao remoto e recusa diretório vinculado", () => {
  const code = starter.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!/["' ](link|db push|db remote|--linked|--db-url)["' ]/.test(code), "sem link/push/remote");
  assert.match(starter, /project-ref/);
  assert.match(starter, /assertDisposableName\(name\)/);
  assert.match(starter, /BOOTSTRAP_MIGRATION_FILE/);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
