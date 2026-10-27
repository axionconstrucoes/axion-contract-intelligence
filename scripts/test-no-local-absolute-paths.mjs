// Independência do computador: o código de produção, os workflows e as ferramentas de scripts não
// podem depender de caminhos absolutos deste notebook (C:\VIBE, C:\Users, Desktop, Downloads, AppData)
// nem de arquivos de credencial/ambiente locais não versionados. Varredura estática.
//
// Exceções documentadas (ferramentas de desenvolvimento Windows, com variável de ambiente para trocar):
//   scripts/setup-new-pc.ps1 (parâmetro -TargetRoot) e o CHROME_PATH padrão dos scripts de captura.
//
// Uso: node scripts/test-no-local-absolute-paths.mjs

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["apps/web/app", "apps/web/lib", "apps/web/components", "apps/web/proxy.ts", "packages", ".github", "scripts"];
const EXT = /\.(ts|tsx|mjs|js|yml|yaml|json|sql|ps1|py)$/;
const SKIP = /node_modules|[\\/]\.next[\\/]|[\\/]dist[\\/]/;
// Testes podem citar caminhos como DADOS de teste (ex.: validar que uma letra de unidade é recusada).
const ALLOWED_FILES = [/^scripts[\\/]test-/, /^scripts[\\/]setup-new-pc\.ps1$/, /^scripts[\\/]lib[\\/]cdp-chrome\.mjs$/];
const FORBIDDEN = [
  [/[A-Za-z]:[\\/]+(VIBE|Users)[\\/]/i, "caminho absoluto C:\\VIBE ou C:\\Users"],
  [/[\\/]AppData[\\/]/i, "AppData"],
  [/[\\/](Desktop|Downloads)[\\/]/i, "Desktop/Downloads"],
];

function* walk(target) {
  const st = statSync(target);
  if (st.isFile()) {
    yield target;
    return;
  }
  for (const name of readdirSync(target)) {
    const full = path.join(target, name);
    if (SKIP.test(full)) continue;
    yield* walk(full);
  }
}

let checked = 0;
const offenders = [];
for (const entry of SCAN) {
  const target = path.join(root, entry);
  try {
    statSync(target);
  } catch {
    continue;
  }
  for (const file of walk(target)) {
    if (!EXT.test(file)) continue;
    const rel = path.relative(root, file);
    if (ALLOWED_FILES.some((pattern) => pattern.test(rel))) continue;
    checked += 1;
    const text = readFileSync(file, "utf8");
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(text)) offenders.push(`${rel} — ${label}`);
    }
  }
}

console.log(`Arquivos varridos: ${checked}`);
assert.ok(checked > 200, "a varredura deveria cobrir o código-fonte");
assert.deepEqual(offenders, [], `dependência de caminho local encontrada:\n${offenders.join("\n")}`);
console.log("OK   nenhum caminho absoluto deste computador em produção, workflows e scripts (exceto ferramentas documentadas)");

// Workflows de produção usam só segredos/variáveis do GitHub — nunca arquivos locais.
const workflows = readdirSync(path.join(root, ".github", "workflows")).filter((name) => /\.ya?ml$/.test(name));
for (const name of workflows) {
  const text = readFileSync(path.join(root, ".github", "workflows", name), "utf8");
  assert.ok(!/\.env\.local|client_secret_/.test(text), `${name} não pode depender de arquivo de ambiente/credencial local`);
}
console.log(`OK   ${workflows.length} workflows sem dependência de .env.local ou client_secret local`);

// Credenciais locais nunca entram no Git (regra versionada em .gitignore, não só em .git/info/exclude).
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
for (const pattern of [".env", "client_secret_*.json"]) {
  assert.ok(gitignore.split(/\r?\n/).some((line) => line.trim() === pattern || line.trim() === `${pattern}*`), `.gitignore deve ignorar ${pattern}`);
}
console.log("OK   .gitignore versionado ignora .env* e client_secret_*.json");
console.log("RESULTADO: 3 passaram, 0 falharam");
