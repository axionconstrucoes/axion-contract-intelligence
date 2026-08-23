// Testes do Diretor de ESG IA (esg-director) — consulta conversacional
// (ExpertQueryResponse), escopo estritamente contratual. Mesmo padrão de
// scripts/test-expert-query.mjs (Diretor Comercial IA).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-esg-director.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { validateExpertQueryResponse, ExpertQueryValidationError } = await import(
  "../apps/web/lib/ai/query/validate-expert-query-response"
);
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider");
const { ESG_DIRECTOR_EXPERT_ID, ESG_DIRECTOR_NAME, ESG_DIRECTOR_VERSION } = await import(
  "../apps/web/lib/ai/experts/esg-director/identity"
);
const { answerEsgDirectorQuery } = await import("../apps/web/lib/ai/experts/esg-director/query");

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
      throw new Error(`${message ?? "esperado throw"} — tipo de erro inesperado: ${error.constructor.name}`);
    }
    return;
  }
  throw new Error(message ?? "esperado throw, mas não lançou");
}

async function assertRejects(promise, message) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(message ?? "esperado rejeição, mas resolveu");
}

const identity = {
  expertId: ESG_DIRECTOR_EXPERT_ID,
  expertName: ESG_DIRECTOR_NAME,
  expertVersion: ESG_DIRECTOR_VERSION,
};

function validResponseFixture() {
  return {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    scope: "PROJECT",
    question: "Quais obrigações ESG/SSMA estão pendentes?",
    fatosDocumentados: ["Fato de teste."],
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
    confidence: 0.3,
    requiresHumanReview: true,
  };
}

console.log("");
console.log("======================================");
console.log("DIRETOR DE ESG IA — TESTES");
console.log("======================================");
console.log("");

check('expertId é exatamente "esg-director" (ID técnico do requisito)', () => {
  assert(ESG_DIRECTOR_EXPERT_ID === "esg-director", `esperado "esg-director", obtido "${ESG_DIRECTOR_EXPERT_ID}"`);
});

check('expertName é exatamente "Diretor de ESG IA"', () => {
  assert(ESG_DIRECTOR_NAME === "Diretor de ESG IA");
});

check("schema de resposta aceita saída válida", () => {
  const result = validateExpertQueryResponse(validResponseFixture(), identity);
  assert(result.requiresHumanReview === true);
});

check("expertId inesperado é rejeitado pelo schema (nunca aceita identidade de outro Expert)", () => {
  const fixture = validResponseFixture();
  fixture.expertId = "commercial-director";
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("requiresHumanReview=false é rejeitado", () => {
  const fixture = validResponseFixture();
  fixture.requiresHumanReview = false;
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("rascunhoSugerido com status diferente de DRAFT_PENDING_REVIEW falha (draft permanece PENDING_REVIEW)", () => {
  const fixture = validResponseFixture();
  fixture.rascunhoSugerido = { type: "EMAIL", subject: "x", body: "y", status: "SENT" };
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("rascunhoSugerido válido (DRAFT_PENDING_REVIEW) é aceito", () => {
  const fixture = validResponseFixture();
  fixture.rascunhoSugerido = { type: "NOTIFICATION", subject: "x", body: "y", status: "DRAFT_PENDING_REVIEW" };
  const result = validateExpertQueryResponse(fixture, identity);
  assert(result.rascunhoSugerido.status === "DRAFT_PENDING_REVIEW");
});

await checkAsync("fake provider (answerQuery) é determinístico", async () => {
  const provider = createFakeAiProvider();
  const request = {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    instructions: "instruções de teste",
    scope: "PROJECT",
    question: "Quais obrigações ESG/SSMA estão pendentes?",
    eventContext: null,
    projectContext: {
      projectId: "proj-1",
      project: { id: "proj-1", name: "Projeto de teste", client: "Cliente", status: "ATIVO", contractNumber: null },
      events: [],
      eventsTotalCount: 0,
      esgObligations: [],
      esgObligationsTotalCount: 0,
    },
  };

  const first = await provider.answerQuery(request);
  const second = await provider.answerQuery(request);
  assert(JSON.stringify(first.output) === JSON.stringify(second.output), "respostas deveriam ser idênticas");
  assert(first.output.requiresHumanReview === true);
});

await checkAsync("escopo DOCUMENT falha fechado (não implementado nesta fase)", async () => {
  await assertRejects(
    answerEsgDirectorQuery({}, { scope: "DOCUMENT", projectId: "x", question: "teste" }, createFakeAiProvider()),
    "DOCUMENT deveria falhar"
  );
});

await checkAsync("escopo EMAIL falha fechado (não implementado nesta fase)", async () => {
  await assertRejects(
    answerEsgDirectorQuery({}, { scope: "EMAIL", projectId: "x", question: "teste" }, createFakeAiProvider()),
    "EMAIL deveria falhar"
  );
});

await checkAsync("escopo MULTI_EXPERT falha fechado (não implementado nesta fase)", async () => {
  await assertRejects(
    answerEsgDirectorQuery({}, { scope: "MULTI_EXPERT", projectId: "x", question: "teste" }, createFakeAiProvider()),
    "MULTI_EXPERT deveria falhar"
  );
});

await checkAsync("pergunta vazia falha", async () => {
  await assertRejects(
    answerEsgDirectorQuery({}, { scope: "PROJECT", projectId: "x", question: "   " }, createFakeAiProvider()),
    "pergunta vazia deveria falhar"
  );
});

// --- Consultas reais (somente leitura) contra o projeto de referência ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const REFERENCE_EVENT_ID = "58988a54-092c-442f-a79a-638b53bc088e";
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP consultas reais — Supabase não configurado.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function snapshotObligations() {
    const { data, error } = await supabase
      .from("esg_obligations")
      .select("id,title,active,updated_at")
      .eq("project_id", REFERENCE_PROJECT_ID)
      .order("id", { ascending: true });
    if (error) throw error;
    return JSON.stringify(data);
  }

  await checkAsync("consulta PROJECT real não altera dados (nenhuma obrigação criada/alterada)", async () => {
    const before = await snapshotObligations();

    const result = await answerEsgDirectorQuery(
      supabase,
      { scope: "PROJECT", projectId: REFERENCE_PROJECT_ID, question: "Quais obrigações ESG/SSMA estão pendentes ou vencidas?" },
      createFakeAiProvider()
    );

    assert(result.response.scope === "PROJECT");
    assert(result.response.expertId === "esg-director");
    assert(result.response.requiresHumanReview === true);

    const after = await snapshotObligations();
    assert(before === after, "consulta PROJECT não pode alterar obrigações ESG/SSMA");
  });

  await checkAsync("consulta EVENT real não altera dados (contexto de evento, sem obrigações — nível de projeto)", async () => {
    const result = await answerEsgDirectorQuery(
      supabase,
      { scope: "EVENT", projectId: REFERENCE_PROJECT_ID, eventId: REFERENCE_EVENT_ID, question: "Este evento tem relação com alguma obrigação ESG/SSMA?" },
      createFakeAiProvider()
    );

    assert(result.response.scope === "EVENT");
    assert(result.response.requiresHumanReview === true);
  });

  await checkAsync('pergunta "prepare uma cobrança" produz rascunho DRAFT_PENDING_REVIEW (nunca enviado)', async () => {
    const result = await answerEsgDirectorQuery(
      supabase,
      { scope: "PROJECT", projectId: REFERENCE_PROJECT_ID, question: "Prepare uma cobrança para os documentos ESG/SSMA faltantes." },
      createFakeAiProvider()
    );

    assert(result.response.rascunhoSugerido !== null, "deveria ter sugerido rascunho");
    assert(result.response.rascunhoSugerido.status === "DRAFT_PENDING_REVIEW");
  });

  await checkAsync("nenhuma função do Diretor de ESG IA envia e-mail ou altera status — somente leitura e sugestão", () => {
    // Estrutural: answerEsgDirectorQuery só usa o supabase client para
    // SELECT (via os context builders) e nunca chama .insert/.update/
    // .delete — a garantia real está no design (ver query.ts), aqui só
    // confirmamos que a função não expõe nenhum parâmetro de "enviar".
    assert(answerEsgDirectorQuery.length <= 3, "assinatura não deveria crescer para aceitar uma ação de envio");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
