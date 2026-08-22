// Testes dos marcadores "LIVE STEP N/7" do harness live
// (scripts/test-anthropic-commercial-director.mjs) — usando o módulo
// injetável scripts/lib/run-anthropic-live-test.mjs, com dependências
// totalmente mockadas (nenhuma chamada de rede, nenhum Supabase real).
//
// Objetivo: permitir diagnosticar, numa execução real futura, entre
// quais dois marcadores uma chamada travou (Context Builder/Supabase,
// Anthropic/rede, validação de schema, ou impressão do resultado) — ver
// docs/ai/anthropic-provider.md, seção "Diagnóstico de bloqueio".
//
// Uso:
//   node scripts/test-anthropic-live-steps.mjs

import { runAnthropicCommercialDirectorLiveTest } from "./lib/run-anthropic-live-test.mjs";

let passed = 0;
let failed = 0;

async function checkAsync(name, fn) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

async function assertRejects(promise, label) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(label ?? "esperado rejeição, mas resolveu");
}

function makeLogCapture() {
  const lines = [];
  return { lines, log: (...args) => lines.push(args.join(" ")) };
}

const IDENTITY = {
  expertId: "commercial-director",
  expertName: "Diretor Comercial IA",
  expertVersion: "v1",
  instructions: "instruções de teste",
  outputSchema: { type: "object" },
};

console.log("");
console.log("======================================");
console.log("LIVE STEPS (marcadores) — TESTES (mockado, sem rede)");
console.log("======================================");
console.log("");

await checkAsync("caminho de sucesso imprime os 7 marcadores, em ordem, nunca fora de ordem", async () => {
  const { lines, log } = makeLogCapture();

  const result = await runAnthropicCommercialDirectorLiveTest({
    buildEventContext: async () => ({ event: { id: "evt-1", title: "Evento de teste" } }),
    resolveProvider: () => ({
      id: "anthropic",
      answerQuery: async () => ({
        providerId: "anthropic",
        model: "claude-test-model",
        output: { ok: true },
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    }),
    validateResponse: (output) => output,
    identity: IDENTITY,
    question: "pergunta de teste",
    log,
  });

  const stepLines = lines.filter((l) => l.startsWith("LIVE STEP"));
  // STEP 3/7 e STEP 6/7 imprimem duas vezes cada (antes/depois de
  // resolver o provider; antes/depois de validar) — 9 linhas no total.
  assert(stepLines.length === 9, `esperado 9 linhas de step, obtido ${stepLines.length}`);
  assert(stepLines[0].startsWith("LIVE STEP 1/7"));
  assert(stepLines[1].startsWith("LIVE STEP 2/7"));
  assert(stepLines[2].startsWith("LIVE STEP 3/7"));
  assert(stepLines[3].startsWith("LIVE STEP 3/7"));
  assert(stepLines[4].startsWith("LIVE STEP 4/7"));
  assert(stepLines[5].startsWith("LIVE STEP 5/7"));
  assert(stepLines[6].startsWith("LIVE STEP 6/7"));
  assert(stepLines[7].startsWith("LIVE STEP 6/7"));
  assert(stepLines[8].startsWith("LIVE STEP 7/7"));

  assert(result.audit.providerId === "anthropic");
  assert(result.audit.stopReason === "tool_use");
});

await checkAsync("falha no Context Builder para entre STEP 1 e STEP 2 (nunca chega a STEP 3+)", async () => {
  const { lines, log } = makeLogCapture();

  await assertRejects(
    runAnthropicCommercialDirectorLiveTest({
      buildEventContext: async () => {
        throw new Error("Supabase indisponível (simulado)");
      },
      resolveProvider: () => {
        throw new Error("não deveria chegar aqui");
      },
      validateResponse: (output) => output,
      identity: IDENTITY,
      question: "pergunta de teste",
      log,
    }),
    "deveria propagar o erro do Context Builder"
  );

  const stepLines = lines.filter((l) => l.startsWith("LIVE STEP"));
  assert(stepLines.length === 1, `deveria ter parado logo após STEP 1/7, obtido ${stepLines.length} linha(s)`);
  assert(stepLines[0].startsWith("LIVE STEP 1/7"));
});

await checkAsync("falha na chamada Anthropic para entre STEP 4 e STEP 5 (contexto e provider já resolvidos)", async () => {
  const { lines, log } = makeLogCapture();

  await assertRejects(
    runAnthropicCommercialDirectorLiveTest({
      buildEventContext: async () => ({ event: { id: "evt-1" } }),
      resolveProvider: () => ({
        id: "anthropic",
        answerQuery: async () => {
          throw new Error("Timeout de aplicação após 60000ms aguardando a API Anthropic. (simulado)");
        },
      }),
      validateResponse: (output) => output,
      identity: IDENTITY,
      question: "pergunta de teste",
      log,
    }),
    "deveria propagar o erro da chamada Anthropic"
  );

  const stepLines = lines.filter((l) => l.startsWith("LIVE STEP"));
  // STEP1, STEP2, STEP3(start), STEP3(resolvido), STEP4 = 5 linhas antes do await falhar.
  assert(stepLines.length === 5, `deveria ter parado logo após STEP 4/7 (context+provider resolvidos, request iniciada), obtido ${stepLines.length}`);
  assert(stepLines[4].startsWith("LIVE STEP 4/7"), "última linha deveria ser STEP 4/7 — diagnóstico: bloqueio está entre Anthropic/rede");
});

await checkAsync("falha na validação do schema para entre STEP 5 e STEP 6 (resposta chegou, mas é inválida)", async () => {
  const { lines, log } = makeLogCapture();

  await assertRejects(
    runAnthropicCommercialDirectorLiveTest({
      buildEventContext: async () => ({ event: { id: "evt-1" } }),
      resolveProvider: () => ({
        id: "anthropic",
        answerQuery: async () => ({
          providerId: "anthropic",
          model: "claude-test-model",
          output: { invalid: true },
          stopReason: "tool_use",
          usage: null,
        }),
      }),
      validateResponse: () => {
        throw new Error("Campo obrigatório ausente (simulado)");
      },
      identity: IDENTITY,
      question: "pergunta de teste",
      log,
    }),
    "deveria propagar o erro de validação"
  );

  const stepLines = lines.filter((l) => l.startsWith("LIVE STEP"));
  // STEP1, STEP2, STEP3(start), STEP3(resolvido), STEP4, STEP5, STEP6(start) = 7 linhas antes de validateResponse falhar.
  assert(stepLines.length === 7, `deveria ter parado logo após "validating structured response" (STEP 6/7), obtido ${stepLines.length}`);
  assert(stepLines[6].startsWith("LIVE STEP 6/7"), "última linha deveria ser STEP 6/7 (validando) — diagnóstico: bloqueio está na validação de schema");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
