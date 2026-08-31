// Marco oficial de startup/go-live do ACC — atualizado nesta rodada
// para 07/09/2026, 09:00, America/Sao_Paulo (era 02/09/2026, 00:00
// UTC). Cobre especificamente:
//   - instante anterior ao startup;
//   - exatamente 09:00 (America/Sao_Paulo);
//   - instante posterior;
//   - conversão correta do horário de Brasília para UTC (sem offset
//     fixo manual, via Intl.DateTimeFormat);
//   - integração fim-a-fim com a etiqueta "SISTEMA EM TESTE"
//     (lib/test-mode.ts) nos mesmos três instantes, cruzado com a regra
//     fail-safe da variável de ambiente.
//
// Checagens estruturais/de dados — mesmo padrão já usado em
// scripts/test-sidebar-and-go-live.mjs e
// scripts/test-global-test-mode-banner.mjs — sem subir um servidor
// Next.js real.
//
// Uso:
//   node scripts/test-acc-startup-date.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { ACC_GO_LIVE_DATE, ACC_GO_LIVE_TIME, ACC_GO_LIVE_TIMEZONE, getAccGoLiveDate, isBeforeAccGoLive, hasAccGoLiveOccurred } =
  await import("../apps/web/lib/acc-go-live");
const { isTestModeBannerVisible } = await import("../apps/web/lib/test-mode");

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
console.log("MARCO OFICIAL DE STARTUP/GO-LIVE — 07/09/2026 09:00 America/Sao_Paulo");
console.log("======================================");
console.log("");

// --- Constantes ---

check("constantes exportadas descrevem exatamente 2026-09-07, 09:00:00, America/Sao_Paulo", () => {
  assert(ACC_GO_LIVE_DATE === "2026-09-07");
  assert(ACC_GO_LIVE_TIME === "09:00:00");
  assert(ACC_GO_LIVE_TIMEZONE === "America/Sao_Paulo");
});

// --- Conversão correta do horário de Brasília (seção 3 da tarefa) ---

check("getAccGoLiveDate() converte 09:00 America/Sao_Paulo para 12:00 UTC (offset -03:00, sem DST em vigor desde 2019) — via Intl.DateTimeFormat, nunca offset fixo manual", () => {
  const date = getAccGoLiveDate();
  assert(date instanceof Date && !Number.isNaN(date.getTime()), "getAccGoLiveDate() deveria retornar um Date válido");
  assert(date.toISOString() === "2026-09-07T12:00:00.000Z", `esperado 2026-09-07T12:00:00.000Z, obtido ${date.toISOString()}`);
});

check("acc-go-live.ts nunca depende do timezone local do processo — usa Intl.DateTimeFormat com timeZone explícito, nunca offset hardcoded fora de comentários/prosa", () => {
  const source = readSource("apps/web/lib/acc-go-live.ts");
  assert(source.includes('Intl.DateTimeFormat'), "deveria usar Intl.DateTimeFormat");
  assert(source.includes('timeZone'), "deveria passar timeZone explicitamente");
  // Remove comentários de linha antes de checar — a prosa do arquivo cita
  // "-03:00" só como exemplo do que NUNCA fazer, o que não deveria contar
  // como o próprio código hardcodando o offset.
  const withoutLineComments = source.replace(/\/\/.*$/gm, "");
  assert(!/-0?3:00/.test(withoutLineComments), "não deveria hardcodar o offset -03:00 no código (fora de comentários)");
});

// --- Os três instantes do marco (seção 8 da tarefa) ---

const oneSecondBefore = new Date("2026-09-07T11:59:59.000Z"); // 08:59:59 America/Sao_Paulo
const exactlyGoLive = new Date("2026-09-07T12:00:00.000Z"); // 09:00:00 America/Sao_Paulo
const oneSecondAfter = new Date("2026-09-07T12:00:01.000Z"); // 09:00:01 America/Sao_Paulo

check("instante ANTERIOR ao startup (08:59:59 America/Sao_Paulo): isBeforeAccGoLive=true, hasAccGoLiveOccurred=false", () => {
  assert(isBeforeAccGoLive(oneSecondBefore) === true);
  assert(hasAccGoLiveOccurred(oneSecondBefore) === false);
});

check("instante EXATO do startup (09:00:00 America/Sao_Paulo, inclusivo): isBeforeAccGoLive=false, hasAccGoLiveOccurred=true", () => {
  assert(isBeforeAccGoLive(exactlyGoLive) === false);
  assert(hasAccGoLiveOccurred(exactlyGoLive) === true);
});

check("instante POSTERIOR ao startup (09:00:01 America/Sao_Paulo): isBeforeAccGoLive=false, hasAccGoLiveOccurred=true", () => {
  assert(isBeforeAccGoLive(oneSecondAfter) === false);
  assert(hasAccGoLiveOccurred(oneSecondAfter) === true);
});

// --- Integração fim-a-fim com a etiqueta "SISTEMA EM TESTE" ---

check("banner: até 08:59:59 America/Sao_Paulo, o sistema permanece em teste (regra fail-safe de env var integralmente preservada)", () => {
  assert(isTestModeBannerVisible(undefined, oneSecondBefore) === true, "sem env var, antes do marco, deveria mostrar");
  assert(isTestModeBannerVisible("true", oneSecondBefore) === true, '"true", antes do marco, deveria mostrar');
  assert(isTestModeBannerVisible("false", oneSecondBefore) === false, '"false", antes do marco, deveria ocultar (override manual continua funcionando)');
});

check("banner: exatamente às 09:00 America/Sao_Paulo, a etiqueta já não é mais exibida — independente do valor da env var", () => {
  assert(isTestModeBannerVisible(undefined, exactlyGoLive) === false);
  assert(isTestModeBannerVisible("true", exactlyGoLive) === false);
  assert(isTestModeBannerVisible("qualquer-coisa", exactlyGoLive) === false);
});

check("banner: após 09:00 America/Sao_Paulo, a etiqueta permanece oculta de forma incondicional e permanente", () => {
  assert(isTestModeBannerVisible(undefined, oneSecondAfter) === false);
  assert(isTestModeBannerVisible("true", oneSecondAfter) === false);
  const oneYearLater = new Date("2027-09-07T12:00:01.000Z");
  assert(isTestModeBannerVisible("true", oneYearLater) === false, "muito tempo depois do marco, ainda deveria estar oculta");
});

// --- Nenhum dado histórico foi tocado (seção 4 da tarefa) ---

check("acc-go-live.ts documenta explicitamente que o marco nunca reinterpreta created_at/migrations/auditoria/documentos/eventos/e-mails históricos", () => {
  const source = readSource("apps/web/lib/acc-go-live.ts");
  assert(source.includes("NUNCA usar para alterar/reinterpretar"), "a limitação deveria continuar documentada explicitamente");
});

check("migration de acc_operational_start_date (campo por-projeto, distinto deste marco global) não foi alterada por esta tarefa", () => {
  const migrationSource = readSource("supabase/migrations/20260823090000_startup_historical_review.sql");
  assert(migrationSource.includes("2026-08-24"), "o default original do campo por-projeto deveria continuar intocado na migration já aplicada");
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
