// Testes específicos do Diretor Comercial IA (commercial-director).
// Testes genéricos da fundação ficam em scripts/test-ai-foundation.mjs —
// este arquivo só cobre o que é específico deste Expert: schema de
// negociação, ausência de dado econômico inventado, draftCommunication
// como sugestão (nunca envio), e o harness real contra o evento de
// referência.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-commercial-director-expert.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { ExpertAssessmentValidationError } = await import("../apps/web/lib/ai/schemas/validate-expert-assessment");
const { validateCommercialDirectorAssessment } = await import(
  "../apps/web/lib/ai/experts/commercial-director/schema"
);
const {
  COMMERCIAL_DIRECTOR_EXPERT_ID,
  COMMERCIAL_DIRECTOR_NAME,
  COMMERCIAL_DIRECTOR_VERSION,
  runCommercialDirectorExpert,
} = await import("../apps/web/lib/ai/experts/commercial-director/index");
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

const identity = {
  expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
  expertName: COMMERCIAL_DIRECTOR_NAME,
  expertVersion: COMMERCIAL_DIRECTOR_VERSION,
};

function validNegotiationFixture() {
  return {
    negotiationObjective: null,
    currentPosition: null,
    targetPosition: null,
    minimumAcceptablePosition: { status: "REQUIRES_HUMAN_DEFINITION", value: null, basis: null },
    nonNegotiableItems: [],
    negotiableItems: [],
    possibleConcessions: [],
    requiredCounterparts: ["cliente@exemplo.com"],
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

function validAssessmentFixture() {
  return {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    analysisType: "COMMERCIAL_NEGOTIATION_STRATEGY",
    finding: { facts: ["Fato de teste."], interpretation: "Interpretação de teste." },
    severity: "MEDIUM",
    confidence: 0.5,
    executiveSummary: "Resumo de teste.",
    contractualBasis: [],
    eventBasis: ["Evento de teste."],
    evidenceRefs: [],
    possibleImpacts: [],
    recommendedActions: [],
    uncertainties: [],
    requiresHumanReview: true,
    negotiation: validNegotiationFixture(),
  };
}

console.log("");
console.log("======================================");
console.log("DIRETOR COMERCIAL IA — TESTES ESPECÍFICOS");
console.log("======================================");
console.log("");

check("schema do Diretor Comercial IA aceita saída válida (genérico + negotiation)", () => {
  const result = validateCommercialDirectorAssessment(validAssessmentFixture(), identity);
  assert(result.negotiation.minimumAcceptablePosition.status === "REQUIRES_HUMAN_DEFINITION");
  assert(result.requiresHumanReview === true);
});

check("negotiation ausente falha", () => {
  const fixture = validAssessmentFixture();
  delete fixture.negotiation;
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("minimumAcceptablePosition com status AVAILABLE mas sem basis falha (nunca valor sem fundamento)", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.minimumAcceptablePosition = { status: "AVAILABLE", value: "R$ 100.000", basis: null };
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("minimumAcceptablePosition com status UNAVAILABLE mas com value preenchido falha (nunca inventar)", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.minimumAcceptablePosition = { status: "UNAVAILABLE", value: "R$ 100.000", basis: null };
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("minimumAcceptablePosition com status desconhecido falha", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.minimumAcceptablePosition = { status: "ESTIMATED", value: "R$ 100.000", basis: "chute" };
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("financialImpact com estimatedValue preenchido mas status UNAVAILABLE falha (nunca número inventado)", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.financialImpact = {
    category: "FINANCIAL",
    status: "UNAVAILABLE",
    description: null,
    estimatedValue: 50000,
    basis: null,
  };
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("financialImpact com category errada falha (impossível trocar financeiro por prazo)", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.financialImpact.category = "SCHEDULE";
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("draftCommunication com status diferente de DRAFT_PENDING_REVIEW falha (nunca marcado como enviado)", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.draftCommunication = {
    type: "EMAIL",
    subject: "Assunto",
    body: "Corpo do e-mail.",
    status: "SENT",
  };
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("draftCommunication válido (DRAFT_PENDING_REVIEW) é aceito", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.draftCommunication = {
    type: "EMAIL",
    subject: "Assunto",
    body: "Corpo do e-mail.",
    status: "DRAFT_PENDING_REVIEW",
  };
  const result = validateCommercialDirectorAssessment(fixture, identity);
  assert(result.negotiation.draftCommunication.status === "DRAFT_PENDING_REVIEW");
});

check("draftCommunication com type desconhecido falha", () => {
  const fixture = validAssessmentFixture();
  fixture.negotiation.draftCommunication = {
    type: "WHATSAPP",
    subject: null,
    body: "Corpo.",
    status: "DRAFT_PENDING_REVIEW",
  };
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

check("expertId inesperado (ex.: contract-lawyer removido) é rejeitado pelo schema", () => {
  const fixture = validAssessmentFixture();
  fixture.expertId = "contract-lawyer";
  assertThrows(() => validateCommercialDirectorAssessment(fixture, identity), ExpertAssessmentValidationError);
});

// --- Harness real contra o evento de referência (somente leitura) ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const REFERENCE_EVENT_ID = "58988a54-092c-442f-a79a-638b53bc088e";
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes contra o evento de referência — Supabase não configurado.");
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

  await checkAsync(
    "runCommercialDirectorExpert produz saída válida para o evento de referência, sem alterar dados",
    async () => {
      const before = await snapshotCandidates();

      const context = await buildEventAnalysisContext(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        eventId: REFERENCE_EVENT_ID,
      });

      const result = await runCommercialDirectorExpert(context);

      assert(result.assessment.expertId === "commercial-director", "expertId deveria ser commercial-director");
      assert(result.assessment.requiresHumanReview === true);
      assert(
        result.assessment.negotiation.minimumAcceptablePosition.status === "REQUIRES_HUMAN_DEFINITION",
        "fake provider nunca deve inventar minimumAcceptablePosition"
      );
      assert(
        result.assessment.negotiation.financialImpact.estimatedValue === null,
        "fake provider nunca deve inventar estimatedValue financeiro"
      );
      assert(
        result.assessment.negotiation.draftCommunication.status === "DRAFT_PENDING_REVIEW",
        "draftCommunication deve permanecer sugestão — nunca enviado"
      );

      const after = await snapshotCandidates();
      assert(before === after, "rodar o Expert não pode alterar nenhum candidato (somente leitura, nenhuma ação automática)");
    }
  );

  await checkAsync("runCommercialDirectorExpert restrito a um candidateId também não altera dados", async () => {
    const before = await snapshotCandidates();

    const context = await buildEventAnalysisContext(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      eventId: REFERENCE_EVENT_ID,
      candidateId: "cf375b5c-c18e-42f4-9337-ec48ecbf4306",
    });

    const result = await runCommercialDirectorExpert(context);
    assert(result.audit.focusCandidateId === "cf375b5c-c18e-42f4-9337-ec48ecbf4306");

    const after = await snapshotCandidates();
    assert(before === after, "modo restrito também não pode alterar candidatos");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
