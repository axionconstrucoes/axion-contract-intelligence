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

// Todos os módulos "use server" do app (varredura registrada
// manualmente — ver relatório da tarefa "MODO ACELERADO ACC" para a
// data desta varredura). Adicionar aqui qualquer novo Server Action
// futuro para manter a proteção global.
const ALL_USE_SERVER_FILES = [
  "apps/web/app/[projectId]/acoes/actions.ts",
  "apps/web/app/[projectId]/action-requests/actions.ts",
  "apps/web/app/[projectId]/esg/actions.ts",
  "apps/web/app/[projectId]/ledger/[eventId]/actions.ts",
  "apps/web/app/[projectId]/ledger/[eventId]/assess-schedule-delay-actions.ts",
  "apps/web/app/[projectId]/ledger/[eventId]/event-notes-actions.ts",
  "apps/web/app/[projectId]/ledger/[eventId]/run-multi-expert-curation-actions.ts",
  "apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts",
  "apps/web/app/[projectId]/revisao-clausulas/actions.ts",
  "apps/web/app/[projectId]/revisao-contratual/actions.ts",
  "apps/web/app/[projectId]/timeline/timeline-export-actions.ts",
  "apps/web/lib/ai/esg-query-action.ts",
  "apps/web/lib/ai/expert-query-action.ts",
  "apps/web/lib/auth-actions.ts",
];

console.log("");
console.log("======================================");
console.log('"USE SERVER" EXPORT SHAPE — TESTES');
console.log("======================================");
console.log("");

check(`todos os ${ALL_USE_SERVER_FILES.length} módulos "use server" do app exportam SOMENTE funções async (varredura global)`, () => {
  const offenders = [];
  for (const file of ALL_USE_SERVER_FILES) {
    const source = readSource(file);
    const invalid = findInvalidUseServerExports(source);
    if (invalid.length > 0) offenders.push(`${file}: ${JSON.stringify(invalid)}`);
  }
  assert(offenders.length === 0, `arquivo(s) com export inválido: ${offenders.join(" | ")}`);
});

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

check("acoes/actions-state.ts concentra os 9 estados iniciais de Ações e Escalonamentos, fora do módulo use server", () => {
  const source = readSource("apps/web/app/[projectId]/acoes/actions-state.ts");
  assert(!source.trimStart().startsWith('"use server"'));
  for (const name of [
    "initialCreateSlaActionState",
    "initialAssumeSlaActionState",
    "initialStartSlaActionState",
    "initialCompleteSlaActionState",
    "initialReassignSlaActionState",
    "initialConfigureSlaMatrixState",
    "initialConfigureSlaResponsiblesState",
    "initialProcessSlaEscalationsState",
    "initialConfigureSlaProjectSettingsState",
  ]) {
    assert(source.includes(`export const ${name}`), `${name} deveria estar em actions-state.ts`);
  }
  const actionsSource = readSource("apps/web/app/[projectId]/acoes/actions.ts");
  assert(!actionsSource.includes("export const initial"), "actions.ts não deveria mais exportar nenhum estado inicial");
});

check("esg/actions-state.ts, ledger/[eventId]/actions-state.ts, event-notes-actions-state.ts, send-alert-actions-state.ts, assess-schedule-delay-actions-state.ts e run-multi-expert-curation-actions-state.ts existem e não têm use server", () => {
  for (const file of [
    "apps/web/app/[projectId]/esg/actions-state.ts",
    "apps/web/app/[projectId]/ledger/[eventId]/actions-state.ts",
    "apps/web/app/[projectId]/ledger/[eventId]/assess-schedule-delay-actions-state.ts",
    "apps/web/app/[projectId]/ledger/[eventId]/event-notes-actions-state.ts",
    "apps/web/app/[projectId]/ledger/[eventId]/run-multi-expert-curation-actions-state.ts",
    "apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions-state.ts",
  ]) {
    const source = readSource(file);
    assert(!source.trimStart().startsWith('"use server"'), `${file} não deveria ter a diretiva use server`);
    assert(source.includes("export const initial"), `${file} deveria exportar ao menos um estado inicial`);
  }
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
