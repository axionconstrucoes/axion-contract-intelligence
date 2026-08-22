// Guarda de regressão para o erro real observado no navegador:
//
//   Runtime Error — Server
//   A "use server" file can only export async functions, found object.
//
// Causa: apps/web/lib/ai/expert-query-action.ts tinha "use server" no
// topo E exportava um objeto (`initialAskCommercialDirectorState`),
// importado por um Client Component (expert-query-panel.tsx) — Next.js
// só permite que um módulo "use server" exporte funções async (Server
// Actions). O estado inicial/tipos foram movidos para
// apps/web/lib/ai/expert-query-state.ts (sem "use server").
//
// Este teste lê o código-fonte (nunca executa o Next.js) e falha se
// algum dos módulos "use server" do fluxo dos Experts voltar a exportar
// qualquer coisa que não seja uma função async — protege
// especificamente contra a reintrodução deste bug.
//
// Uso:
//   node scripts/test-use-server-exports.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Extrai todo top-level `export ...` de um arquivo (linha a linha, uma
 * heurística simples e suficiente para código TypeScript formatado
 * neste repositório — nunca um parser TS completo) e retorna quais
 * deles NÃO são "export async function" nem um export puramente de
 * tipo (export type/interface — apagados em tempo de compilação, logo
 * nunca viram um export runtime inválido para o Next.js).
 */
function findInvalidUseServerExports(source) {
  assert(source.trimStart().startsWith('"use server"'), 'arquivo deveria começar com "use server" — teste teria que ser ajustado se isso mudar');

  const lines = source.split("\n");
  const invalid = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("export ")) continue;

    const isAsyncFunction = /^export\s+async\s+function\s+/.test(trimmed);
    const isTypeOnly = /^export\s+(type|interface)\s+/.test(trimmed);
    // "export { X } from ..." / "export type { X }" também são inválidos
    // como VALOR (só type-only é seguro).
    const isTypeOnlyReExport = /^export\s+type\s*\{/.test(trimmed);

    if (isAsyncFunction || isTypeOnly || isTypeOnlyReExport) continue;

    invalid.push(trimmed);
  }

  return invalid;
}

console.log("");
console.log("======================================");
console.log('"USE SERVER" EXPORT SHAPE — TESTES (fluxo dos Experts)');
console.log("======================================");
console.log("");

check(
  'expert-query-action.ts (Diretor Comercial IA) exporta SOMENTE funções async — nunca objeto/const/enum/schema/metadata (o bug real reportado)',
  () => {
    const source = readSource("apps/web/lib/ai/expert-query-action.ts");
    const invalid = findInvalidUseServerExports(source);
    assert(invalid.length === 0, `exports inválidos encontrados: ${JSON.stringify(invalid)}`);
    assert(source.includes("export async function askCommercialDirectorAction"), "askCommercialDirectorAction deveria continuar exportada");
    assert(!source.includes("initialAskCommercialDirectorState"), "estado inicial não deveria mais viver neste arquivo — ver expert-query-state.ts");
  }
);

check('esg-query-action.ts (Diretor de ESG IA) exporta SOMENTE funções async — mesma checagem preventiva', () => {
  const source = readSource("apps/web/lib/ai/esg-query-action.ts");
  const invalid = findInvalidUseServerExports(source);
  assert(invalid.length === 0, `exports inválidos encontrados: ${JSON.stringify(invalid)}`);
  assert(source.includes("export async function askEsgDirectorAction"), "askEsgDirectorAction deveria continuar exportada");
});

check("expert-query-state.ts (novo módulo) NÃO tem a diretiva \"use server\" no topo — é seguro exportar o objeto de estado inicial ali", () => {
  const source = readSource("apps/web/lib/ai/expert-query-state.ts");
  assert(
    !source.trimStart().startsWith('"use server"'),
    "este módulo deve permanecer server/client-neutro, sem a diretiva use server no topo do arquivo"
  );
  assert(source.includes("export const initialAskCommercialDirectorState"), "estado inicial deveria estar aqui");
  assert(source.includes("export type AskCommercialDirectorState"), "o tipo do estado deveria estar aqui");
});

check("expert-query-panel.tsx (Client Component) importa o estado inicial de expert-query-state.ts, nunca de expert-query-action.ts", () => {
  const source = readSource("apps/web/components/ai/expert-query-panel.tsx");
  assert(
    source.includes('from "@/lib/ai/expert-query-state"'),
    "painel deveria importar initialAskCommercialDirectorState/AskCommercialDirectorState de expert-query-state.ts"
  );
  assert(
    !/initialAskCommercialDirectorState.*from\s+"@\/lib\/ai\/expert-query-action"/s.test(source),
    "estado inicial não deveria mais ser importado do módulo use server"
  );
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
