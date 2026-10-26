// PROVA de que as suítes de rotina não chamam provedores de IA reais:
//   1. nenhum comando de rotina referencia testes "live" e todos carregam o guarda block-live-ai;
//   2. o guarda remove chaves do ambiente e bloqueia fetch/https a hosts de provedores;
//   3. sem chave, o resolvedor devolve o provedor SIMULADO (fake);
//   4. o teste live só roda com habilitação explícita.
//
// Uso: node --import ./scripts/lib/block-live-ai.mjs scripts/test-no-live-ai-in-routine.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

const pkg = JSON.parse(read("package.json"));
const webPkg = JSON.parse(read("apps/web/package.json"));
const ROUTINE = ["test:scripts", "test:email", "test:sql", "test:ssma"];
const GUARD = "--import ./scripts/lib/block-live-ai.mjs";

console.log("\n======================================");
console.log("TESTES DE ROTINA NÃO CHAMAM PROVEDORES REAIS");
console.log("======================================\n");

await check("comandos de rotina (test, test:scripts, test:email, test:sql, test:ssma) não referenciam testes live", () => {
  const all = [pkg.scripts.test, webPkg.scripts.test, ...ROUTINE.map((name) => pkg.scripts[name])].join(" ");
  assert.ok(!/test-live-ai|test-anthropic-commercial-director|analyze-event|--live|ACC_ALLOW_LIVE_AI_TESTS/.test(all));
  assert.ok(pkg.scripts["test:live-ai"], "o teste live existe separado");
  assert.equal(pkg.scripts["test:live-ai"], "node scripts/test-live-ai.mjs");
});

await check("todo `node` das suítes de rotina carrega o guarda block-live-ai (inclusive apps/web `npm test`)", () => {
  for (const name of ROUTINE) {
    for (const part of pkg.scripts[name].split("&&").map((s) => s.trim())) {
      assert.ok(part.startsWith(`node ${GUARD} scripts/`), `${name}: "${part}" sem o guarda`);
    }
  }
  assert.match(webPkg.scripts.test, /--import \.\.\/\.\.\/scripts\/lib\/block-live-ai\.mjs --test/);
});

await check("nenhum script de rotina contém chamada de rede explícita a provedores de IA (fetch/host/--live)", () => {
  const files = ROUTINE.flatMap((name) => Array.from(pkg.scripts[name].matchAll(/scripts\/(test-[\w.-]+\.mjs)/g)).map((m) => `scripts/${m[1]}`));
  assert.ok(files.length > 30, `lista de arquivos obtida (${files.length})`);
  for (const file of new Set(files)) {
    const code = read(file);
    assert.ok(!/fetch\(\s*["'`]https?:\/\/api\.(anthropic|openai)\.com/.test(code), `${file}: fetch direto a provedor`);
    assert.ok(!/process\.argv\.includes\(["']--live["']\)/.test(code), `${file}: modo live em suíte de rotina`);
  }
});

await check("o guarda remove chaves de IA do ambiente e bloqueia fetch para hosts de provedores (sem tocar a rede)", async () => {
  const before = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  await import(`../scripts/lib/block-live-ai.mjs?again=${Date.now()}`);
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "chave removida");
  for (const url of ["https://api.anthropic.com/v1/messages", "https://api.openai.com/v1/chat/completions", "https://generativelanguage.googleapis.com/v1/models"]) {
    await assert.rejects(fetch(url, { method: "POST" }), (error) => error.code === "ACC_LIVE_AI_BLOCKED", url);
  }
  const https = (await import("node:https")).default;
  assert.throws(() => https.request({ hostname: "api.anthropic.com", path: "/" }), (error) => error.code === "ACC_LIVE_AI_BLOCKED");
  if (before.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = before.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

await check("sem chave/variáveis, o resolvedor devolve o provedor SIMULADO para os cinco Experts", async () => {
  const { resolveAiProviderForExpert } = await import("../apps/web/lib/ai/providers/resolve-provider-for-expert.ts");
  for (const expert of ["commercial-director", "esg-director", "legal-consultant", "planning-director", "ceo"]) {
    assert.equal(resolveAiProviderForExpert(expert).id, "fake", expert);
  }
});

await check("test:live-ai só executa com ACC_ALLOW_LIVE_AI_TESTS=1 E chave+modelo; o harness --live também exige a habilitação", async () => {
  const { liveAiDecision } = await import("../scripts/test-live-ai.mjs");
  assert.equal(liveAiDecision({}).run, false);
  assert.equal(liveAiDecision({ ACC_ALLOW_LIVE_AI_TESTS: "1" }).run, false, "sem chave");
  assert.equal(liveAiDecision({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" }).run, false, "sem habilitação");
  assert.equal(liveAiDecision({ ACC_ALLOW_LIVE_AI_TESTS: "1", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" }).run, true);
  assert.match(read("scripts/test-anthropic-commercial-director.mjs"), /isLive && process\.env\.ACC_ALLOW_LIVE_AI_TESTS !== "1"/);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
