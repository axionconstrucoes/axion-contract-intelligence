// Testes da resolução de provider POR EXPERT
// (apps/web/lib/ai/providers/resolve-provider-for-expert.ts) — a
// correção que impede que ativar um provider real para um Expert (ex.:
// Anthropic para o Diretor Comercial IA) desative outro Expert que deve
// continuar no fake provider (ex.: Diretor de ESG IA).
//
// NUNCA chama rede: quando um cenário resolve para "anthropic", só a
// CONSTRUÇÃO do client é exercitada (não dispara fetch); quando a
// rejeição é esperada por allowlist, ela acontece antes de qualquer
// chamada ao SDK.
//
// Uso:
//   node scripts/test-provider-per-expert.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveAiProviderForExpert, resolveAiProviderNameForExpert, EXPERT_PROVIDER_ENV_VAR } = await import(
  "../apps/web/lib/ai/providers/resolve-provider-for-expert"
);
const { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } = await import("../apps/web/lib/ai/query/json-schema");

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

async function assertRejects(promiseOrFn, messageSubstring, label) {
  try {
    if (typeof promiseOrFn === "function") {
      promiseOrFn();
    } else {
      await promiseOrFn;
    }
  } catch (error) {
    if (messageSubstring && !error.message.includes(messageSubstring)) {
      throw new Error(`${label ?? "rejeição"} — mensagem não contém "${messageSubstring}": ${error.message}`);
    }
    return error;
  }
  throw new Error(`${label ?? "esperado rejeição"}, mas resolveu`);
}

const ALL_PROVIDER_ENV_KEYS = [
  "AXION_AI_PROVIDER",
  "AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR",
  "AXION_AI_PROVIDER_ESG_DIRECTOR",
  "AXION_AI_PROVIDER_CEO",
  "AXION_AI_PROVIDER_LEGAL_CONSULTANT",
  "AXION_AI_PROVIDER_PLANNING_DIRECTOR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
];
const savedEnv = Object.fromEntries(ALL_PROVIDER_ENV_KEYS.map((k) => [k, process.env[k]]));
function clearEnv() {
  for (const k of ALL_PROVIDER_ENV_KEYS) delete process.env[k];
}
function restoreEnv() {
  for (const k of ALL_PROVIDER_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}
function setDummyAnthropicCreds() {
  process.env.ANTHROPIC_API_KEY = "sk-test-fake-key-not-real";
  process.env.ANTHROPIC_MODEL = "claude-test-model";
}

console.log("");
console.log("======================================");
console.log("PROVIDER POR EXPERT — TESTES");
console.log("======================================");
console.log("");

check("nomes de variável preparados para os cinco Experts oficiais", () => {
  assert(EXPERT_PROVIDER_ENV_VAR["commercial-director"] === "AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR");
  assert(EXPERT_PROVIDER_ENV_VAR["esg-director"] === "AXION_AI_PROVIDER_ESG_DIRECTOR");
  assert(EXPERT_PROVIDER_ENV_VAR.ceo === "AXION_AI_PROVIDER_CEO");
  assert(EXPERT_PROVIDER_ENV_VAR["legal-consultant"] === "AXION_AI_PROVIDER_LEGAL_CONSULTANT");
  assert(EXPERT_PROVIDER_ENV_VAR["planning-director"] === "AXION_AI_PROVIDER_PLANNING_DIRECTOR");
});

check("sem nenhuma configuração, ambos os Experts resolvem para fake (default)", () => {
  clearEnv();
  try {
    assert(resolveAiProviderForExpert("commercial-director").id === "fake");
    assert(resolveAiProviderForExpert("esg-director").id === "fake");
  } finally {
    clearEnv();
  }
});

check(
  "AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR=anthropic resolve Anthropic para commercial-director SEM afetar esg-director (continua fake)",
  () => {
    clearEnv();
    setDummyAnthropicCreds();
    process.env.AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR = "anthropic";
    try {
      const commercial = resolveAiProviderForExpert("commercial-director");
      const esg = resolveAiProviderForExpert("esg-director");
      assert(commercial.id === "anthropic", `commercial-director deveria resolver anthropic, obteve "${commercial.id}"`);
      assert(esg.id === "fake", `esg-director deveria continuar fake, obteve "${esg.id}" — regressão detectada`);
    } finally {
      clearEnv();
    }
  }
);

check("configuração específica (AXION_AI_PROVIDER_ESG_DIRECTOR=fake) prevalece sobre AXION_AI_PROVIDER=anthropic global", () => {
  clearEnv();
  setDummyAnthropicCreds();
  process.env.AXION_AI_PROVIDER = "anthropic";
  process.env.AXION_AI_PROVIDER_ESG_DIRECTOR = "fake";
  try {
    const esg = resolveAiProviderForExpert("esg-director");
    assert(esg.id === "fake", "configuração específica deveria prevalecer sobre o default global");
  } finally {
    clearEnv();
  }
});

check("ausência de configuração específica usa AXION_AI_PROVIDER como default de compatibilidade", () => {
  clearEnv();
  setDummyAnthropicCreds();
  process.env.AXION_AI_PROVIDER = "anthropic";
  try {
    const commercial = resolveAiProviderForExpert("commercial-director");
    assert(commercial.id === "anthropic", "sem variável específica, deveria cair para AXION_AI_PROVIDER");
  } finally {
    clearEnv();
  }
});

await checkAsync("AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR=anthropic sem ANTHROPIC_API_KEY continua fail-closed (nunca cai para fake)", async () => {
  clearEnv();
  process.env.AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR = "anthropic";
  try {
    const error = await assertRejects(
      () => resolveAiProviderForExpert("commercial-director"),
      "ANTHROPIC_API_KEY",
      "deveria falhar fechado sem ANTHROPIC_API_KEY"
    );
    assert(!error.message.includes("fake"), "mensagem de erro não deveria sugerir um fallback para fake");
  } finally {
    clearEnv();
  }
});

check("valor inválido em variável específica falha fechado (nunca aceita silenciosamente)", () => {
  clearEnv();
  process.env.AXION_AI_PROVIDER_ESG_DIRECTOR = "bogus-provider";
  try {
    let threw = false;
    let message = "";
    try {
      resolveAiProviderForExpert("esg-director");
    } catch (error) {
      threw = true;
      message = error.message;
    }
    assert(threw, "deveria ter lançado para valor inválido");
    assert(message.includes("bogus-provider"), "mensagem deveria citar o valor inválido");
  } finally {
    clearEnv();
  }
});

check('nenhum fallback "anthropic → fake" por erro: resolveAiProviderNameForExpert reporta o nome resolvido, e a instanciação falha em vez de silenciosamente devolver fake', () => {
  clearEnv();
  process.env.AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR = "anthropic";
  try {
    assert(resolveAiProviderNameForExpert("commercial-director") === "anthropic", "nome resolvido deveria ser anthropic");
    let resolvedProvider = null;
    try {
      resolvedProvider = resolveAiProviderForExpert("commercial-director");
    } catch {
      // esperado — ANTHROPIC_API_KEY ausente
    }
    assert(resolvedProvider === null, "nenhum provider deveria ter sido retornado (nem fake) quando anthropic falha");
  } finally {
    clearEnv();
  }
});

// Os cinco Experts oficiais estão autorizados no AnthropicAiProvider (ANTHROPIC_ALLOWED_EXPERT_IDS).
// A versão antiga deste teste esperava que o CEO fosse rejeitado e, por isso, chamava answerQuery() com
// o provider REAL e uma chave de mentira — o que dispara uma requisição HTTPS de verdade a
// api.anthropic.com (HTTP 401). Agora usa um client FALSO injetado: nenhuma rede.
await checkAsync(
  "resolução 'anthropic' por Expert só CONSTRÓI o provider (sem rede); o uso real é exercitado com client falso injetado",
  async () => {
    clearEnv();
    setDummyAnthropicCreds();
    process.env.AXION_AI_PROVIDER_CEO = "anthropic";
    try {
      const provider = resolveAiProviderForExpert("ceo");
      assert(provider.id === "anthropic", "a resolução em si constrói o provider anthropic (sem chamar nada)");
    } finally {
      clearEnv();
    }
    const { createAnthropicAiProvider } = await import("../apps/web/lib/ai/providers/anthropic-provider");
    let calls = 0;
    const provider = createAnthropicAiProvider({
      config: { apiKey: "sk-test-fake-key-not-real", model: "claude-test-model", maxTokens: 1024, timeoutMs: 2000 },
      client: { messages: { create: async () => { calls += 1; throw Object.assign(new Error("client falso: sem rede"), { status: 500 }); } } },
    });
    await assertRejects(
      provider.answerQuery({
        expertId: "ceo", expertName: "CEO IA", expertVersion: "v1", instructions: "x", scope: "PROJECT",
        question: "x", eventContext: null, projectContext: null, outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
      }),
      "Erro do servidor Anthropic (HTTP 500)",
      "o erro do client falso deve ser propagado pelo provider"
    );
    assert(calls >= 1, "o client FALSO (e não a rede) recebeu a chamada");
  }
);

check("fake provider existente continua funcionando via resolveAiProviderForExpert", () => {
  clearEnv();
  try {
    const provider = resolveAiProviderForExpert("commercial-director");
    assert(provider.id === "fake");
    assert(typeof provider.generateAssessment === "function");
    assert(typeof provider.answerQuery === "function");
  } finally {
    clearEnv();
  }
});

restoreEnv();

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
