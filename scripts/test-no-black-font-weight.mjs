// Padronização de fontes: nenhum peso Black/900 (nem extrabold/800) em e-mails, telas do ACC e telas
// do PWA/SSMA. Destaques usam negrito (700); o restante, peso regular. Varredura estática do código-fonte.
//
// Uso: node scripts/test-no-black-font-weight.mjs

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["apps/web/app", "apps/web/components", "apps/web/lib", "packages"];
const EXT = /\.(ts|tsx|css)$/;
const SKIP = /node_modules|\.next|\.test\.|[\\/]dist[\\/]/;
const FORBIDDEN = [
  [/\bfont-(black|extrabold)\b/, "classe Tailwind font-black/font-extrabold"],
  [/font-\[(800|900)\]/, "font-[800]/[900]"],
  [/font-weight:\s*(800|900)\b/, "font-weight 800/900 inline"],
  [/fontWeight:\s*["']?(800|900)\b/, "fontWeight 800/900"],
  [/Arial Black/, "família Arial Black"],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP.test(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXT.test(name)) yield full;
  }
}

let checked = 0;
const offenders = [];
for (const base of SCAN) {
  const dir = path.join(root, base);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const file of walk(dir)) {
    checked += 1;
    const text = readFileSync(file, "utf8");
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(text)) offenders.push(`${path.relative(root, file)} — ${label}`);
    }
  }
}

console.log(`Arquivos varridos: ${checked}`);
assert.ok(checked > 200, "varredura deveria cobrir o código-fonte do app");
assert.deepEqual(offenders, [], `peso black/900 encontrado:\n${offenders.join("\n")}`);
console.log("OK   nenhum peso Black/900 (nem extrabold/800) nem Arial Black em e-mails, telas do ACC e do PWA/SSMA");
console.log("RESULTADO: 1 passaram, 0 falharam");
