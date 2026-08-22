// Testes da fundação genérica de AI Experts (apps/web/lib/ai/**), sem
// nenhum conhecimento de um Expert específico. Segue o padrão já usado em
// scripts/event-clause-confrontation-smoke.mjs: script Node puro, assert
// manual, throw em falha, resumo no final. Não há framework de teste
// configurado no projeto ainda — este script é o "test command" desta
// fundação.
//
// Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (mesmas variáveis
// dos demais scripts) apenas para o teste do context builder contra o
// evento de referência — todas as operações são leitura (SELECT), nenhum
// write é executado.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-ai-foundation.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { validateExpertAssessment, ExpertAssessmentValidationError } = await import(
  "../apps/web/lib/ai/schemas/validate-expert-assessment"
);
const { getAiProvider } = await import("../apps/web/lib/ai/providers/get-ai-provider");
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider");
const { buildEventAnalysisContext } = await import("../apps/web/lib/ai/context/build-event-context");

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

// Identidade fictícia genérica, só para exercitar o validador — não é um
// Expert real.
const identity = {
  expertId: "generic-test-expert",
  expertName: "Generic Test Expert",
  expertVersion: "v0",
};

function validAssessmentFixture() {
  return {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    analysisType: "RISK_ASSESSMENT",
    finding: {
      facts: ["Fato de teste."],
      interpretation: "Interpretação de teste.",
    },
    severity: "MEDIUM",
    confidence: 0.5,
    executiveSummary: "Resumo de teste.",
    contractualBasis: [
      {
        documentId: "doc-1",
        documentKind: "CONTRATO_BASE",
        clauseId: "clause-1",
        clauseNumber: "1",
        clauseTitle: "Cláusula de teste",
        excerpt: "Texto de teste.",
      },
    ],
    eventBasis: ["Evento de teste."],
    evidenceRefs: [{ sourceType: "CLAUSE", sourceId: "clause-1", label: "Cláusula 1", locator: "Documento X" }],
    possibleImpacts: [],
    recommendedActions: ["Revisar manualmente."],
    uncertainties: [],
    requiresHumanReview: true,
  };
}

console.log("");
console.log("======================================");
console.log("AI FOUNDATION — TESTES GENÉRICOS");
console.log("======================================");
console.log("");

check("schema aceita saída válida", () => {
  const result = validateExpertAssessment(validAssessmentFixture(), identity);
  assert(result.severity === "MEDIUM", "severity deveria ser preservada");
  assert(result.requiresHumanReview === true, "requiresHumanReview deveria ser true");
});

check("confidence fora de 0..1 falha (acima de 1)", () => {
  const fixture = validAssessmentFixture();
  fixture.confidence = 1.5;
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("confidence fora de 0..1 falha (negativa)", () => {
  const fixture = validAssessmentFixture();
  fixture.confidence = -0.1;
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("severity inválida (enum) falha", () => {
  const fixture = validAssessmentFixture();
  fixture.severity = "URGENTE";
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("analysisType inválido (enum) falha — sem saída textual livre disfarçada", () => {
  const fixture = validAssessmentFixture();
  fixture.analysisType = "QUALQUER_COISA";
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("requiresHumanReview não pode virar false", () => {
  const fixture = validAssessmentFixture();
  fixture.requiresHumanReview = false;
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("requiresHumanReview ausente também falha (nunca default silencioso)", () => {
  const fixture = validAssessmentFixture();
  delete fixture.requiresHumanReview;
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("evidenceRefs tipados (fontes/evidências) — sourceType inválido falha", () => {
  const fixture = validAssessmentFixture();
  fixture.evidenceRefs = [{ sourceType: "WHATSAPP", sourceId: "x", label: "y", locator: null }];
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("evidenceRefs tipados — sourceId ausente falha", () => {
  const fixture = validAssessmentFixture();
  fixture.evidenceRefs = [{ sourceType: "CLAUSE", label: "y", locator: null }];
  assertThrows(() => validateExpertAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("saída textual livre (string) é rejeitada", () => {
  assertThrows(() => validateExpertAssessment("apenas um texto livre", identity), ExpertAssessmentValidationError);
});

check("provider desconhecido falha fechado (nunca escolhe Anthropic/OpenAI/Gemini silenciosamente)", () => {
  const original = process.env.AXION_AI_PROVIDER;
  try {
    process.env.AXION_AI_PROVIDER = "anthropic";
    assertThrows(() => getAiProvider(), Error);
  } finally {
    if (original === undefined) delete process.env.AXION_AI_PROVIDER;
    else process.env.AXION_AI_PROVIDER = original;
  }
});

check("provider inválido/não reconhecido também falha fechado", () => {
  const original = process.env.AXION_AI_PROVIDER;
  try {
    process.env.AXION_AI_PROVIDER = "algo-nao-suportado";
    assertThrows(() => getAiProvider(), Error);
  } finally {
    if (original === undefined) delete process.env.AXION_AI_PROVIDER;
    else process.env.AXION_AI_PROVIDER = original;
  }
});

check("AXION_AI_PROVIDER=fake (ou ausente) resolve para o fake provider", () => {
  const original = process.env.AXION_AI_PROVIDER;
  try {
    delete process.env.AXION_AI_PROVIDER;
    const provider = getAiProvider();
    assert(provider.id === "fake", "default deveria ser o fake provider");
  } finally {
    if (original === undefined) delete process.env.AXION_AI_PROVIDER;
    else process.env.AXION_AI_PROVIDER = original;
  }
});

const fixtureContext = {
  projectId: "proj-1",
  eventId: "evt-1",
  focusCandidateId: null,
  event: {
    id: "evt-1",
    projectId: "proj-1",
    title: "Evento de teste",
    description: "Descrição de teste para determinismo.",
    occurredAt: "2026-01-01T00:00:00Z",
    sourceType: "EMAIL",
    status: "NOVO",
  },
  evidence: [
    { id: "ev-1", sourceType: "EMAIL", label: "E-mail de teste", locator: "gmail://x", emailId: "email-1", documentVersionId: null },
  ],
  relatedClauses: [
    {
      id: "clause-1",
      clauseNumber: "3",
      title: "Cláusula de teste",
      text: "Texto contratual de teste.",
      documentId: "doc-1",
      documentKind: "CONTRATO_BASE",
      documentTitle: "Contrato de teste",
      relation: "CROSS_REFERENCE",
    },
  ],
  relatedEmails: [],
  confrontationCandidates: [],
  eventNotes: [],
};

await checkAsync("fake provider é genérico — nunca hardcoda identidade de um Expert específico", async () => {
  const provider = createFakeAiProvider();
  const request = {
    expertId: "any-future-expert",
    expertName: "Qualquer Expert Futuro",
    expertVersion: "v9",
    instructions: "instruções de teste",
    analysisType: "RISK_ASSESSMENT",
    context: fixtureContext,
  };

  const response = await provider.generateAssessment(request);
  assert(response.output.expertId === "any-future-expert", "fake provider deve ecoar expertId da requisição, nunca hardcodar");
  assert(response.output.expertName === "Qualquer Expert Futuro", "fake provider deve ecoar expertName da requisição");
  assert(response.output.analysisType === "RISK_ASSESSMENT", "fake provider deve ecoar analysisType da requisição");
});

await checkAsync("fake provider produz output determinístico (mesma entrada -> mesma saída)", async () => {
  const provider = createFakeAiProvider();
  const request = {
    expertId: "generic-test-expert",
    expertName: "Generic Test Expert",
    expertVersion: "v0",
    instructions: "instruções de teste",
    analysisType: "RISK_ASSESSMENT",
    context: fixtureContext,
  };

  const first = await provider.generateAssessment(request);
  const second = await provider.generateAssessment(request);

  assert(JSON.stringify(first.output) === JSON.stringify(second.output), "saídas do fake provider deveriam ser idênticas");

  const validated = validateExpertAssessment(first.output, identity);
  assert(validated.requiresHumanReview === true, "fake provider deve sempre marcar requiresHumanReview true");
});

// --- Teste do context builder contra o evento de referência real ---
// Somente leitura: nenhum write é executado. Requer Supabase configurado.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const REFERENCE_EVENT_ID = "58988a54-092c-442f-a79a-638b53bc088e";
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes do context builder — NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY não configurados.");
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

  await checkAsync("context builder monta o evento de referência sem alterar dados (somente leitura)", async () => {
    const before = await snapshotCandidates();

    const context = await buildEventAnalysisContext(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      eventId: REFERENCE_EVENT_ID,
    });

    assert(context.event.id === REFERENCE_EVENT_ID, "context.event.id deveria ser o evento de referência");
    assert(context.relatedClauses.length >= 1, "deveria haver ao menos uma cláusula relacionada");
    assert(context.confrontationCandidates.length === 3, "deveria haver os 3 candidatos conhecidos do evento de referência");

    const after = await snapshotCandidates();
    assert(before === after, "candidatos não podem ser alterados por montar o contexto (somente leitura)");
  });

  await checkAsync("context builder restrito a um candidateId não altera dados e reduz o contexto", async () => {
    const before = await snapshotCandidates();

    const context = await buildEventAnalysisContext(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      eventId: REFERENCE_EVENT_ID,
      candidateId: "cf375b5c-c18e-42f4-9337-ec48ecbf4306",
    });

    assert(context.confrontationCandidates.length === 1, "modo restrito deveria conter só 1 candidato");
    assert(context.relatedClauses.length === 1, "modo restrito deveria conter só 1 cláusula");
    assert(context.focusCandidateId === "cf375b5c-c18e-42f4-9337-ec48ecbf4306", "focusCandidateId deveria refletir o candidato pedido");

    const after = await snapshotCandidates();
    assert(before === after, "candidatos não podem ser alterados por montar o contexto restrito (somente leitura)");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
