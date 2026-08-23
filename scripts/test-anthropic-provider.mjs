// Testes automatizados do AnthropicAiProvider — NUNCA dependem da API
// Anthropic real: o client do SDK é sempre substituído por um mock local
// (ver createAnthropicAiProvider({ client, config })). Para o teste real
// contra a API (gated por --live), ver
// scripts/test-anthropic-commercial-director.mjs.
//
// Uso:
//   node scripts/test-anthropic-provider.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { createAnthropicAiProvider } = await import("../apps/web/lib/ai/providers/anthropic-provider");
const { loadAnthropicConfig } = await import("../apps/web/lib/ai/providers/anthropic-config");
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider");
const { getAiProvider } = await import("../apps/web/lib/ai/providers/get-ai-provider");
const { COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA } = await import(
  "../apps/web/lib/ai/experts/commercial-director/json-schema"
);
const { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } = await import("../apps/web/lib/ai/query/json-schema");
const { EXECUTIVE_CURATION_JSON_SCHEMA } = await import("../apps/web/lib/ai/experts/ceo/json-schema");
const { runCommercialDirectorExpert } = await import("../apps/web/lib/ai/experts/commercial-director/index");
const { validateCommercialDirectorAssessment } = await import("../apps/web/lib/ai/experts/commercial-director/schema");
const { COMMERCIAL_DIRECTOR_VERSION } = await import("../apps/web/lib/ai/experts/commercial-director/identity");

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

async function assertRejects(promise, messageSubstring, label) {
  try {
    await promise;
  } catch (error) {
    if (messageSubstring && !error.message.includes(messageSubstring)) {
      throw new Error(`${label ?? "rejeição"} — mensagem não contém "${messageSubstring}": ${error.message}`);
    }
    return error;
  }
  throw new Error(`${label ?? "esperado rejeição"}, mas resolveu`);
}

// --- Ambiente isolado: nunca depende de .env.local real, nunca herda
// segredos reais do processo do desenvolvedor durante os testes de
// fail-closed. ---
const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_MAX_TOKENS", "ANTHROPIC_TIMEOUT_MS"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function clearAnthropicEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}
function restoreAnthropicEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

console.log("");
console.log("======================================");
console.log("ANTHROPIC AI PROVIDER — TESTES (mockado, sem rede)");
console.log("======================================");
console.log("");

// --- loadAnthropicConfig: fail-closed ---

check("loadAnthropicConfig falha (fail-closed) quando ANTHROPIC_API_KEY está ausente", () => {
  clearAnthropicEnv();
  process.env.ANTHROPIC_MODEL = "claude-test-model";
  try {
    let threw = false;
    try {
      loadAnthropicConfig();
    } catch (error) {
      threw = true;
      assert(error.message.includes("ANTHROPIC_API_KEY"), "mensagem deveria citar ANTHROPIC_API_KEY");
    }
    assert(threw, "deveria ter lançado");
  } finally {
    clearAnthropicEnv();
  }
});

check("loadAnthropicConfig falha (fail-closed) quando ANTHROPIC_MODEL está ausente", () => {
  clearAnthropicEnv();
  process.env.ANTHROPIC_API_KEY = "sk-test-fake-key-not-real";
  try {
    let threw = false;
    try {
      loadAnthropicConfig();
    } catch (error) {
      threw = true;
      assert(error.message.includes("ANTHROPIC_MODEL"), "mensagem deveria citar ANTHROPIC_MODEL");
      assert(!error.message.includes("sk-test-fake-key-not-real"), "a chave nunca pode aparecer na mensagem de erro");
    }
    assert(threw, "deveria ter lançado");
  } finally {
    clearAnthropicEnv();
  }
});

check("loadAnthropicConfig usa defaults conservadores quando ANTHROPIC_MAX_TOKENS/ANTHROPIC_TIMEOUT_MS ausentes", () => {
  clearAnthropicEnv();
  process.env.ANTHROPIC_API_KEY = "sk-test-fake-key-not-real";
  process.env.ANTHROPIC_MODEL = "claude-test-model";
  try {
    const config = loadAnthropicConfig();
    assert(config.maxTokens === 4096, `maxTokens default esperado 4096, obtido ${config.maxTokens}`);
    assert(config.timeoutMs === 60000, `timeoutMs default esperado 60000, obtido ${config.timeoutMs}`);
    assert(config.model === "claude-test-model");
  } finally {
    clearAnthropicEnv();
  }
});

check("loadAnthropicConfig respeita ANTHROPIC_MAX_TOKENS/ANTHROPIC_TIMEOUT_MS quando configurados", () => {
  clearAnthropicEnv();
  process.env.ANTHROPIC_API_KEY = "sk-test-fake-key-not-real";
  process.env.ANTHROPIC_MODEL = "claude-test-model";
  process.env.ANTHROPIC_MAX_TOKENS = "2048";
  process.env.ANTHROPIC_TIMEOUT_MS = "15000";
  try {
    const config = loadAnthropicConfig();
    assert(config.maxTokens === 2048);
    assert(config.timeoutMs === 15000);
  } finally {
    clearAnthropicEnv();
  }
});

check("loadAnthropicConfig falha (fail-closed) com ANTHROPIC_MAX_TOKENS inválido (não numérico)", () => {
  clearAnthropicEnv();
  process.env.ANTHROPIC_API_KEY = "sk-test-fake-key-not-real";
  process.env.ANTHROPIC_MODEL = "claude-test-model";
  process.env.ANTHROPIC_MAX_TOKENS = "abc";
  try {
    let threw = false;
    try {
      loadAnthropicConfig();
    } catch {
      threw = true;
    }
    assert(threw, "deveria ter lançado para ANTHROPIC_MAX_TOKENS inválido");
  } finally {
    clearAnthropicEnv();
  }
});

check("createAnthropicAiProvider() sem overrides e sem env configurado falha fechado na construção", () => {
  clearAnthropicEnv();
  try {
    let threw = false;
    try {
      createAnthropicAiProvider();
    } catch {
      threw = true;
    }
    assert(threw, "deveria ter lançado ao construir sem configuração");
  } finally {
    clearAnthropicEnv();
  }
});

check("getAiProvider() com AXION_AI_PROVIDER=anthropic e sem chave falha fechado (nunca cai para fake)", () => {
  const savedProvider = process.env.AXION_AI_PROVIDER;
  clearAnthropicEnv();
  process.env.AXION_AI_PROVIDER = "anthropic";
  try {
    let threw = false;
    let providerId = null;
    try {
      const provider = getAiProvider();
      providerId = provider.id;
    } catch {
      threw = true;
    }
    assert(threw, "deveria ter lançado — nunca cair silenciosamente para fake");
    assert(providerId === null, "nenhum provider deveria ter sido retornado");
  } finally {
    clearAnthropicEnv();
    if (savedProvider === undefined) delete process.env.AXION_AI_PROVIDER;
    else process.env.AXION_AI_PROVIDER = savedProvider;
  }
});

check("fake provider continua funcionando (não regrediu com a introdução do Anthropic provider)", () => {
  const provider = createFakeAiProvider();
  assert(provider.id === "fake");
  assert(typeof provider.generateAssessment === "function");
  assert(typeof provider.answerQuery === "function");
});

// --- AnthropicAiProvider com client mockado (sem rede) ---

function makeMockClient(implementation) {
  const calls = [];
  const callOptions = [];
  return {
    calls,
    callOptions,
    client: {
      messages: {
        create: async (params, options) => {
          calls.push(params);
          callOptions.push(options);
          return implementation(params, options);
        },
      },
    },
  };
}

const FAKE_CONFIG = { apiKey: "sk-test-fake-key-not-real", model: "claude-test-model", maxTokens: 4096, timeoutMs: 5000 };

function validNegotiation() {
  return {
    negotiationObjective: null,
    currentPosition: null,
    targetPosition: null,
    minimumAcceptablePosition: { status: "REQUIRES_HUMAN_DEFINITION", value: null, basis: null },
    nonNegotiableItems: [],
    negotiableItems: [],
    possibleConcessions: [],
    requiredCounterparts: [],
    counterpartyLikelyInterests: [],
    recommendedStrategy: null,
    arguments: [],
    anticipatedObjections: [],
    suggestedResponses: [],
    recommendedSequence: [],
    commercialRisks: [],
    financialImpact: { category: "FINANCIAL", status: "UNAVAILABLE", description: null, estimatedValue: null, basis: null },
    scheduleImpact: { category: "SCHEDULE", status: "UNAVAILABLE", description: null, estimatedValue: null, basis: null },
    contractualImpact: { category: "CONTRACTUAL", status: "UNAVAILABLE", description: null, estimatedValue: null, basis: null },
    draftCommunication: null,
  };
}

function validAssessmentOutput() {
  return {
    expertId: "commercial-director",
    expertName: "Diretor Comercial IA",
    expertVersion: COMMERCIAL_DIRECTOR_VERSION,
    analysisType: "COMMERCIAL_NEGOTIATION_STRATEGY",
    finding: { facts: ["Fato de teste."], interpretation: "Interpretação de teste." },
    severity: "LOW",
    confidence: 0.4,
    executiveSummary: "Resumo de teste.",
    contractualBasis: [],
    eventBasis: [],
    evidenceRefs: [],
    possibleImpacts: [],
    recommendedActions: [],
    uncertainties: [],
    requiresHumanReview: true,
    negotiation: validNegotiation(),
  };
}

function validQueryOutput() {
  return {
    expertId: "commercial-director",
    expertName: "x",
    expertVersion: "v1",
    scope: "PROJECT",
    question: "x",
    fatosDocumentados: [],
    contextoInternoDeclarado: [],
    baseContratual: [],
    baseLegal: [],
    praticasNegociais: [],
    interpretacao: "Interpretação de teste.",
    riscos: [],
    severity: "LOW",
    recomendacoes: [],
    acoesSugeridas: [],
    informacoesFaltantes: [],
    rascunhoSugerido: null,
    confidence: 0.4,
    requiresHumanReview: true,
  };
}

function minimalEventContext() {
  return {
    projectId: "proj-1",
    eventId: "event-1",
    focusCandidateId: null,
    event: { id: "event-1", projectId: "proj-1", title: "Evento de teste", description: "", occurredAt: "2026-01-01T00:00:00.000Z", sourceType: "MANUAL", status: "ABERTO" },
    evidence: [],
    relatedClauses: [],
    relatedEmails: [],
    confrontationCandidates: [],
    eventNotes: [],
  };
}

await checkAsync("generateAssessment (commercial-director) com tool_use válido retorna providerId/model/output/usage/stopReason corretos", async () => {
  const toolInput = validAssessmentOutput();
  const { client, calls } = makeMockClient(() => ({
    content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: toolInput }],
    stop_reason: "tool_use",
    usage: { input_tokens: 123, output_tokens: 45 },
  }));

  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  const response = await provider.generateAssessment({
    expertId: "commercial-director",
    expertName: "Diretor Comercial IA",
    expertVersion: "v1",
    instructions: "Instruções de teste do Diretor Comercial IA.",
    analysisType: "COMMERCIAL_NEGOTIATION_STRATEGY",
    context: minimalEventContext(),
    outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
  });

  assert(response.providerId === "anthropic");
  assert(response.model === "claude-test-model");
  assert(response.output === toolInput, "output deveria ser exatamente o input da tool_use (sem parsing frágil)");
  assert(response.stopReason === "tool_use");
  assert(response.usage.inputTokens === 123);
  assert(response.usage.outputTokens === 45);
  assert(calls.length === 1, "deveria ter chamado o client exatamente uma vez");
});

await checkAsync("request enviado ao Anthropic contém as instruções do Expert, tool_choice forçado e o outputSchema recebido", async () => {
  const toolInput = validAssessmentOutput();
  const { client, calls, callOptions } = makeMockClient(() => ({
    content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: toolInput }],
    stop_reason: "tool_use",
  }));

  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });
  const instructions = "INSTRUÇÕES-ÚNICAS-DE-TESTE-DIRETOR-COMERCIAL";

  await provider.generateAssessment({
    expertId: "commercial-director",
    expertName: "Diretor Comercial IA",
    expertVersion: "v1",
    instructions,
    analysisType: "COMMERCIAL_NEGOTIATION_STRATEGY",
    context: minimalEventContext(),
    outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
  });

  const sent = calls[0];
  assert(sent.system.includes(instructions), "system prompt deveria conter as instruções do Expert");
  assert(sent.model === "claude-test-model");
  assert(sent.tool_choice.type === "tool" && sent.tool_choice.name === "emit_expert_structured_output");
  assert(sent.tools[0].input_schema === COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA, "input_schema deveria ser exatamente o outputSchema recebido — provider nunca inventa outro schema");
  assert(sent.stream === undefined, "nenhuma stream deveria ser aberta nesta fase (stream nunca deve ser true)");
  assert(callOptions[0]?.signal instanceof AbortSignal, "um AbortSignal deveria ser repassado ao client como segundo argumento (cortesia para cancelamento)");
});

await checkAsync("answerQuery é aceito para os cinco Experts oficiais (todos autorizados no AnthropicAiProvider nesta fase)", async () => {
  const toolInput = { ...validQueryOutput(), expertId: "placeholder" };
  for (const expertId of ["commercial-director", "esg-director", "legal-consultant", "planning-director", "ceo"]) {
    const output = { ...toolInput, expertId };
    const { client, calls } = makeMockClient(() => ({
      content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: output }],
      stop_reason: "tool_use",
    }));
    const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

    const response = await provider.answerQuery({
      expertId,
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      scope: "PROJECT",
      question: "x",
      eventContext: null,
      projectContext: { projectId: "p1", project: { id: "p1", name: "P", client: "C", status: "ATIVO", contractNumber: null }, events: [], eventsTotalCount: 0, esgObligations: [], esgObligationsTotalCount: 0 },
      outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
    });
    assert(response.providerId === "anthropic", `${expertId} deveria ter sido aceito pelo AnthropicAiProvider`);
    assert(calls.length === 1, `${expertId} deveria ter chamado o client exatamente uma vez`);
  }
});

await checkAsync('"contract-lawyer" continua rejeitado pelo AnthropicAiProvider (nunca reintroduzido)', async () => {
  const { client, calls } = makeMockClient(() => {
    throw new Error("client não deveria ter sido chamado");
  });
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  await assertRejects(
    provider.answerQuery({
      expertId: "contract-lawyer",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      scope: "PROJECT",
      question: "x",
      eventContext: null,
      projectContext: null,
      outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
    }),
    "contract-lawyer",
    '"contract-lawyer" deveria ser rejeitado'
  );
  assert(calls.length === 0);
});

await checkAsync("stop_reason=max_tokens (truncamento) nunca é tratado como avaliação válida", async () => {
  const { client } = makeMockClient(() => ({
    content: [{ type: "text", text: "resposta parcial truncada" }],
    stop_reason: "max_tokens",
  }));
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  await assertRejects(
    provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      analysisType: "RISK_ASSESSMENT",
      context: minimalEventContext(),
      outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
    }),
    "max_tokens",
    "truncamento deveria falhar"
  );
});

await checkAsync("stop_reason=refusal gera erro controlado (não crash opaco)", async () => {
  const { client } = makeMockClient(() => ({
    content: [],
    stop_reason: "refusal",
  }));
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  await assertRejects(
    provider.answerQuery({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      scope: "PROJECT",
      question: "x",
      eventContext: null,
      projectContext: { projectId: "p1", project: { id: "p1", name: "P", client: "C", status: "ATIVO", contractNumber: null }, events: [], eventsTotalCount: 0, esgObligations: [], esgObligationsTotalCount: 0 },
      outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
    }),
    "recusou",
    "refusal deveria gerar erro controlado"
  );
});

await checkAsync("resposta sem bloco tool_use (stop_reason normal) falha fechado — nunca aceita saída parcialmente validada", async () => {
  const { client } = makeMockClient(() => ({
    content: [{ type: "text", text: "isto não é uma tool_use" }],
    stop_reason: "end_turn",
  }));
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  await assertRejects(
    provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      analysisType: "RISK_ASSESSMENT",
      context: minimalEventContext(),
      outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
    }),
    "emit_expert_structured_output",
    "ausência de tool_use deveria falhar"
  );
});

await checkAsync("rate limit (HTTP 429) do client é tratado com mensagem clara, não crash opaco", async () => {
  const client = {
    messages: {
      create: async () => {
        const err = new Error("Too Many Requests");
        err.status = 429;
        throw err;
      },
    },
  };
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  const error = await assertRejects(
    provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      analysisType: "RISK_ASSESSMENT",
      context: minimalEventContext(),
      outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
    }),
    "429",
    "rate limit deveria gerar erro claro"
  );
  assert(error.message.toLowerCase().includes("rate limit"), "mensagem deveria mencionar rate limit");
});

await checkAsync("erro 5xx do client é tratado com mensagem clara, não crash opaco", async () => {
  const client = {
    messages: {
      create: async () => {
        const err = new Error("Internal Server Error");
        err.status = 503;
        throw err;
      },
    },
  };
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  await assertRejects(
    provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      analysisType: "RISK_ASSESSMENT",
      context: minimalEventContext(),
      outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
    }),
    "503",
    "erro 5xx deveria gerar mensagem clara"
  );
});

await checkAsync("timeout do client é tratado com mensagem clara, não crash opaco", async () => {
  const client = {
    messages: {
      create: async () => {
        const err = new Error("Request timed out");
        err.name = "APIConnectionTimeoutError";
        throw err;
      },
    },
  };
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  const error = await assertRejects(
    provider.answerQuery({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      scope: "PROJECT",
      question: "x",
      eventContext: null,
      projectContext: { projectId: "p1", project: { id: "p1", name: "P", client: "C", status: "ATIVO", contractNumber: null }, events: [], eventsTotalCount: 0, esgObligations: [], esgObligationsTotalCount: 0 },
      outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
    }),
    "Timeout",
    "timeout deveria gerar mensagem clara"
  );
  assert(error.message.toLowerCase().includes("timeout"));
});

await checkAsync("erro 4xx não transitório (400) do client é tratado com mensagem clara, sem repetição implícita", async () => {
  const client = {
    messages: {
      create: async () => {
        const err = new Error("Bad Request: invalid tool schema");
        err.status = 400;
        throw err;
      },
    },
  };
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  await assertRejects(
    provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      analysisType: "RISK_ASSESSMENT",
      context: minimalEventContext(),
      outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
    }),
    "400",
    "erro 400 deveria gerar mensagem clara"
  );
});

await checkAsync("erro 401 (autenticação) do client é tratado com mensagem clara, status/code preservados", async () => {
  const client = {
    messages: {
      create: async () => {
        const err = new Error("invalid x-api-key");
        err.status = 401;
        err.type = "authentication_error";
        throw err;
      },
    },
  };
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  const error = await assertRejects(
    provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      analysisType: "RISK_ASSESSMENT",
      context: minimalEventContext(),
      outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
    }),
    "401",
    "erro 401 deveria gerar mensagem clara"
  );
  assert(error.anthropicStatus === 401, "status estruturado deveria ser preservado no erro");
  assert(error.anthropicCode === "authentication_error", "code estruturado deveria ser preservado no erro");
  assert(!error.message.includes("x-api-key") || !/[A-Za-z0-9_-]{20,}/.test(error.message), "mensagem nunca deveria conter algo parecido com uma chave real");
});

await checkAsync("erro 404 (modelo inexistente) do client é tratado com mensagem clara", async () => {
  const client = {
    messages: {
      create: async () => {
        const err = new Error("model: claude-modelo-inexistente not found");
        err.status = 404;
        err.type = "not_found_error";
        throw err;
      },
    },
  };
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  const error = await assertRejects(
    provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "x",
      expertVersion: "v1",
      instructions: "x",
      analysisType: "RISK_ASSESSMENT",
      context: minimalEventContext(),
      outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
    }),
    "404",
    "erro 404 (modelo) deveria gerar mensagem clara"
  );
  assert(error.anthropicStatus === 404);
});

await checkAsync(
  'request que NUNCA resolve ("pendurado") é cancelada pelo timeout de aplicação — nunca fica pendurada indefinidamente',
  async () => {
    const client = {
      messages: {
        create: () => new Promise(() => {}), // nunca resolve nem rejeita — simula o incidente real
      },
    };
    const shortTimeoutConfig = { ...FAKE_CONFIG, timeoutMs: 80 };
    const provider = createAnthropicAiProvider({ config: shortTimeoutConfig, client });

    const startedAt = Date.now();
    const error = await assertRejects(
      provider.generateAssessment({
        expertId: "commercial-director",
        expertName: "x",
        expertVersion: "v1",
        instructions: "x",
        analysisType: "RISK_ASSESSMENT",
        context: minimalEventContext(),
        outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
      }),
      "Timeout",
      "request pendurada deveria ser cancelada pelo timeout de aplicação"
    );
    const elapsedMs = Date.now() - startedAt;
    assert(elapsedMs < 2000, `deveria ter cancelado perto de 80ms, levou ${elapsedMs}ms — timeout de aplicação não está funcionando`);
    assert(error.message.toLowerCase().includes("timeout"));
  }
);

await checkAsync(
  "request pendurada aborta o AbortSignal repassado ao client (mesmo que o client em si nunca resolva)",
  async () => {
    let signalWasAborted = false;
    const client = {
      messages: {
        create: (_params, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              signalWasAborted = true;
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      },
    };
    const shortTimeoutConfig = { ...FAKE_CONFIG, timeoutMs: 80 };
    const provider = createAnthropicAiProvider({ config: shortTimeoutConfig, client });

    await assertRejects(
      provider.generateAssessment({
        expertId: "commercial-director",
        expertName: "x",
        expertVersion: "v1",
        instructions: "x",
        analysisType: "RISK_ASSESSMENT",
        context: minimalEventContext(),
        outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
      }),
      null,
      "deveria rejeitar"
    );
    assert(signalWasAborted, "o AbortSignal repassado ao client deveria ter sido abortado no timeout — evita deixar a requisição HTTP pendurada em segundo plano");
  }
);

// --- consolidateExecutiveCuration (CEO IA) ---

await checkAsync("consolidateExecutiveCuration envia situationSummary + positions e retorna o output validável", async () => {
  const output = {
    situacao: "x",
    fatosPrincipais: [],
    posicoes: [],
    divergencias: [],
    riscos: [],
    overallSeverity: "LOW",
    alternativas: [],
    recomendacao: "x",
    decisoesHumanasNecessarias: [],
    requiresHumanReview: true,
  };
  const { client, calls } = makeMockClient(() => ({
    content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: output }],
    stop_reason: "tool_use",
  }));
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  const response = await provider.consolidateExecutiveCuration({
    expertId: "ceo",
    expertName: "CEO IA",
    expertVersion: "v1",
    instructions: "INSTRUÇÕES-DE-TESTE-CEO",
    situationSummary: "Situação de teste.",
    positions: [{ expertId: "commercial-director", expertName: "Diretor Comercial IA", severity: "LOW", interpretacao: "x", riscos: [], recomendacoes: [], informacoesFaltantes: [] }],
    outputSchema: EXECUTIVE_CURATION_JSON_SCHEMA,
  });

  assert(response.providerId === "anthropic");
  assert(response.output === output);
  assert(calls[0].system.includes("INSTRUÇÕES-DE-TESTE-CEO"));
  assert(calls[0].tools[0].input_schema === EXECUTIVE_CURATION_JSON_SCHEMA);
  assert(JSON.stringify(calls[0].messages).includes("Situação de teste."), "conteúdo enviado deveria incluir situationSummary");
  assert(JSON.stringify(calls[0].messages).includes("commercial-director"), "conteúdo enviado deveria incluir as posições dos especialistas");
});

check("createAnthropicAiProvider não recebe nenhum client de banco de dados (nunca escreve no banco)", () => {
  assert(createAnthropicAiProvider.length <= 1, "assinatura não deveria aceitar um client de banco de dados");
});

// --- Integração real com a orquestração do Expert (runCommercialDirectorExpert) ---

await checkAsync("runCommercialDirectorExpert aceita saída válida do provider Anthropic (mock) e preserva negotiation real (não sobrescreve com fake)", async () => {
  const toolInput = validAssessmentOutput();
  toolInput.negotiation.recommendedStrategy = "Estratégia real vinda do modelo — nunca deveria ser sobrescrita.";
  const { client } = makeMockClient(() => ({
    content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: toolInput }],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  }));

  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });
  const result = await runCommercialDirectorExpert(minimalEventContext(), provider);

  assert(result.audit.providerId === "anthropic");
  assert(result.audit.model === "claude-test-model");
  assert(result.audit.stopReason === "tool_use");
  assert(result.audit.usage.inputTokens === 10);
  assert(
    result.assessment.negotiation.recommendedStrategy === "Estratégia real vinda do modelo — nunca deveria ser sobrescrita.",
    "negotiation real do provider Anthropic não pode ser substituída pela lógica do fake provider"
  );
});

await checkAsync("runCommercialDirectorExpert rejeita saída inválida do provider Anthropic (mock) — fail closed, nunca aceita parcialmente válido", async () => {
  const invalidOutput = validAssessmentOutput();
  delete invalidOutput.negotiation.financialImpact; // campo obrigatório ausente
  const { client } = makeMockClient(() => ({
    content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: invalidOutput }],
    stop_reason: "tool_use",
  }));

  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  await assertRejects(
    runCommercialDirectorExpert(minimalEventContext(), provider),
    "financialImpact",
    "saída inválida do provider real deveria ser rejeitada pelo validador"
  );
});

check("validateCommercialDirectorAssessment rejeita requiresHumanReview=false mesmo vindo de um provider real (mock)", () => {
  const invalid = validAssessmentOutput();
  invalid.requiresHumanReview = false;
  let threw = false;
  try {
    validateCommercialDirectorAssessment(invalid, { expertId: "commercial-director", expertName: "Diretor Comercial IA", expertVersion: COMMERCIAL_DIRECTOR_VERSION });
  } catch {
    threw = true;
  }
  assert(threw, "requiresHumanReview=false deveria ser rejeitado");
});

restoreAnthropicEnv();

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
