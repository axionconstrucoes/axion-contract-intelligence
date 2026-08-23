// Testes da consulta conversacional aos Experts (ExpertQueryResponse,
// answerCommercialDirectorQuery). Segue o padrão dos demais testes do
// projeto: script Node puro, assert manual, throw em falha.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-expert-query.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { validateExpertQueryResponse, ExpertQueryValidationError } = await import(
  "../apps/web/lib/ai/query/validate-expert-query-response"
);
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider");
const {
  COMMERCIAL_DIRECTOR_EXPERT_ID,
  COMMERCIAL_DIRECTOR_NAME,
  COMMERCIAL_DIRECTOR_VERSION,
} = await import("../apps/web/lib/ai/experts/commercial-director/identity");
const { answerCommercialDirectorQuery } = await import("../apps/web/lib/ai/experts/commercial-director/query");

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
  expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
  expertName: COMMERCIAL_DIRECTOR_NAME,
  expertVersion: COMMERCIAL_DIRECTOR_VERSION,
};

function validResponseFixture() {
  return {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    scope: "EVENT",
    question: "Pergunta de teste?",
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
console.log("CONSULTA CONVERSACIONAL AOS EXPERTS — TESTES");
console.log("======================================");
console.log("");

check("schema de resposta aceita saída válida", () => {
  const result = validateExpertQueryResponse(validResponseFixture(), identity);
  assert(result.requiresHumanReview === true);
});

check("requiresHumanReview=false é rejeitado", () => {
  const fixture = validResponseFixture();
  fixture.requiresHumanReview = false;
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("confidence fora de 0..1 falha", () => {
  const fixture = validResponseFixture();
  fixture.confidence = 2;
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("scope inválido falha", () => {
  const fixture = validResponseFixture();
  fixture.scope = "GALAXY";
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("contextoInternoDeclarado com status diferente de DECLARED_CONTEXT falha (nunca vira fato confirmado)", () => {
  const fixture = validResponseFixture();
  fixture.contextoInternoDeclarado = [
    { noteId: "n1", category: "OUTROS", text: "x", author: "y", createdAt: "2026-01-01", status: "CONFIRMED_FACT" },
  ];
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("praticasNegociais com kind inválido falha (nunca prática negocial vira obrigação sem classificação)", () => {
  const fixture = validResponseFixture();
  fixture.praticasNegociais = [{ kind: "MORAL_OBLIGATION", statement: "x" }];
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("praticasNegociais com kind válido (NEGOTIATION_PRACTICE) é aceito", () => {
  const fixture = validResponseFixture();
  fixture.praticasNegociais = [{ kind: "NEGOTIATION_PRACTICE", statement: "Prática comum de mercado." }];
  const result = validateExpertQueryResponse(fixture, identity);
  assert(result.praticasNegociais[0].kind === "NEGOTIATION_PRACTICE");
});

check("rascunhoSugerido com status diferente de DRAFT_PENDING_REVIEW falha (draft permanece PENDING_REVIEW)", () => {
  const fixture = validResponseFixture();
  fixture.rascunhoSugerido = { type: "EMAIL", subject: "x", body: "y", status: "SENT" };
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

check("rascunhoSugerido válido (DRAFT_PENDING_REVIEW) é aceito", () => {
  const fixture = validResponseFixture();
  fixture.rascunhoSugerido = { type: "EMAIL", subject: "x", body: "y", status: "DRAFT_PENDING_REVIEW" };
  const result = validateExpertQueryResponse(fixture, identity);
  assert(result.rascunhoSugerido.status === "DRAFT_PENDING_REVIEW");
});

check("baseLegal vazio é aceito — ausência de corpus não gera artigo fictício", () => {
  const fixture = validResponseFixture();
  fixture.baseLegal = [];
  const result = validateExpertQueryResponse(fixture, identity);
  assert(result.baseLegal.length === 0);
});

check("baseLegal com origem legal desconhecida falha (nunca inventar fonte normativa)", () => {
  const fixture = validResponseFixture();
  fixture.baseLegal = [
    {
      source: {
        norma: "Lei Inventada",
        fonte: "x",
        origem: "LEI_INVENTADA",
        versaoVigencia: "x",
        dispositivo: "Art. 1",
        referencia: "x",
      },
      relationToAnalysis: "x",
    },
  ];
  assertThrows(() => validateExpertQueryResponse(fixture, identity), ExpertQueryValidationError);
});

await checkAsync("fake provider (answerQuery) é determinístico", async () => {
  const provider = createFakeAiProvider();
  const request = {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    instructions: "instruções de teste",
    scope: "PROJECT",
    question: "Pergunta de teste?",
    eventContext: null,
    projectContext: {
      projectId: "proj-1",
      project: { id: "proj-1", name: "Projeto de teste", client: "Cliente", status: "ATIVO", contractNumber: null },
      events: [],
      eventsTotalCount: 0,
    },
  };

  const first = await provider.answerQuery(request);
  const second = await provider.answerQuery(request);
  assert(JSON.stringify(first.output) === JSON.stringify(second.output), "respostas deveriam ser idênticas");
  assert(first.output.requiresHumanReview === true);
});

await checkAsync("escopo DOCUMENT falha fechado (não implementado nesta fase)", async () => {
  await assertRejects(
    answerCommercialDirectorQuery({}, { scope: "DOCUMENT", projectId: "x", question: "teste" }, createFakeAiProvider()),
    "DOCUMENT deveria falhar"
  );
});

await checkAsync("escopo EMAIL falha fechado (não implementado nesta fase)", async () => {
  await assertRejects(
    answerCommercialDirectorQuery({}, { scope: "EMAIL", projectId: "x", question: "teste" }, createFakeAiProvider()),
    "EMAIL deveria falhar"
  );
});

await checkAsync("escopo MULTI_EXPERT falha fechado (não implementado nesta fase)", async () => {
  await assertRejects(
    answerCommercialDirectorQuery({}, { scope: "MULTI_EXPERT", projectId: "x", question: "teste" }, createFakeAiProvider()),
    "MULTI_EXPERT deveria falhar"
  );
});

await checkAsync("pergunta vazia falha", async () => {
  await assertRejects(
    answerCommercialDirectorQuery({}, { scope: "PROJECT", projectId: "x", question: "   " }, createFakeAiProvider()),
    "pergunta vazia deveria falhar"
  );
});

// --- Consultas reais (somente leitura) contra o evento/projeto de referência ---
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

  async function snapshotCandidates() {
    const { data, error } = await supabase
      .from("event_clause_confrontation_candidates")
      .select("id,status,review_note,reviewed_at,updated_at")
      .eq("event_id", REFERENCE_EVENT_ID)
      .order("id", { ascending: true });
    if (error) throw error;
    return JSON.stringify(data);
  }

  await checkAsync("consulta PROJECT real não altera dados", async () => {
    const before = await snapshotCandidates();

    const result = await answerCommercialDirectorQuery(
      supabase,
      { scope: "PROJECT", projectId: REFERENCE_PROJECT_ID, question: "Quais são os principais riscos comerciais deste projeto?" },
      createFakeAiProvider()
    );

    assert(result.response.scope === "PROJECT");
    assert(result.response.requiresHumanReview === true);

    const after = await snapshotCandidates();
    assert(before === after, "consulta PROJECT não pode alterar candidatos");
  });

  await checkAsync("consulta EVENT real não altera dados e reconhece USER_NOTE quando existir", async () => {
    const before = await snapshotCandidates();

    const result = await answerCommercialDirectorQuery(
      supabase,
      { scope: "EVENT", projectId: REFERENCE_PROJECT_ID, eventId: REFERENCE_EVENT_ID, question: "Quais informações ainda faltam para tomarmos uma decisão?" },
      createFakeAiProvider()
    );

    assert(result.response.scope === "EVENT");
    assert(result.response.requiresHumanReview === true);
    assert(Array.isArray(result.response.contextoInternoDeclarado), "contextoInternoDeclarado deve ser array mesmo vazio");

    const after = await snapshotCandidates();
    assert(before === after, "consulta EVENT não pode alterar candidatos");
  });

  await checkAsync('pergunta "redija um e-mail" produz rascunho DRAFT_PENDING_REVIEW (nunca enviado)', async () => {
    const result = await answerCommercialDirectorQuery(
      supabase,
      { scope: "EVENT", projectId: REFERENCE_PROJECT_ID, eventId: REFERENCE_EVENT_ID, question: "Redija um e-mail ao cliente sobre este aditivo." },
      createFakeAiProvider()
    );

    assert(result.response.rascunhoSugerido !== null, "deveria ter sugerido rascunho");
    assert(result.response.rascunhoSugerido.status === "DRAFT_PENDING_REVIEW");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
