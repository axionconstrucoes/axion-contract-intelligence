// Guarda do incidente de producao de 2026-09-11: a consulta juridica
// documental atingiu o antigo timeout de 60 s antes de o Anthropic
// devolver a resposta estruturada. Este teste nao usa rede nem le .env.
//
// Uso:
//   node scripts/test-legal-query-timeout.mjs

import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(nodePath.join(repoRoot, relativePath), "utf8");

const configSource = readSource("apps/web/lib/ai/providers/anthropic-config.ts");
const providerSource = readSource("apps/web/lib/ai/providers/anthropic-provider.ts");
const legalPageSource = readSource("apps/web/app/[projectId]/juridico/page.tsx");

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
    return;
  }
  console.log(`FAIL ${name}`);
  failed += 1;
}

function numericConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`));
  return match ? Number(match[1].replaceAll("_", "")) : null;
}

const providerTimeoutMs = numericConstant(configSource, "DEFAULT_TIMEOUT_MS");
const routeDurationSeconds = numericConstant(legalPageSource, "maxDuration");

console.log("");
console.log("======================================");
console.log("CONSULTA JURIDICA — TIMEOUT");
console.log("======================================");
console.log("");

check("timeout default do Anthropic e 180 segundos", providerTimeoutMs === 180_000);
check("pagina juridica permite ate 300 segundos", routeDurationSeconds === 300);
check(
  "limite da rota permanece maior que o timeout do provider",
  routeDurationSeconds !== null && providerTimeoutMs !== null && routeDurationSeconds * 1000 > providerTimeoutMs
);
check(
  "ANTHROPIC_TIMEOUT_MS continua podendo sobrescrever o default com validacao positiva",
  /readPositiveNumber\(process\.env\.ANTHROPIC_TIMEOUT_MS,\s*"ANTHROPIC_TIMEOUT_MS",\s*DEFAULT_TIMEOUT_MS\)/.test(configSource)
);
check(
  "provider preserva timeout rigido e aborta a chamada",
  /raceWithHardTimeout\(/.test(providerSource) && /controller\.abort\(\)/.test(providerSource)
);

console.log("");
console.log(`${passed} passaram, ${failed} falharam`);

if (failed > 0) process.exitCode = 1;
