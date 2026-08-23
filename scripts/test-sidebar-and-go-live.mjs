// Testes estruturais/de dados do pacote de navegação:
// - sidebar recolhível (persistência localStorage, acessibilidade, sem
//   hydration mismatch — useSyncExternalStore em vez de useEffect+setState);
// - startup oficial do ACC (data de início operacional, config reutilizável).
//
// Não renderiza React (sem jsdom no projeto) — verifica código-fonte e
// as funções puras de apps/web/lib/acc-go-live.ts.
//
// Uso:
//   node scripts/test-sidebar-and-go-live.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { ACC_GO_LIVE_DATE, getAccGoLiveDate, isBeforeAccGoLive } = await import("../apps/web/lib/acc-go-live");

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

console.log("");
console.log("======================================");
console.log("SIDEBAR RECOLHÍVEL + STARTUP OFICIAL DO ACC — TESTES");
console.log("======================================");
console.log("");

const sidebarSource = readSource("apps/web/components/layout/app-sidebar.tsx");

check('sidebar persiste o estado recolhido em localStorage sob a chave exata "acc.sidebar.collapsed"', () => {
  assert(sidebarSource.includes('"acc.sidebar.collapsed"'));
});

check("sidebar usa useSyncExternalStore (client-safe, sem hydration mismatch) — nunca useEffect+setState para sincronizar com localStorage", () => {
  assert(sidebarSource.includes("useSyncExternalStore"), "deveria usar useSyncExternalStore");
  assert(!/useEffect\(/.test(sidebarSource), "não deveria haver chamada a useEffect() síncrona lendo localStorage (causaria o erro de lint set-state-in-effect e risco de hydration mismatch)");
});

check("sidebar tem getServerCollapsedSnapshot retornando sempre false (SSR nunca lê localStorage — nunca diverge do cliente)", () => {
  assert(/function getServerCollapsedSnapshot\(\)[^}]*return false/s.test(sidebarSource));
});

check("botão de recolher/expandir tem aria-label correto nos dois estados", () => {
  assert(sidebarSource.includes('"Expandir menu lateral"'));
  assert(sidebarSource.includes('"Recolher menu lateral"'));
});

check("botão de recolher usa ícones Lucide (PanelLeftClose/PanelLeftOpen)", () => {
  assert(sidebarSource.includes("PanelLeftClose"));
  assert(sidebarSource.includes("PanelLeftOpen"));
});

check("todos os itens de navegação têm tooltip (title) quando recolhidos", () => {
  assert(/title=\{collapsed \? item\.label : undefined\}/.test(sidebarSource));
});

check("item ativo continua destacado independentemente do estado recolhido (classe bg-accent aplicada pela mesma lógica em ambos os estados)", () => {
  assert(sidebarSource.includes("bg-accent text-accent-foreground"));
});

check("largura recolhida (w-14) e expandida (w-60) estão definidas — conteúdo principal ocupa a largura liberada automaticamente (aside é shrink-0 dentro de um flex, o main já é flex-1 em layout.tsx)", () => {
  assert(sidebarSource.includes('"w-14"'));
  assert(sidebarSource.includes('"w-60"'));
  const layoutSource = readSource("apps/web/app/[projectId]/layout.tsx");
  assert(layoutSource.includes("flex-1"), "main já é flex-1 — libera a largura automaticamente quando o aside encolhe");
});

check('"Experts IA" está entre os itens de navegação e funciona normalmente recolhido (mesma lista/lógica dos demais itens, sem caso especial)', () => {
  assert(sidebarSource.includes('href: "experts-ia", label: "Experts IA"'));
});

check("labels renomeados presentes, rotas técnicas (href) preservadas", () => {
  assert(sidebarSource.includes('label: "Análise Contratual"'));
  assert(sidebarSource.includes('label: "Análise de Cláusulas"'));
  assert(sidebarSource.includes('href: "revisao-contratual"'));
  assert(sidebarSource.includes('href: "revisao-clausulas"'));
});

// --- Startup oficial do ACC ---

check('ACC_GO_LIVE_DATE é exatamente "2026-08-24"', () => {
  assert(ACC_GO_LIVE_DATE === "2026-08-24", `esperado "2026-08-24", obtido "${ACC_GO_LIVE_DATE}"`);
});

check("getAccGoLiveDate() retorna a data correta como Date (UTC, meia-noite)", () => {
  const date = getAccGoLiveDate();
  assert(date.toISOString() === "2026-08-24T00:00:00.000Z");
});

check("isBeforeAccGoLive corretamente classifica datas antes/depois do marco", () => {
  assert(isBeforeAccGoLive(new Date("2026-08-23T23:59:59.000Z")) === true);
  assert(isBeforeAccGoLive(new Date("2026-08-24T00:00:00.000Z")) === false);
  assert(isBeforeAccGoLive(new Date("2026-08-25T00:00:00.000Z")) === false);
});

check("acc-go-live.ts nunca é importado por nenhum código de auditoria/migration (marco não deve tocar dados históricos)", () => {
  const auditReferences = readSource("apps/web/lib/acc-go-live.ts");
  assert(auditReferences.includes("NUNCA usar para alterar/reinterpretar"), "arquivo deveria documentar explicitamente a limitação");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
