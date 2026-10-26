// ÚNICA porta de entrada para testes que podem falar com um provedor de IA REAL (pago).
// NÃO faz parte de test, test:scripts, test:email, test:sql nem test:ssma, e não é executada por
// agentes/CI de rotina. Só roda com habilitação EXPLÍCITA:
//
//   ACC_ALLOW_LIVE_AI_TESTS=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npm run test:live-ai
//
// Sem a habilitação (ou sem chave) este script NÃO faz nenhuma chamada e termina com exit 0,
// explicando o motivo. O harness real continua em scripts/test-anthropic-commercial-director.mjs
// (modo --live, somente leitura), que também exige a mesma habilitação.

import { spawnSync } from "node:child_process";

export function liveAiDecision(env = process.env) {
  if (env.ACC_ALLOW_LIVE_AI_TESTS !== "1") {
    return { run: false, reason: "ACC_ALLOW_LIVE_AI_TESTS=1 não definido — testes de IA real NÃO executados (nenhuma chamada)." };
  }
  if (!env.ANTHROPIC_API_KEY || !env.ANTHROPIC_MODEL) {
    return { run: false, reason: "Habilitado, mas ANTHROPIC_API_KEY/ANTHROPIC_MODEL ausentes — nenhuma chamada." };
  }
  return { run: true, reason: "habilitado explicitamente" };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("test-live-ai.mjs")) {
  const decision = liveAiDecision();
  console.log(`[test:live-ai] ${decision.reason}`);
  if (!decision.run) process.exit(0);
  const result = spawnSync(process.execPath, ["scripts/test-anthropic-commercial-director.mjs", "--live"], { stdio: "inherit", env: process.env });
  process.exit(result.status ?? 1);
}
