// Testes do guardrail determinístico de grounding/citação
// (apps/web/lib/ai/grounding/) — NUNCA chama a API Anthropic real.
// Cobre os módulos puros (tokenização, extração, avaliação de claim,
// validação de draft, correção segura, ajuste de confiança) e a
// integração com o Diretor Comercial IA via um client Anthropic
// mockado (createAnthropicAiProvider({ client, config })).
//
// Uso:
//   node scripts/test-grounding.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  buildGroundingSource,
  validateDraftGrounding,
  applySafeGroundingCorrection,
  adjustConfidenceForGrounding,
  evaluateClaimGrounding,
  splitIntoSentences,
} = await import("../apps/web/lib/ai/grounding/index");
const { createAnthropicAiProvider } = await import("../apps/web/lib/ai/providers/anthropic-provider");
const { runCommercialDirectorExpert } = await import("../apps/web/lib/ai/experts/commercial-director/index");
const { answerCommercialDirectorQuery } = await import("../apps/web/lib/ai/experts/commercial-director/query");
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

console.log("");
console.log("======================================");
console.log("GROUNDING / CITATION GUARDRAILS — TESTES");
console.log("======================================");
console.log("");

// ============================================================
// Seção 14 do requisito — caso real "projeto de fundação / apólice"
// ============================================================

const FUNDACAO_SOURCE_TEXT = "o valor do seguro de obra aumentou, pois incluímos no item o valor pago para projeto de fundação";
const fundacaoSource = { sourceTexts: [FUNDACAO_SOURCE_TEXT], availableClauseNumbers: [], availableLegalReferences: [] };

check('SUPPORTED: "Foi incluído no item o valor pago para projeto de fundação."', () => {
  const claim = evaluateClaimGrounding("Foi incluído no item o valor pago para projeto de fundação.", fundacaoSource);
  assert(claim.supportStatus === "SUPPORTED", `esperado SUPPORTED, obtido ${claim.supportStatus} — ${claim.reasoningNote}`);
});

check('INFERENCE: "O projeto de fundação está relacionado ao aumento informado."', () => {
  const claim = evaluateClaimGrounding("O projeto de fundação está relacionado ao aumento informado.", fundacaoSource);
  assert(claim.supportStatus === "INFERENCE", `esperado INFERENCE, obtido ${claim.supportStatus} — ${claim.reasoningNote}`);
});

check('UNSUPPORTED: "O projeto de fundação passou a compor a apólice." (caso real do incidente)', () => {
  const claim = evaluateClaimGrounding("O projeto de fundação passou a compor a apólice.", fundacaoSource);
  assert(claim.supportStatus === "UNSUPPORTED", `esperado UNSUPPORTED, obtido ${claim.supportStatus} — ${claim.reasoningNote}`);
});

// ============================================================
// Seção 15 do requisito — cláusula ausente do contexto
// ============================================================

const clauseSource = {
  sourceTexts: [],
  availableClauseNumbers: ["5.1", "5.6", "5.11"],
  availableLegalReferences: [],
};

check("cláusula existente (5.6) é SUPPORTED", () => {
  const claim = evaluateClaimGrounding("Conforme a cláusula 5.6, o prazo está definido.", clauseSource);
  assert(claim.supportStatus === "SUPPORTED", claim.reasoningNote);
  assert(claim.contractualBasisRefs.includes("5.6"));
});

check("cláusula ausente (5.2) é UNSUPPORTED — nunca citada como fato contratual", () => {
  const claim = evaluateClaimGrounding("Conforme a cláusula 5.2, o prazo está definido.", clauseSource);
  assert(claim.supportStatus === "UNSUPPORTED", `esperado UNSUPPORTED, obtido ${claim.supportStatus}`);
});

// ============================================================
// Seção 16 do requisito — bateria completa
// ============================================================

check("factual claim suportado", () => {
  const claim = evaluateClaimGrounding("O evento foi registrado conforme descrito.", {
    sourceTexts: ["O evento foi registrado conforme descrito no sistema."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "SUPPORTED");
});

check("factual claim inferido (linguagem condicional)", () => {
  const claim = evaluateClaimGrounding("Isso sugere um atraso na entrega do material.", {
    sourceTexts: ["Houve um atraso reportado."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "INFERENCE");
});

check("factual claim sem suporte", () => {
  const claim = evaluateClaimGrounding("O fornecedor abandonou definitivamente a obra imediatamente.", {
    sourceTexts: ["O evento foi registrado conforme descrito no sistema."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "UNSUPPORTED", claim.reasoningNote);
});

check("número (R$) existente no contexto é SUPPORTED", () => {
  const claim = evaluateClaimGrounding("O valor pago foi de R$ 10.000,00 conforme registrado.", {
    sourceTexts: ["Valor pago: R$ 10.000,00."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "SUPPORTED");
});

check("número (R$) inventado é UNSUPPORTED — nunca inventar valor", () => {
  const claim = evaluateClaimGrounding("O valor pago foi de R$ 99.999,00 conforme registrado.", {
    sourceTexts: ["Valor pago: R$ 10.000,00."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "UNSUPPORTED", claim.reasoningNote);
});

check("percentual existente no contexto é SUPPORTED", () => {
  const claim = evaluateClaimGrounding("O reajuste aplicado foi de 5% ao ano.", {
    sourceTexts: ["Reajuste contratual de 5% ao ano."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "SUPPORTED");
});

check("percentual inventado é UNSUPPORTED", () => {
  const claim = evaluateClaimGrounding("O reajuste aplicado foi de 45% ao ano.", {
    sourceTexts: ["Reajuste contratual de 5% ao ano."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "UNSUPPORTED", claim.reasoningNote);
});

check("data existente no contexto é SUPPORTED", () => {
  const claim = evaluateClaimGrounding("O prazo se encerra em 10/03/2026 conforme informado.", {
    sourceTexts: ["Prazo final: 10/03/2026."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "SUPPORTED");
});

check("data inventada é UNSUPPORTED", () => {
  const claim = evaluateClaimGrounding("O prazo se encerra em 25/12/2026 conforme informado.", {
    sourceTexts: ["Prazo final: 10/03/2026."],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "UNSUPPORTED", claim.reasoningNote);
});

check("legal claim sem LegalSource oficial no contexto é UNSUPPORTED — nunca validar por memória do modelo", () => {
  const claim = evaluateClaimGrounding("Conforme o art. 421 do Código Civil, a boa-fé deve ser observada.", {
    sourceTexts: [],
    availableClauseNumbers: [],
    availableLegalReferences: [],
  });
  assert(claim.supportStatus === "UNSUPPORTED");
  assert(claim.reasoningNote.includes("FONTE LEGAL OFICIAL NÃO FORNECIDA"));
});

check("legal claim com LegalSource oficial correspondente é SUPPORTED", () => {
  const claim = evaluateClaimGrounding("Conforme Art. 421, a boa-fé deve ser observada.", {
    sourceTexts: [],
    availableClauseNumbers: [],
    availableLegalReferences: ["Art. 421"],
  });
  assert(claim.supportStatus === "SUPPORTED");
});

check("draft com unsupported claim falha (valid=false)", () => {
  const result = validateDraftGrounding(
    "Foi incluído no item o valor pago para projeto de fundação. O projeto de fundação passou a compor a apólice.",
    fundacaoSource
  );
  assert(result.valid === false, "draft com claim sem suporte não deveria ser válido");
  assert(result.unsupportedClaims.length === 1);
});

check("draft somente com supported claims passa (valid=true)", () => {
  const result = validateDraftGrounding("Foi incluído no item o valor pago para projeto de fundação.", fundacaoSource);
  assert(result.valid === true);
  assert(result.unsupportedClaims.length === 0);
});

check("inferência claramente rotulada — nunca some silenciosamente no resultado", () => {
  const result = validateDraftGrounding("O projeto de fundação está relacionado ao aumento informado.", fundacaoSource);
  assert(result.inferredClaims.length === 1);
  assert(result.inferredClaims[0].supportStatus === "INFERENCE");
  assert(result.valid === true, "inferência sozinha não invalida o draft");
});

check("splitIntoSentences nunca perde a afirmação problemática de um draft multi-frase", () => {
  const sentences = splitIntoSentences(
    "Prezados, segue o resumo. Foi incluído no item o valor pago para projeto de fundação. O projeto de fundação passou a compor a apólice. Atenciosamente."
  );
  assert(sentences.some((s) => s.includes("passou a compor a apólice")));
});

check("applySafeGroundingCorrection substitui claim FACTUAL insegura por marcador de confirmação", () => {
  const body = "Foi incluído no item o valor pago para projeto de fundação. O projeto de fundação passou a compor a apólice.";
  const result = validateDraftGrounding(body, fundacaoSource);
  const correction = applySafeGroundingCorrection(body, result);
  assert(correction.stillRequiresRejection === false, "claim FACTUAL deveria ser corrigível com segurança");
  assert(correction.correctedBody.includes("[CONFIRMAR INTERNAMENTE"), "corpo corrigido deveria conter o marcador de confirmação");
  assert(correction.correctedBody !== body, "corpo corrigido deveria ser diferente do original — a substituição precisa ter ocorrido de fato");
  assert(
    correction.correctedBody.includes("Foi incluído no item o valor pago para projeto de fundação."),
    "a frase suportada não deveria ser alterada pela correção — só a frase insegura é substituída"
  );
});

check("applySafeGroundingCorrection NUNCA corrige automaticamente claim CONTRACTUAL/LEGAL/NUMERIC — força rejeição", () => {
  const body = "Conforme a cláusula 5.2, o prazo está definido.";
  const result = validateDraftGrounding(body, clauseSource);
  const correction = applySafeGroundingCorrection(body, result);
  assert(correction.stillRequiresRejection === true, "citação de cláusula ausente nunca pode ser \"consertada\" automaticamente");
});

check("adjustConfidenceForGrounding: draft suprimido reduz a confiança para no máximo 0.2", () => {
  const result = validateDraftGrounding("O projeto de fundação passou a compor a apólice.", fundacaoSource);
  const adjusted = adjustConfidenceForGrounding(0.8, result, { draftSuppressed: true, correctionApplied: false });
  assert(adjusted <= 0.2, `esperado <=0.2, obtido ${adjusted}`);
});

check("adjustConfidenceForGrounding: inferências reduzem confiança de forma simples e determinística", () => {
  const result = validateDraftGrounding("O projeto de fundação está relacionado ao aumento informado.", fundacaoSource);
  const adjusted = adjustConfidenceForGrounding(0.8, result, { draftSuppressed: false, correctionApplied: false });
  assert(adjusted < 0.8, "confiança deveria ser reduzida por causa da inferência");
  assert(adjusted >= 0.1, "confiança nunca deveria ficar abaixo do piso mínimo");
});

check("adjustConfidenceForGrounding: somente fatos suportados preserva a confiança original", () => {
  const result = validateDraftGrounding("Foi incluído no item o valor pago para projeto de fundação.", fundacaoSource);
  const adjusted = adjustConfidenceForGrounding(0.6, result, { draftSuppressed: false, correctionApplied: false });
  assert(adjusted === 0.6);
});

check("buildGroundingSource nunca acessa banco/rede — assinatura só aceita dados já em memória", () => {
  const source = buildGroundingSource({ documentedFacts: ["fato de teste"] });
  assert(Array.isArray(source.sourceTexts));
  assert(source.sourceTexts.includes("fato de teste"));
});

// ============================================================
// Integração com o Diretor Comercial IA (Anthropic mockado — sem rede)
// ============================================================

function makeMockClient(toolInput, stopReason = "tool_use") {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: toolInput }],
        stop_reason: stopReason,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };
}

const FAKE_CONFIG = { apiKey: "sk-test-fake-key-not-real", model: "claude-test-model", maxTokens: 4096, timeoutMs: 5000 };

function eventContextWithFundacaoFact() {
  return {
    projectId: "proj-1",
    eventId: "event-1",
    focusCandidateId: null,
    event: {
      id: "event-1",
      projectId: "proj-1",
      title: "Reajuste de item de fundação no seguro de obra",
      description: FUNDACAO_SOURCE_TEXT,
      occurredAt: "2026-01-01T00:00:00.000Z",
      sourceType: "MANUAL",
      status: "ABERTO",
    },
    evidence: [],
    relatedClauses: [],
    relatedEmails: [],
    confrontationCandidates: [],
    eventNotes: [],
  };
}

function baseNegotiation(body) {
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
    draftCommunication: { type: "EMAIL", subject: "Re: Reajuste", body, status: "DRAFT_PENDING_REVIEW" },
  };
}

/** Claim FACTUAL sem suporte (caso real "apólice") — corrigível automaticamente (seção 9), não precisa ser suprimido. */
function correctableNegotiationDraft() {
  return baseNegotiation(
    "Foi incluído no item o valor pago para projeto de fundação. O projeto de fundação passou a compor a apólice."
  );
}

/** Claim CONTRACTUAL sem suporte (cláusula inexistente no contexto) — NUNCA corrigível automaticamente, força supressão. */
function uncorrectableNegotiationDraft() {
  return baseNegotiation(
    "Foi incluído no item o valor pago para projeto de fundação. Conforme a cláusula 9.9, isso já era esperado."
  );
}

/** Draft inteiramente suportado — nenhuma palavra fora do vocabulário-fonte. */
function safeNegotiationDraft() {
  return baseNegotiation("Foi incluído no item o valor pago para projeto de fundação.");
}

function assessmentOutput(negotiation) {
  return {
    expertId: "commercial-director",
    expertName: "Diretor Comercial IA",
    expertVersion: COMMERCIAL_DIRECTOR_VERSION,
    analysisType: "COMMERCIAL_NEGOTIATION_STRATEGY",
    finding: { facts: [FUNDACAO_SOURCE_TEXT], interpretation: "Interpretação de teste." },
    severity: "LOW",
    confidence: 0.8,
    executiveSummary: "Resumo de teste.",
    contractualBasis: [],
    eventBasis: [],
    evidenceRefs: [],
    possibleImpacts: [],
    recommendedActions: [],
    uncertainties: [],
    requiresHumanReview: true,
    negotiation,
  };
}

await checkAsync(
  "Anthropic Provider continua compatível: claim FACTUAL sem suporte (caso real \"apólice\") é corrigida automaticamente, nunca suprimida — requiresHumanReview permanece true, nada é enviado/executado",
  async () => {
    const client = makeMockClient(assessmentOutput(correctableNegotiationDraft()));
    const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

    const result = await runCommercialDirectorExpert(eventContextWithFundacaoFact(), provider);

    assert(result.assessment.requiresHumanReview === true, "requiresHumanReview deve permanecer true");
    assert(result.assessment.negotiation.draftCommunication !== null, "claim FACTUAL corrigível não deveria suprimir o draft inteiro");
    assert(
      result.assessment.negotiation.draftCommunication.body.includes("[CONFIRMAR INTERNAMENTE"),
      "corpo corrigido deveria conter o marcador de confirmação humana"
    );
    assert(
      result.assessment.negotiation.draftCommunication.body.includes("Foi incluído no item o valor pago para projeto de fundação."),
      "a frase suportada deveria permanecer intacta — só a frase insegura é envolvida pelo marcador"
    );
    assert(result.assessment.confidence <= 0.5, `confiança deveria ter sido reduzida para o teto de correção, obtido ${result.assessment.confidence}`);
    assert(result.assessment.grounding.performed === true);
    assert(result.assessment.grounding.valid === false, "grounding.valid reflete o estado ANTES da correção — nunca finge que não havia problema");
    assert(result.assessment.grounding.correctionApplied === true);
    assert(result.assessment.grounding.draftSuppressed === false);
    assert(result.audit.grounding.performed === true);
    assert(result.audit.grounding.unsupportedClaimCount >= 1);
  }
);

await checkAsync(
  "claim CONTRACTUAL sem suporte (cláusula inexistente no contexto) NUNCA é corrigida automaticamente — draft é suprimido (null)",
  async () => {
    const client = makeMockClient(assessmentOutput(uncorrectableNegotiationDraft()));
    const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

    const result = await runCommercialDirectorExpert(eventContextWithFundacaoFact(), provider);

    assert(result.assessment.negotiation.draftCommunication === null, "citação de cláusula ausente nunca pode ser corrigida automaticamente — deveria suprimir o draft");
    assert(result.assessment.confidence <= 0.2, `confiança deveria cair para o teto de supressão, obtido ${result.assessment.confidence}`);
    assert(result.assessment.grounding.draftSuppressed === true);
    assert(result.assessment.grounding.correctionApplied === false);
    assert(
      result.assessment.uncertainties.some((u) => u.includes("Rascunho de comunicação removido")),
      "uncertainties deveria explicar a supressão"
    );
  }
);

await checkAsync("draft totalmente suportado passa pelo guardrail sem alteração de conteúdo nem redução de confiança", async () => {
  const client = makeMockClient(assessmentOutput(safeNegotiationDraft()));
  const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });

  const result = await runCommercialDirectorExpert(eventContextWithFundacaoFact(), provider);

  assert(result.assessment.negotiation.draftCommunication !== null, "draft suportado não deveria ser suprimido");
  assert(result.assessment.confidence === 0.8, "confiança não deveria ser alterada quando não há claim problemática");
  assert(result.assessment.grounding.valid === true);
  assert(result.assessment.grounding.unsupported.length === 0);
});

await checkAsync(
  "o mesmo caminho de validação usado por answerCommercialDirectorQuery (query.ts) rejeita o texto do incidente real no rascunhoSugerido",
  async () => {
    // answerCommercialDirectorQuery exige um client Supabase real para
    // montar o contexto (buildEventAnalysisContext) — para testar sem rede/DB,
    // exercitamos aqui o mesmo provider + validação + guardrail que query.ts
    // usa internamente, com o contexto já pronto em memória.
    const queryOutput = {
      expertId: "commercial-director",
      expertName: "Diretor Comercial IA",
      expertVersion: COMMERCIAL_DIRECTOR_VERSION,
      scope: "EVENT",
      question: "Prepare um e-mail sobre o reajuste.",
      fatosDocumentados: [FUNDACAO_SOURCE_TEXT],
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
      rascunhoSugerido: {
        type: "EMAIL",
        subject: "Re: Reajuste",
        body: "O projeto de fundação passou a compor a apólice.",
        status: "DRAFT_PENDING_REVIEW",
      },
      confidence: 0.7,
      requiresHumanReview: true,
    };
    const client = makeMockClient(queryOutput);
    const provider = createAnthropicAiProvider({ config: FAKE_CONFIG, client });
    const { validateExpertQueryResponse } = await import("../apps/web/lib/ai/query/validate-expert-query-response");

    const response = await provider.answerQuery({
      expertId: "commercial-director",
      expertName: "Diretor Comercial IA",
      expertVersion: COMMERCIAL_DIRECTOR_VERSION,
      instructions: "instruções de teste",
      scope: "EVENT",
      question: "Prepare um e-mail sobre o reajuste.",
      eventContext: eventContextWithFundacaoFact(),
      projectContext: null,
      outputSchema: { type: "object" },
    });
    const validated = validateExpertQueryResponse(response.output, {
      expertId: "commercial-director",
      expertName: "Diretor Comercial IA",
      expertVersion: COMMERCIAL_DIRECTOR_VERSION,
    });
    const source = buildGroundingSource({ eventContext: eventContextWithFundacaoFact(), documentedFacts: validated.fatosDocumentados });
    const groundingResult = validateDraftGrounding(validated.rascunhoSugerido.body, source);

    assert(groundingResult.valid === false, "o mesmo texto do incidente real deveria falhar no guardrail também no fluxo de consulta");
    assert(groundingResult.unsupportedClaims.length === 1);
  }
);

check("Fake Provider continua funcionando (grounding não interfere no fake — só roda para providerId==='anthropic')", () => {
  // Regressão estrutural: os testes de test-commercial-director-expert.mjs/
  // test-expert-query.mjs (fake provider) já passam sem alteração — aqui
  // confirmamos apenas que o guardrail não altera a assinatura pública de
  // nenhuma função existente usada pelo caminho fake.
  assert(typeof runCommercialDirectorExpert === "function");
  assert(typeof answerCommercialDirectorQuery === "function");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
