// Regressão do erro real observado no navegador ao consultar um Expert
// ("Consultar" no painel de pergunta ao especialista):
//
//   scope inválido: undefined
//
// Causa: ExpertQueryResponse.scope era lido da SAÍDA DO PROVIDER. `scope`
// nunca foi um fato descoberto pelo modelo — é metadado da requisição,
// já conhecido no servidor. Quando o LLM real omitia o campo (ele não é
// necessário para responder), validateExpertQueryResponse descartava a
// resposta inteira e a UI exibia literalmente "undefined".
//
// Correção coberta aqui:
//   1. o servidor DERIVA o scope do ExpertQueryRequest já validado
//      (ExpectedExpertQueryIdentity.scope) — nunca do provider;
//   2. divergência declarada pelo provider continua falhando (nunca
//      aceitar resposta montada em outro contexto);
//   3. contexto ausente vira mensagem legível, nunca "undefined";
//   4. isolamento entre projetos permanece garantido no servidor.
//
// Uso:
//   node scripts/test-expert-query-scope.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { validateExpertQueryResponse, ExpertQueryValidationError, MISSING_QUERY_SCOPE_MESSAGE } = await import(
  "../apps/web/lib/ai/query/validate-expert-query-response"
);
const { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } = await import("../apps/web/lib/ai/query/json-schema");
const {
  ExpertQuerySafeError,
  MISSING_QUERY_CONTEXT_MESSAGE,
  MISSING_QUESTION_MESSAGE,
  parseExpertQueryForm,
  resolveExpertQueryErrorMessage,
} = await import("../apps/web/lib/ai/expert-query-request");
const { LEGAL_CONSULTANT_EXPERT_ID, LEGAL_CONSULTANT_NAME, LEGAL_CONSULTANT_VERSION } = await import(
  "../apps/web/lib/ai/experts/legal-consultant/identity"
);
const { answerLegalConsultantQuery } = await import("../apps/web/lib/ai/experts/legal-consultant/query");
const { answerCommercialDirectorQuery } = await import("../apps/web/lib/ai/experts/commercial-director/query");
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider");

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

function assertThrows(fn, ErrorClass, message) {
  try {
    fn();
  } catch (error) {
    if (ErrorClass && !(error instanceof ErrorClass)) {
      throw new Error(`${message ?? "esperado throw"} — tipo inesperado: ${error.constructor.name}`);
    }
    return error;
  }
  throw new Error(message ?? "esperado throw, mas não lançou");
}

async function assertRejectsWith(promise, expectedFragment, message) {
  try {
    await promise;
  } catch (error) {
    assert(
      String(error.message).includes(expectedFragment),
      `${message ?? "rejeição inesperada"} — mensagem: ${error.message}`
    );
    return error;
  }
  throw new Error(message ?? "esperado rejeição, mas resolveu");
}

// --- Stub de Supabase somente-leitura (sem rede, sem banco) ------------
// Reproduz apenas o encadeamento realmente usado pelos context builders:
// .from().select().eq().in().order().limit().maybeSingle(). As linhas são
// filtradas de verdade pelos .eq/.in — é isso que permite testar
// isolamento entre projetos sem depender de RLS remoto.
function createSupabaseStub(tables) {
  function applyFilters(rows, filters) {
    return rows.filter((row) =>
      filters.every((filter) =>
        filter.type === "eq" ? row[filter.column] === filter.value : filter.values.includes(row[filter.column])
      )
    );
  }

  return {
    from(table) {
      const rows = tables[table] ?? [];
      const filters = [];
      let headCount = false;

      const builder = {
        select(_columns, options) {
          if (options && options.head) headCount = true;
          return builder;
        },
        eq(column, value) {
          filters.push({ type: "eq", column, value });
          return builder;
        },
        in(column, values) {
          filters.push({ type: "in", column, values });
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          const filtered = applyFilters(rows, filters);
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
        then(resolve, reject) {
          const filtered = applyFilters(rows, filters);
          const result = headCount
            ? { data: null, count: filtered.length, error: null }
            : { data: filtered, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };

      return builder;
    },
  };
}

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const EVENT_OF_PROJECT_B = "33333333-3333-4333-8333-333333333333";

const supabase = createSupabaseStub({
  projects: [
    { id: PROJECT_A, name: "Projeto A", client: "Cliente A", status: "ATIVO", contract_number: "CT-A" },
    { id: PROJECT_B, name: "Projeto B", client: "Cliente B", status: "ATIVO", contract_number: "CT-B" },
  ],
  contract_events: [
    {
      id: EVENT_OF_PROJECT_B,
      project_id: PROJECT_B,
      title: "Evento do Projeto B",
      description: "Somente do Projeto B.",
      occurred_at: "2026-01-10T00:00:00.000Z",
      source_type: "EMAIL",
      status: "CONFIRMED",
    },
  ],
});

const identity = {
  expertId: LEGAL_CONSULTANT_EXPERT_ID,
  expertName: LEGAL_CONSULTANT_NAME,
  expertVersion: LEGAL_CONSULTANT_VERSION,
};

function providerOutput(overrides = {}) {
  return {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    question: "A cláusula de reajuste se aplica a este contrato?",
    fatosDocumentados: [],
    contextoInternoDeclarado: [],
    baseContratual: [],
    baseLegal: [],
    praticasNegociais: [],
    interpretacao: "Interpretação sugerida — exige revisão humana.",
    riscos: [],
    severity: "LOW",
    recomendacoes: [],
    acoesSugeridas: [],
    informacoesFaltantes: [],
    rascunhoSugerido: null,
    confidence: 0.4,
    requiresHumanReview: true,
    ...overrides,
  };
}

/** Provider que imita o LLM real omitindo `scope` — a causa exata do bug. */
function createProviderOmittingScope(counter) {
  return {
    id: "anthropic",
    async answerQuery() {
      counter.calls += 1;
      return {
        providerId: "anthropic",
        model: "claude-sonnet-5",
        output: providerOutput(),
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
    async generateAssessment() {
      throw new Error("nao usado neste teste");
    },
    async consolidateExecutiveCuration() {
      throw new Error("nao usado neste teste");
    },
  };
}

console.log("");
console.log("======================================");
console.log("CONSULTA AO EXPERT — ESCOPO (REGRESSÃO)");
console.log("======================================");
console.log("");

// --- 1. Validador: scope derivado do servidor -------------------------

check("consulta válida com o scope correto é aceita e devolve o scope do servidor", () => {
  const result = validateExpertQueryResponse(providerOutput({ scope: "PROJECT" }), { ...identity, scope: "PROJECT" });
  assert(result.scope === "PROJECT", `scope esperado PROJECT, recebido ${result.scope}`);
  assert(result.requiresHumanReview === true, "revisão humana obrigatória deve ser preservada");
});

check("REGRESSÃO: provider que OMITE scope não quebra mais — servidor deriva o escopo", () => {
  const result = validateExpertQueryResponse(providerOutput(), { ...identity, scope: "EVENT" });
  assert(result.scope === "EVENT", `scope deveria vir do servidor (EVENT), recebido ${String(result.scope)}`);
});

check("provider que devolve scope null também é aceito (servidor é a fonte)", () => {
  const result = validateExpertQueryResponse(providerOutput({ scope: null }), { ...identity, scope: "PROJECT" });
  assert(result.scope === "PROJECT");
});

check("scope inválido declarado pelo provider falha (nunca aceito como escopo real)", () => {
  const error = assertThrows(
    () => validateExpertQueryResponse(providerOutput({ scope: "GALAXY" }), { ...identity, scope: "PROJECT" }),
    ExpertQueryValidationError,
    "scope inválido deveria falhar"
  );
  assert(error.message.includes("divergente"), `mensagem inesperada: ${error.message}`);
  assert(!error.message.includes("undefined"), "mensagem nunca pode conter undefined");
});

check("scope divergente do contexto do servidor falha (resposta de outro contexto nunca é aceita)", () => {
  assertThrows(
    () => validateExpertQueryResponse(providerOutput({ scope: "EVENT" }), { ...identity, scope: "PROJECT" }),
    ExpertQueryValidationError,
    "divergência EVENT vs PROJECT deveria falhar"
  );
});

check("ausência de scope confiável NO SERVIDOR falha com mensagem legível (nunca 'undefined')", () => {
  const error = assertThrows(
    () => validateExpertQueryResponse(providerOutput(), { ...identity, scope: undefined }),
    ExpertQueryValidationError,
    "contexto ausente no servidor deveria falhar"
  );
  assert(error.message === MISSING_QUERY_SCOPE_MESSAGE, `mensagem inesperada: ${error.message}`);
  assert(!error.message.includes("undefined"), "mensagem nunca pode conter undefined");
});

check("scope não é mais exigido do provider no JSON Schema da tool-call", () => {
  assert(
    !EXPERT_QUERY_RESPONSE_JSON_SCHEMA.required.includes("scope"),
    "scope não deve estar em required — é metadado da requisição, não saída do modelo"
  );
  assert(
    Object.prototype.hasOwnProperty.call(EXPERT_QUERY_RESPONSE_JSON_SCHEMA.properties, "scope"),
    "a propriedade scope deve continuar declarada (additionalProperties: false)"
  );
});

// --- 2. Contexto vindo do formulário (Server Action) ------------------

function formDataFrom(entries) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) formData.set(key, value);
  }
  return formData;
}

check("formulário sem scope é recusado com a mensagem de contexto ausente", () => {
  const parsed = parseExpertQueryForm(formDataFrom({ projectId: PROJECT_A, question: "Pergunta?" }));
  assert(parsed.ok === false, "deveria recusar");
  assert(parsed.error === MISSING_QUERY_CONTEXT_MESSAGE, `mensagem inesperada: ${parsed.error}`);
});

check("formulário com scope inválido é recusado (nunca cai em fallback silencioso)", () => {
  const parsed = parseExpertQueryForm(
    formDataFrom({ projectId: PROJECT_A, scope: "GALAXY", question: "Pergunta?" })
  );
  assert(parsed.ok === false, "deveria recusar");
  assert(parsed.error === MISSING_QUERY_CONTEXT_MESSAGE);
});

check("formulário sem projectId é recusado com a mensagem de contexto ausente", () => {
  const parsed = parseExpertQueryForm(formDataFrom({ scope: "PROJECT", question: "Pergunta?" }));
  assert(parsed.ok === false && parsed.error === MISSING_QUERY_CONTEXT_MESSAGE);
});

check("escopo EVENT sem eventId é recusado", () => {
  const parsed = parseExpertQueryForm(formDataFrom({ projectId: PROJECT_A, scope: "EVENT", question: "Pergunta?" }));
  assert(parsed.ok === false && parsed.error === MISSING_QUERY_CONTEXT_MESSAGE);
});

check("pergunta vazia continua recusada com mensagem própria", () => {
  const parsed = parseExpertQueryForm(formDataFrom({ projectId: PROJECT_A, scope: "PROJECT", question: "   " }));
  assert(parsed.ok === false && parsed.error === MISSING_QUESTION_MESSAGE);
});

check("formulário válido preserva projectId, escopo e identificador da análise", () => {
  const parsed = parseExpertQueryForm(
    formDataFrom({ projectId: PROJECT_A, scope: "EVENT", eventId: EVENT_OF_PROJECT_B, question: "Pergunta?" })
  );
  assert(parsed.ok === true, "deveria aceitar");
  assert(parsed.request.projectId === PROJECT_A);
  assert(parsed.request.scope === "EVENT");
  assert(parsed.request.eventId === EVENT_OF_PROJECT_B);
});

check("eventId residual é descartado no escopo PROJECT (nunca contamina a consulta de projeto)", () => {
  const parsed = parseExpertQueryForm(
    formDataFrom({ projectId: PROJECT_A, scope: "PROJECT", eventId: EVENT_OF_PROJECT_B, question: "Pergunta?" })
  );
  assert(parsed.ok === true);
  assert(parsed.request.eventId === undefined, "eventId não deveria sobreviver ao escopo PROJECT");
});

// --- 2b. Sanitizador FAIL-CLOSED de mensagens de erro -----------------
// Nenhuma mensagem tecnica arbitraria pode chegar a interface. So passa
// o que foi deliberadamente redigido para a tela: ExpertQuerySafeError
// (tipado) ou uma das constantes deste modulo (igualdade exata).

const FALLBACK = "Falha ao consultar o especialista.";

const LEAKY_ERRORS = [
  ["scope invalido: undefined (bug original)", new Error("scope inválido: undefined")],
  ["[object Object] (a regex antiga nao pegava por causa do limite de palavra)", new Error("Falha: [object Object]")],
  [
    "erro Postgres/Supabase",
    new Error('duplicate key value violates unique constraint "contract_events_pkey" (code 23505)'),
  ],
  [
    "erro Supabase com nome de tabela/coluna",
    new Error('relation "esg_obligation_submissions" does not exist: column risk_level'),
  ],
  ["erro HTTP do Anthropic", new Error("Erro da API Anthropic (HTTP 401): authentication_error")],
  ["rate limit do Anthropic", new Error("Rate limit da API Anthropic atingido (HTTP 429)")],
  ["timeout de rede", new Error("fetch failed: ECONNREFUSED 10.0.0.1:5432")],
  [
    "stack trace",
    Object.assign(new Error("TypeError: Cannot read properties of undefined (reading 'id')"), {
      stack: ["TypeError", "    at buildProjectAnalysisContext (/var/task/apps/web/lib/ai/context.js:42:11)"].join("\n"),
    }),
  ],
  ["nome de variavel de ambiente", new Error("ANTHROPIC_API_KEY ausente em process.env")],
  ["fragmento com cara de credencial", new Error("Invalid API key: sk-ant-api03-XXXXXXXXXXXX")],
  ["objeto que nao e Error", { message: "falha interna do banco", code: "PGRST301" }],
  ["string solta", "erro cru de implementacao"],
  ["null", null],
  ["undefined", undefined],
  ["Error com mensagem vazia", new Error("")],
  ["Error so com espacos", new Error("   ")],
];

for (const [label, thrown] of LEAKY_ERRORS) {
  check(`sanitizador fail-closed: ${label} nunca chega a UI`, () => {
    const shown = resolveExpertQueryErrorMessage(thrown, FALLBACK);
    assert(shown === FALLBACK, `deveria devolver o fallback, devolveu: ${JSON.stringify(shown)}`);
  });
}

check("nenhuma mensagem vazada sobrevive: varredura agregada", () => {
  for (const [label, thrown] of LEAKY_ERRORS) {
    const shown = resolveExpertQueryErrorMessage(thrown, FALLBACK);
    const raw = thrown instanceof Error ? thrown.message : String(thrown ?? "");
    if (raw.trim()) {
      assert(!shown.includes(raw.trim()), `mensagem crua vazou (${label}): ${shown}`);
    }
    assert(!/undefined|\[object Object\]|HTTP \d{3}|process\.env|sk-ant|at .+\.js:\d+/.test(shown), `padrao tecnico vazou (${label}): ${shown}`);
  }
});

check("mensagens seguras passam SOMENTE por mecanismo explicito e tipado", () => {
  // 1. ExpertQuerySafeError - o mecanismo tipado.
  const safe = new ExpertQuerySafeError("Este espaco ainda nao possui documentos para analisar.");
  assert(resolveExpertQueryErrorMessage(safe, FALLBACK) === "Este espaco ainda nao possui documentos para analisar.");

  // 2. Constantes deste modulo, por igualdade exata.
  assert(resolveExpertQueryErrorMessage(new Error(MISSING_QUERY_CONTEXT_MESSAGE), FALLBACK) === MISSING_QUERY_CONTEXT_MESSAGE);
  assert(resolveExpertQueryErrorMessage(new Error(MISSING_QUESTION_MESSAGE), FALLBACK) === MISSING_QUESTION_MESSAGE);
  assert(resolveExpertQueryErrorMessage(new Error(MISSING_QUERY_SCOPE_MESSAGE), FALLBACK) === MISSING_QUERY_SCOPE_MESSAGE);

  // 3. Quase-igual nao basta: nenhuma correspondencia parcial/prefixo.
  assert(
    resolveExpertQueryErrorMessage(new Error(`${MISSING_QUERY_CONTEXT_MESSAGE} Detalhe: coluna project_id nula.`), FALLBACK) === FALLBACK,
    "prefixo seguro + cauda tecnica nunca pode passar"
  );

  // 4. ExpertQuerySafeError vazio cai no fallback, nunca em string vazia.
  assert(resolveExpertQueryErrorMessage(new ExpertQuerySafeError("   "), FALLBACK) === FALLBACK);
});

check("a abordagem antiga por palavra proibida era furada - prova do motivo da troca", () => {
  // Reconstruida aqui exatamente como era, para documentar por que foi
  // abandonada. O limite de palavra nao casa entre "[" e "o" (nem entre
  // "]" e o fim), entao justamente "[object Object]" escapava do filtro.
  const OLD_FILTER = new RegExp("\\b(undefined|null|NaN|\\[object Object\\])\\b");

  assert(!OLD_FILTER.test("Falha: [object Object]"), "a regex antiga deixava passar [object Object]");
  // E, por ser fail-open, qualquer mensagem tecnica sem essas palavras passava inteira.
  assert(!OLD_FILTER.test("Erro da API Anthropic (HTTP 401): authentication_error"), "a regex antiga deixava passar erro do provider");
  assert(!OLD_FILTER.test('relation "esg_obligation_submissions" does not exist'), "a regex antiga deixava passar erro do Postgres");

  // O sanitizador atual barra os tres.
  for (const leak of [
    "Falha: [object Object]",
    "Erro da API Anthropic (HTTP 401): authentication_error",
    'relation "esg_obligation_submissions" does not exist',
  ]) {
    assert(resolveExpertQueryErrorMessage(new Error(leak), FALLBACK) === FALLBACK, `ainda vaza: ${leak}`);
  }
});

// --- 3. Fluxo completo (Expert + provider) ----------------------------

await checkAsync("REGRESSÃO ponta a ponta: provider sem scope responde normalmente (escopo PROJECT)", async () => {
  const counter = { calls: 0 };
  const result = await answerLegalConsultantQuery(
    supabase,
    { scope: "PROJECT", projectId: PROJECT_A, question: "A cláusula de reajuste se aplica a este contrato?" },
    createProviderOmittingScope(counter)
  );

  assert(counter.calls === 1, "o provider deveria ter sido chamado uma vez");
  assert(result.response.scope === "PROJECT", `scope esperado PROJECT, recebido ${String(result.response.scope)}`);
  assert(result.response.requiresHumanReview === true, "revisão humana obrigatória deve ser preservada");
  assert(result.response.rascunhoSugerido === null, "nenhuma comunicação vinculante pode ser produzida/enviada");
  assert(result.audit.projectId === PROJECT_A, "projectId da análise deve ser preservado na trilha de auditoria");
  assert(result.audit.scope === "PROJECT");
  assert(result.audit.providerId === "anthropic", "provider utilizado deve ser exposto para exibição na UI");
  assert(result.audit.model === "claude-sonnet-5");
});

await checkAsync("consulta EVENT preserva o identificador da análise e o provider usado", async () => {
  const counter = { calls: 0 };
  const result = await answerLegalConsultantQuery(
    supabase,
    {
      scope: "EVENT",
      projectId: PROJECT_B,
      eventId: EVENT_OF_PROJECT_B,
      question: "Esta ocorrência gera obrigação contratual?",
    },
    createProviderOmittingScope(counter)
  );

  assert(result.response.scope === "EVENT");
  assert(result.audit.eventId === EVENT_OF_PROJECT_B, "eventId da análise deve ser preservado");
  assert(result.audit.projectId === PROJECT_B);
  assert(result.audit.providerId === "anthropic");
});

await checkAsync("ISOLAMENTO: evento de outro projeto nunca é consultado (provider nem é chamado)", async () => {
  const counter = { calls: 0 };
  await assertRejectsWith(
    answerLegalConsultantQuery(
      supabase,
      {
        scope: "EVENT",
        projectId: PROJECT_A,
        eventId: EVENT_OF_PROJECT_B,
        question: "Esta ocorrência gera obrigação contratual?",
      },
      createProviderOmittingScope(counter)
    ),
    "nunca monta contexto de outro projeto",
    "consulta cruzada entre projetos deveria falhar"
  );
  assert(counter.calls === 0, "o provider nunca pode ser chamado com contexto de outro projeto");
});

await checkAsync("ISOLAMENTO: a resposta traz somente o projeto autorizado da consulta", async () => {
  const result = await answerCommercialDirectorQuery(
    supabase,
    { scope: "PROJECT", projectId: PROJECT_A, question: "Quais riscos comerciais existem?" },
    createFakeAiProvider()
  );

  const serialized = JSON.stringify(result.response);
  assert(serialized.includes("Projeto A"), "a resposta deveria citar o projeto consultado");
  assert(!serialized.includes("Projeto B"), "a resposta nunca pode citar outro projeto");
  assert(!serialized.includes(PROJECT_B), "a resposta nunca pode citar o id de outro projeto");
  assert(result.response.scope === "PROJECT");
});

// --- 4. Telas jurídicas: nenhuma mensagem técnica crua na UI ----------
// Checagem de CÓDIGO-FONTE (não executa Next.js): os Server Actions da
// tela /[projectId]/juridico — origem real do "scope inválido: undefined"
// reportado — precisam sanitizar o erro antes de exibi-lo. Sem isto, uma
// mensagem interna futura volta a vazar para o usuário.
const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const path = await import("node:path");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

for (const relativePath of ["apps/web/lib/ai/legal-query-action.ts", "apps/web/lib/ai/precontract-curation-action.ts"]) {
  check(`${path.basename(relativePath)} nunca exibe error.message cru ao usuário`, () => {
    const source = readSource(relativePath);
    assert(
      source.includes("resolveExpertQueryErrorMessage"),
      "deve sanitizar o erro com resolveExpertQueryErrorMessage"
    );
    assert(
      !/error\s+instanceof\s+Error\s*\?\s*error\.message/.test(source),
      "não pode devolver error.message diretamente para o estado da UI"
    );
    assert(
      source.includes("MISSING_QUERY_CONTEXT_MESSAGE"),
      "contexto ausente deve usar a mensagem única de contexto"
    );
  });
}

check("legal-query-action mantém o scope fixo no servidor (navegador nunca escolhe o escopo)", () => {
  const source = readSource("apps/web/lib/ai/legal-query-action.ts");
  assert(/scope:\s*"PROJECT"/.test(source), 'scope deve continuar literal "PROJECT"');
  assert(
    !/formData\.get\(\s*"scope"\s*\)/.test(source),
    "o escopo desta tela nunca pode ser lido do FormData"
  );
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
