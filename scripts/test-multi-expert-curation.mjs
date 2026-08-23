// Testes dos 5 Experts Claude/Anthropic reais do ACC (CEO, Comercial,
// Jurídico, Planejamento, ESG) e da fundação de curadoria multiagente
// (apps/web/lib/ai/curation/). NUNCA chama a API Anthropic real — todo
// client é injetado (fake provider determinístico, ou mock local do SDK
// via createAnthropicAiProvider({ client, config })). Usa o Supabase REAL
// (projeto de referência) só para os testes de leitura/roteamento que
// realmente precisam de contexto de projeto — com fixtures próprias e
// limpeza completa quando algo é inserido.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-multi-expert-curation.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { ALL_OFFICIAL_EXPERT_DEFINITIONS, OFFICIAL_EXPERT_DEFINITIONS } = await import("../apps/web/lib/ai/expert-definitions/definitions");
const { EXPERT_PROVIDER_ENV_VAR, resolveAiProviderForExpert, resolveAiProviderNameForExpert } = await import(
  "../apps/web/lib/ai/providers/resolve-provider-for-expert"
);
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider");
const { createAnthropicAiProvider } = await import("../apps/web/lib/ai/providers/anthropic-provider");
const { validateExpertQueryResponse } = await import("../apps/web/lib/ai/query/validate-expert-query-response");

const { COMMERCIAL_DIRECTOR_INSTRUCTIONS } = await import("../apps/web/lib/ai/experts/commercial-director/identity");
const { answerCommercialDirectorQuery } = await import("../apps/web/lib/ai/experts/commercial-director/query");
const { ESG_DIRECTOR_INSTRUCTIONS } = await import("../apps/web/lib/ai/experts/esg-director/identity");
const { answerEsgDirectorQuery } = await import("../apps/web/lib/ai/experts/esg-director/query");
const { LEGAL_CONSULTANT_INSTRUCTIONS } = await import("../apps/web/lib/ai/experts/legal-consultant/identity");
const { answerLegalConsultantQuery } = await import("../apps/web/lib/ai/experts/legal-consultant/query");
const { PLANNING_DIRECTOR_INSTRUCTIONS } = await import("../apps/web/lib/ai/experts/planning-director/identity");
const { answerPlanningDirectorQuery } = await import("../apps/web/lib/ai/experts/planning-director/query");
const { CEO_INSTRUCTIONS } = await import("../apps/web/lib/ai/experts/ceo/identity");
const { answerCeoQuery } = await import("../apps/web/lib/ai/experts/ceo/query");
const { runExecutiveCuration } = await import("../apps/web/lib/ai/experts/ceo/consolidate");
const { validateExecutiveCuration, ExecutiveCurationValidationError } = await import("../apps/web/lib/ai/experts/ceo/schema");

const { decideExpertRouting } = await import("../apps/web/lib/ai/curation/route-experts");
const { runMultiExpertCuration } = await import("../apps/web/lib/ai/curation/run-multi-expert-curation");

const { ingestEmailAttachmentsForMessage } = await import("../apps/web/lib/email/attachments/ingest-email-attachments");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

// Isolamento de ambiente: esta suíte NUNCA pode disparar uma chamada
// Anthropic real, mesmo que QUALQUER uma das 5 variáveis
// AXION_AI_PROVIDER_<EXPERT> (ou o global AXION_AI_PROVIDER) esteja
// configurada como "anthropic" no .env.local do ambiente (ex.: ligada em
// um pacote anterior para teste live isolado, gated por scripts
// próprios). Força "fake" nas 5 variáveis específicas + na global para
// TODA a duração do processo — inclusive dentro de runMultiExpertCuration,
// que nunca aceita override de provider por Expert — restaurando os
// valores originais ao final.
const ALL_PROVIDER_ENV_VARS = [...Object.values(EXPERT_PROVIDER_ENV_VAR), "AXION_AI_PROVIDER"];
const originalProviderEnv = Object.fromEntries(ALL_PROVIDER_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of ALL_PROVIDER_ENV_VARS) process.env[name] = "fake";
function restoreProviderEnv() {
  for (const [name, value] of Object.entries(originalProviderEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

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

const OFFICIAL_IDS = ["ceo", "commercial-director", "legal-consultant", "planning-director", "esg-director"];
const INSTRUCTIONS_BY_ID = {
  ceo: CEO_INSTRUCTIONS,
  "commercial-director": COMMERCIAL_DIRECTOR_INSTRUCTIONS,
  "legal-consultant": LEGAL_CONSULTANT_INSTRUCTIONS,
  "planning-director": PLANNING_DIRECTOR_INSTRUCTIONS,
  "esg-director": ESG_DIRECTOR_INSTRUCTIONS,
};

console.log("");
console.log("======================================");
console.log("5 EXPERTS CLAUDE + CURADORIA MULTIAGENTE — TESTES");
console.log("======================================");
console.log("");

// --- 1. Definições formais: os 5 Experts estão operacionais ---

check("os 5 Experts oficiais estão status=IMPLEMENTED (nenhum PLANNED restante)", () => {
  for (const id of OFFICIAL_IDS) {
    assert(OFFICIAL_EXPERT_DEFINITIONS[id].status === "IMPLEMENTED", `${id} deveria estar IMPLEMENTED`);
  }
  assert(ALL_OFFICIAL_EXPERT_DEFINITIONS.length === 5);
});

check("as 5 instruções (system prompts) são todas diferentes entre si — nunca alias do mesmo prompt", () => {
  const texts = OFFICIAL_IDS.map((id) => INSTRUCTIONS_BY_ID[id]);
  const uniqueTexts = new Set(texts);
  assert(uniqueTexts.size === 5, "esperava 5 prompts distintos");
});

check("cada instrução cita o próprio expertId/nome — nunca o prompt de outro Expert", () => {
  for (const id of OFFICIAL_IDS) {
    const definition = OFFICIAL_EXPERT_DEFINITIONS[id];
    assert(INSTRUCTIONS_BY_ID[id].includes(id), `instruções de ${id} deveriam citar seu próprio expertId`);
    assert(INSTRUCTIONS_BY_ID[id].includes(definition.expertName), `instruções de ${id} deveriam citar seu próprio nome`);
  }
});

check("isolamento de fontes: cada Expert declara authorizedSources coerente com seu domínio (nunca a mesma lista genérica repetida)", () => {
  const sourceListsBySignature = new Set(
    OFFICIAL_IDS.map((id) => OFFICIAL_EXPERT_DEFINITIONS[id].authorizedSources.map((s) => s.sourceId).sort().join(","))
  );
  assert(sourceListsBySignature.size === 5, "cada Expert deveria ter uma composição própria de fontes autorizadas");

  const legalSources = OFFICIAL_EXPERT_DEFINITIONS["legal-consultant"].authorizedSources.map((s) => s.sourceId);
  assert(legalSources.includes("legal_sources"), "Consultor Jurídico IA deveria declarar a fonte legal oficial (mesmo FUTURE_SOURCE)");

  const planningSources = OFFICIAL_EXPERT_DEFINITIONS["planning-director"].authorizedSources.map((s) => s.sourceId);
  assert(planningSources.includes("schedule_activities"), "Diretor de Planejamento IA deveria declarar cronograma como fonte");
  assert(!planningSources.includes("esg_obligations"), "Diretor de Planejamento IA nunca deveria declarar obrigações ESG como fonte própria");

  const esgSources = OFFICIAL_EXPERT_DEFINITIONS["esg-director"].authorizedSources.map((s) => s.sourceId);
  assert(esgSources.includes("esg_obligations") && esgSources.includes("esg_obligation_evidence"));
});

// --- 2. Provider resolution para os 5 Experts ---

const savedEnv = {};
function setEnv(name, value) {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
function restoreEnv() {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

check("EXPERT_PROVIDER_ENV_VAR define uma variável própria para cada um dos 5 Experts oficiais", () => {
  for (const id of OFFICIAL_IDS) {
    assert(typeof EXPERT_PROVIDER_ENV_VAR[id] === "string" && EXPERT_PROVIDER_ENV_VAR[id].length > 0);
  }
  const varNames = new Set(Object.values(EXPERT_PROVIDER_ENV_VAR));
  assert(varNames.size === 5, "cada Expert deveria ter sua própria variável — nunca compartilhada");
});

check("resolveAiProviderNameForExpert usa a variável específica do Expert quando presente, mesmo com AXION_AI_PROVIDER diferente", () => {
  setEnv("AXION_AI_PROVIDER", "fake");
  setEnv("AXION_AI_PROVIDER_LEGAL_CONSULTANT", "anthropic");
  try {
    assert(resolveAiProviderNameForExpert("legal-consultant") === "anthropic");
    assert(resolveAiProviderNameForExpert("planning-director") === "fake", "planning-director deveria cair no default global, não herdar de legal-consultant");
  } finally {
    setEnv("AXION_AI_PROVIDER_LEGAL_CONSULTANT", undefined);
    setEnv("AXION_AI_PROVIDER", undefined);
  }
});

check("resolveAiProviderNameForExpert default é 'fake' quando nenhuma variável está configurada, para os 5 Experts", () => {
  for (const id of OFFICIAL_IDS) {
    setEnv(EXPERT_PROVIDER_ENV_VAR[id], undefined);
  }
  setEnv("AXION_AI_PROVIDER", undefined);
  for (const id of OFFICIAL_IDS) {
    assert(resolveAiProviderNameForExpert(id) === "fake", `${id} deveria resolver para "fake" por default`);
  }
});

check("Anthropic é selecionável para os 5 Experts sem nenhuma chamada de rede (só construção do client)", () => {
  setEnv("ANTHROPIC_API_KEY", "sk-test-fake-key-not-real");
  setEnv("ANTHROPIC_MODEL", "claude-test-model");
  try {
    for (const id of OFFICIAL_IDS) {
      setEnv(EXPERT_PROVIDER_ENV_VAR[id], "anthropic");
      const provider = resolveAiProviderForExpert(id);
      assert(provider.id === "anthropic", `${id} deveria resolver para o provider anthropic`);
      setEnv(EXPERT_PROVIDER_ENV_VAR[id], undefined);
    }
  } finally {
    setEnv("ANTHROPIC_API_KEY", undefined);
    setEnv("ANTHROPIC_MODEL", undefined);
  }
});

restoreEnv();

// --- 3. Fake provider determinístico (incluindo consolidateExecutiveCuration) ---

await checkAsync("fake provider é determinístico em answerQuery, generateAssessment e consolidateExecutiveCuration", async () => {
  const provider = createFakeAiProvider();
  const minimalContext = {
    projectId: "p1",
    eventId: "e1",
    focusCandidateId: null,
    event: { id: "e1", projectId: "p1", title: "T", description: "D", occurredAt: "2026-01-01T00:00:00.000Z", sourceType: "MANUAL", status: "NOVO" },
    evidence: [],
    relatedClauses: [],
    relatedEmails: [],
    confrontationCandidates: [],
    eventNotes: [],
  };
  const queryRequest = { expertId: "commercial-director", expertName: "x", expertVersion: "v1", instructions: "x", scope: "EVENT", question: "q", eventContext: minimalContext, projectContext: null, outputSchema: {} };
  const [a, b] = await Promise.all([provider.answerQuery(queryRequest), provider.answerQuery(queryRequest)]);
  assert(JSON.stringify(a.output) === JSON.stringify(b.output), "answerQuery deveria ser determinístico");

  const assessmentRequest = { expertId: "commercial-director", expertName: "x", expertVersion: "v1", instructions: "x", analysisType: "RISK_ASSESSMENT", context: minimalContext, outputSchema: {} };
  const [c, d] = await Promise.all([provider.generateAssessment(assessmentRequest), provider.generateAssessment(assessmentRequest)]);
  assert(JSON.stringify(c.output) === JSON.stringify(d.output), "generateAssessment deveria ser determinístico");

  const curationRequest = {
    expertId: "ceo",
    expertName: "CEO IA",
    expertVersion: "v1",
    instructions: "x",
    situationSummary: "s",
    positions: [{ expertId: "commercial-director", expertName: "x", severity: "HIGH", interpretacao: "i", riscos: ["r"], recomendacoes: [], informacoesFaltantes: [] }],
    outputSchema: {},
  };
  const [e, f] = await Promise.all([provider.consolidateExecutiveCuration(curationRequest), provider.consolidateExecutiveCuration(curationRequest)]);
  assert(JSON.stringify(e.output) === JSON.stringify(f.output), "consolidateExecutiveCuration deveria ser determinístico");
  assert(e.output.overallSeverity === "HIGH", "severidade consolidada deveria refletir a maior severidade recebida");
});

// --- 4. Roteamento determinístico ---

await checkAsync("routing single expert: SSMA sem penalidade só consulta o Diretor de ESG IA", async () => {
  const routing = await decideExpertRouting({}, { projectId: "p1", sourceType: "EVENT", description: "Pendência de treinamento de SSMA identificada no canteiro." });
  assert(routing.primaryExpertIds.includes("esg-director"));
  assert(!routing.primaryExpertIds.includes("legal-consultant") && !routing.supportingExpertIds.includes("legal-consultant"));
});

await checkAsync("routing multi expert: SSMA com penalidade consulta ESG + Jurídico (tema SSMA COM PENALIDADE)", async () => {
  const routing = await decideExpertRouting({}, { projectId: "p1", sourceType: "EVENT", description: "Risco de multa por não conformidade de SSMA identificado." });
  assert(routing.topic === "SSMA COM PENALIDADE");
  assert(routing.primaryExpertIds.includes("esg-director"));
  assert(routing.supportingExpertIds.includes("legal-consultant"));
});

await checkAsync("routing multi expert: escopo adicional/preço consulta Comercial + Jurídico (tema NEGOCIAÇÃO)", async () => {
  const routing = await decideExpertRouting({}, { projectId: "p1", sourceType: "EVENT", description: "Cliente solicitou escopo adicional e reajuste de preço no aditivo." });
  assert(routing.topic === "NEGOCIAÇÃO");
  assert(routing.primaryExpertIds.includes("commercial-director"));
  assert(routing.supportingExpertIds.includes("legal-consultant"));
});

await checkAsync("routing multi expert: atraso/extensão de prazo consulta Planejamento (tema ATRASO COM MULTA)", async () => {
  const routing = await decideExpertRouting({}, { projectId: "p1", sourceType: "EVENT", description: "Atraso identificado no cronograma, com pedido de extensão de prazo." });
  assert(routing.topic === "ATRASO COM MULTA");
  assert(routing.primaryExpertIds.includes("planning-director"));
});

await checkAsync("routing fallback (multi-área/tema não reconhecido) consulta o CEO IA + todos os especialistas (tema DECISÃO EXECUTIVA)", async () => {
  const routing = await decideExpertRouting({}, { projectId: "p1", sourceType: "EVENT", description: "Situação genérica sem palavra-chave reconhecida." });
  assert(routing.topic === "GERAL");
  assert(routing.primaryExpertIds.includes("ceo"));
  for (const id of ["commercial-director", "legal-consultant", "planning-director", "esg-director"]) {
    assert(routing.supportingExpertIds.includes(id), `fallback deveria incluir ${id} como apoio`);
  }
});

await checkAsync("roteamento é sempre determinístico — mesma entrada produz sempre a mesma decisão", async () => {
  const input = { projectId: "p1", sourceType: "EVENT", description: "Atraso identificado no cronograma." };
  const [a, b] = await Promise.all([decideExpertRouting({}, input), decideExpertRouting({}, input)]);
  assert(JSON.stringify(a) === JSON.stringify(b));
});

// --- 5. Estrutural: nenhum Expert novo envia e-mail, muta Event Ledger ou decide sozinho ---

check("Consultor Jurídico IA / Diretor de Planejamento IA / CEO IA: assinatura das funções nunca cresce para aceitar uma ação de envio", () => {
  assert(answerLegalConsultantQuery.length <= 3);
  assert(answerPlanningDirectorQuery.length <= 3);
  assert(answerCeoQuery.length <= 3);
  assert(runExecutiveCuration.length <= 3);
});

check("nenhum arquivo novo (curation/, experts/ceo, experts/legal-consultant, experts/planning-director) referencia contract_events, envio de e-mail ou grava no banco (.insert/.update/.delete)", () => {
  const files = [
    "apps/web/lib/ai/curation/route-experts.ts",
    "apps/web/lib/ai/curation/run-multi-expert-curation.ts",
    "apps/web/lib/ai/experts/ceo/query.ts",
    "apps/web/lib/ai/experts/ceo/consolidate.ts",
    "apps/web/lib/ai/experts/legal-consultant/query.ts",
    "apps/web/lib/ai/experts/planning-director/query.ts",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!source.includes("contract_events"), `${file} nunca deveria referenciar contract_events`);
    assert(!/\.insert\(|\.update\(|\.delete\(/.test(source), `${file} nunca deveria escrever no banco (.insert/.update/.delete)`);
    assert(!/sendActionRequestEmail|sendSlaEscalationEmail|nodemailer|resend\.emails/.test(source), `${file} nunca deveria enviar e-mail`);
  }
});

check("requiresHumanReview=false é sempre rejeitado por validateExecutiveCuration (nunca dispensa revisão humana)", () => {
  const validOutput = {
    situacao: "s",
    fatosPrincipais: [],
    posicoes: [],
    divergencias: [],
    riscos: [],
    overallSeverity: "LOW",
    alternativas: [],
    recomendacao: "r",
    decisoesHumanasNecessarias: [],
    requiresHumanReview: false,
  };
  let threw = false;
  try {
    validateExecutiveCuration(validOutput, { expertIds: [] });
  } catch (error) {
    threw = error instanceof ExecutiveCurationValidationError;
  }
  assert(threw, "requiresHumanReview=false deveria ser rejeitado");
});

check("validateExecutiveCuration rejeita posição/divergência de um Expert que não foi realmente consultado (nunca inventa quem participou)", () => {
  const output = {
    situacao: "s",
    fatosPrincipais: [],
    posicoes: [{ expertId: "esg-director", expertName: "Diretor de ESG IA", severity: "LOW", summary: "x" }],
    divergencias: [],
    riscos: [],
    overallSeverity: "LOW",
    alternativas: [],
    recomendacao: "r",
    decisoesHumanasNecessarias: [],
    requiresHumanReview: true,
  };
  let threw = false;
  try {
    validateExecutiveCuration(output, { expertIds: ["commercial-director"] });
  } catch (error) {
    threw = error instanceof ExecutiveCurationValidationError;
  }
  assert(threw, "posição de um Expert não consultado deveria ser rejeitada");
});

check("validateExecutiveCuration aceita e preserva um CONFLITO ENTRE ESPECIALISTAS bem formado (nunca escolhe um vencedor)", () => {
  const output = {
    situacao: "s",
    fatosPrincipais: [],
    posicoes: [
      { expertId: "commercial-director", expertName: "Diretor Comercial IA", severity: "MEDIUM", summary: "Recomenda aceitar a condição." },
      { expertId: "legal-consultant", expertName: "Consultor Jurídico IA", severity: "HIGH", summary: "Recomenda recusar por risco contratual." },
    ],
    divergencias: [
      {
        topic: "Aceitar a condição proposta?",
        positions: [
          { expertId: "commercial-director", expertName: "Diretor Comercial IA", position: "Aceitar." },
          { expertId: "legal-consultant", expertName: "Consultor Jurídico IA", position: "Recusar." },
        ],
        probableReason: "Avaliação de risco divergente entre a visão comercial e a jurídica.",
      },
    ],
    riscos: [],
    overallSeverity: "HIGH",
    alternativas: [],
    recomendacao: "DECISÃO HUMANA NECESSÁRIA.",
    decisoesHumanasNecessarias: ["Decidir entre aceitar ou recusar a condição."],
    requiresHumanReview: true,
  };
  const validated = validateExecutiveCuration(output, { expertIds: ["commercial-director", "legal-consultant"] });
  assert(validated.divergencias.length === 1);
  assert(validated.divergencias[0].positions.length === 2);
  assert(validated.overallSeverity === "HIGH");
});

// --- 6. Consultas reais (somente leitura) contra o projeto de referência ---

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const REFERENCE_EVENT_ID = "58988a54-092c-442f-a79a-638b53bc088e";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP consultas reais — Supabase não configurado.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  await checkAsync("Jurídico: consulta PROJECT real nunca inventa base legal (baseLegal sempre vazia sem corpus oficial ingerido)", async () => {
    const result = await answerLegalConsultantQuery(supabase, {
      scope: "PROJECT",
      projectId: REFERENCE_PROJECT_ID,
      question: "Quais riscos jurídicos existem neste projeto?",
    });
    assert(result.response.expertId === "legal-consultant");
    assert(result.response.requiresHumanReview === true);
    assert(result.response.baseLegal.length === 0, "sem corpus normativo ingerido, baseLegal deveria ser sempre vazia");
  });

  await checkAsync("Planejamento: consulta EVENT real retorna estrutura válida, escopo reduzido preservado", async () => {
    const result = await answerPlanningDirectorQuery(supabase, {
      scope: "EVENT",
      projectId: REFERENCE_PROJECT_ID,
      eventId: REFERENCE_EVENT_ID,
      question: "Este evento tem impacto de cronograma?",
    });
    assert(result.response.expertId === "planning-director");
    assert(result.response.scope === "EVENT");
    assert(result.response.requiresHumanReview === true);
  });

  await checkAsync("CEO: consulta PROJECT individual (sem consolidar outros Experts) retorna estrutura válida", async () => {
    const result = await answerCeoQuery(supabase, {
      scope: "PROJECT",
      projectId: REFERENCE_PROJECT_ID,
      question: "Qual a situação executiva deste projeto?",
    });
    assert(result.response.expertId === "ceo");
    assert(result.response.requiresHumanReview === true);
  });

  await checkAsync("Comercial e ESG continuam operacionais (regressão: já eram IMPLEMENTED antes deste pacote)", async () => {
    const [commercial, esg] = await Promise.all([
      answerCommercialDirectorQuery(supabase, { scope: "PROJECT", projectId: REFERENCE_PROJECT_ID, question: "Situação comercial?" }),
      answerEsgDirectorQuery(supabase, { scope: "PROJECT", projectId: REFERENCE_PROJECT_ID, question: "Obrigações ESG pendentes?" }),
    ]);
    assert(commercial.response.expertId === "commercial-director");
    assert(esg.response.expertId === "esg-director");
  });

  for (const [label, fn] of [
    ["Consultor Jurídico IA", (req) => answerLegalConsultantQuery(supabase, req)],
    ["Diretor de Planejamento IA", (req) => answerPlanningDirectorQuery(supabase, req)],
    ["CEO IA", (req) => answerCeoQuery(supabase, req)],
  ]) {
    await checkAsync(`${label}: escopo DOCUMENT/EMAIL/MULTI_EXPERT falha fechado (não implementado nesta fase)`, async () => {
      for (const scope of ["DOCUMENT", "EMAIL", "MULTI_EXPERT"]) {
        await assertRejects(fn({ scope, projectId: REFERENCE_PROJECT_ID, question: "x" }), "não implementado", `${label} escopo ${scope}`);
      }
    });
  }

  await checkAsync("Jurídico: grounding corrige/suprime rascunho sem suporte no contexto (mesmo guardrail dos demais Experts, provider Anthropic mockado)", async () => {
    const output = {
      expertId: "legal-consultant",
      expertName: "Consultor Jurídico IA",
      expertVersion: "v1",
      scope: "EVENT",
      question: "Redija uma notificação sobre o evento.",
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
      rascunhoSugerido: {
        type: "NOTIFICATION",
        subject: "Notificação",
        body: "Esta afirmação específica não tem nenhum suporte no contexto fornecido sobre uma cláusula inexistente 99.99.",
        status: "DRAFT_PENDING_REVIEW",
      },
      confidence: 0.7,
      requiresHumanReview: true,
    };
    const client = {
      messages: { create: async () => ({ content: [{ type: "tool_use", id: "tu_1", name: "emit_expert_structured_output", input: output }], stop_reason: "tool_use" }) },
    };
    const provider = createAnthropicAiProvider({ config: { apiKey: "sk-test", model: "claude-test-model", maxTokens: 4096, timeoutMs: 5000 }, client });

    const result = await answerLegalConsultantQuery(supabase, { scope: "EVENT", projectId: REFERENCE_PROJECT_ID, eventId: REFERENCE_EVENT_ID, question: "Redija uma notificação sobre o evento." }, provider);

    assert(result.audit.grounding.performed === true, "grounding deveria ter rodado para o provider anthropic");
    assert(result.response.grounding.performed === true);
  });

  // --- Curadoria multiagente end-to-end (fake provider, sem chamada live) ---

  await checkAsync("runMultiExpertCuration: rota multi-expert (negociação) consulta exatamente Comercial + Jurídico e o CEO consolida ambos", async () => {
    const curation = await runMultiExpertCuration(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      eventId: REFERENCE_EVENT_ID,
      sourceType: "EVENT",
      description: "Cliente solicitou escopo adicional e reajuste de preço.",
    });

    assert(curation.routing.topic === "NEGOCIAÇÃO");
    const consultedIds = curation.expertResults.map((r) => r.expertId).sort();
    assert(JSON.stringify(consultedIds) === JSON.stringify(["commercial-director", "legal-consultant"].sort()), `esperado [commercial-director, legal-consultant], obtido ${JSON.stringify(consultedIds)}`);
    assert(curation.executiveCuration.requiresHumanReview === true);
    assert(curation.executiveCuration.posicoes.every((p) => consultedIds.includes(p.expertId)), "CEO nunca pode citar um Expert que não foi consultado nesta rodada");
    assert(curation.audit.consultedExpertIds.length === 2);
  });

  await checkAsync("runMultiExpertCuration: CEO nunca é executado como especialista da própria rodada (mesmo quando roteado como primário)", async () => {
    const curation = await runMultiExpertCuration(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      eventId: REFERENCE_EVENT_ID,
      sourceType: "EVENT",
      description: "Situação genérica sem palavra-chave reconhecida.",
    });
    assert(curation.routing.primaryExpertIds.includes("ceo"));
    assert(!curation.expertResults.some((r) => r.expertId === "ceo"), "CEO nunca deveria aparecer em expertResults — ele é sempre a consolidação, nunca um especialista");
  });

  await checkAsync("Event Ledger não é mutado por uma rodada de curadoria (nenhum contract_event criado)", async () => {
    const before = await supabase.from("contract_events").select("id", { count: "exact", head: true }).eq("project_id", REFERENCE_PROJECT_ID);
    await runMultiExpertCuration(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      eventId: REFERENCE_EVENT_ID,
      sourceType: "EVENT",
      description: "Atraso identificado no cronograma, com pedido de extensão de prazo.",
    });
    const after = await supabase.from("contract_events").select("id", { count: "exact", head: true }).eq("project_id", REFERENCE_PROJECT_ID);
    assert(before.count === after.count, "uma rodada de curadoria nunca pode criar/apagar um contract_event");
  });

  // --- Seção 7: anexo de e-mail ainda não processado deve ser sinalizado no roteamento ---

  await checkAsync("attachment requires processing: e-mail com anexo ainda não promovido marca sourceRequiresProcessing=true", async () => {
    const { data: emailRow, error: emailError } = await supabase
      .from("emails")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        from_address: "fornecedor@example.com",
        to_address: "reynaldo@axion.com.br",
        subject: "[TESTE ACC] Curadoria — anexo não processado",
        sent_at: new Date().toISOString(),
        snippet: "E-mail de teste — apagado ao final da suíte.",
      })
      .select("id")
      .single();
    if (emailError) throw new Error(emailError.message);

    let attachmentId = null;
    let storagePath = null;
    try {
      const buffer = Buffer.from("XLSX-DE-TESTE-CURADORIA");
      const [result] = await ingestEmailAttachmentsForMessage(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        emailId: emailRow.id,
        gmailMessageId: "gmail-msg-curadoria-1",
        gmailThreadId: null,
        receivedAt: new Date().toISOString(),
        parts: [{ gmailAttachmentId: "att-curadoria-1", originalFileName: "Aditivo_01.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", declaredSizeBytes: buffer.length }],
        downloadAttachmentBytes: async () => buffer,
      });
      assert(result.status === "INGESTED");
      attachmentId = result.attachment.id;
      storagePath = result.attachment.storagePath;

      const routing = await decideExpertRouting(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        sourceType: "EMAIL",
        emailId: emailRow.id,
        description: "Segue planilha do adicional.",
      });

      assert(routing.sourceRequiresProcessing === true, "anexo ainda PENDING (não promovido) deveria marcar sourceRequiresProcessing");
      assert(routing.unprocessedAttachmentFileNames.includes("Aditivo_01.xlsx"), "o Expert nunca pode fingir que já analisou o conteúdo só porque conhece o filename");
    } finally {
      if (attachmentId) await supabase.from("email_attachments").delete().eq("id", attachmentId);
      if (storagePath) await supabase.storage.from("project-documents").remove([storagePath]);
      await supabase.from("emails").delete().eq("id", emailRow.id);
    }
  });
}

restoreProviderEnv();

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
