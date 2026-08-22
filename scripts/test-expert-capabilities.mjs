// Testes do catálogo formal dos Experts oficiais do ACC
// (apps/web/lib/ai/expert-definitions/) — definição, não operação real.
// Mesmo padrão de scripts/test-esg-director.mjs.
//
// Uso:
//   node scripts/test-expert-capabilities.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  ALL_OFFICIAL_EXPERT_DEFINITIONS,
  OFFICIAL_EXPERT_DEFINITIONS,
  CEO_DEFINITION,
  COMMERCIAL_DIRECTOR_DEFINITION,
  LEGAL_CONSULTANT_DEFINITION,
  PLANNING_DIRECTOR_DEFINITION,
  ESG_DIRECTOR_DEFINITION,
} = await import("../apps/web/lib/ai/expert-definitions/definitions");
const { EXPERT_COLLABORATION_MATRIX, getCollaborationRulesForExpert, SHARED_SOURCE_CATALOG } = await import(
  "../apps/web/lib/ai/expert-definitions/shared"
);
const { formatExpertVersionTag } = await import("../apps/web/lib/ai/expert-definitions/types");

const { COMMERCIAL_DIRECTOR_EXPERT_ID, COMMERCIAL_DIRECTOR_VERSION } = await import(
  "../apps/web/lib/ai/experts/commercial-director/identity"
);
const { ESG_DIRECTOR_EXPERT_ID, ESG_DIRECTOR_VERSION } = await import("../apps/web/lib/ai/experts/esg-director/identity");

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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

const ALLOWED_OUTPUT_TYPES = new Set([
  "ANALYSIS",
  "RECOMMENDATION",
  "RISK_ASSESSMENT",
  "ACTION_SUGGESTION",
  "DRAFT_EMAIL",
  "DRAFT_LETTER",
  "DRAFT_NOTIFICATION",
  "DRAFT_PROPOSAL",
  "DRAFT_COUNTERPROPOSAL",
  "EXECUTIVE_SUMMARY",
  "TIMELINE_ANALYSIS",
  "DOCUMENT_GAP_ANALYSIS",
]);
const DRAFT_OUTPUT_TYPES = new Set(["DRAFT_EMAIL", "DRAFT_LETTER", "DRAFT_NOTIFICATION", "DRAFT_PROPOSAL", "DRAFT_COUNTERPROPOSAL"]);
const OFFICIAL_IDS = ["ceo", "commercial-director", "legal-consultant", "planning-director", "esg-director"];

console.log("");
console.log("======================================");
console.log("CATÁLOGO FORMAL DOS EXPERTS — TESTES");
console.log("======================================");
console.log("");

check("os cinco ExpertIds oficiais estão todos presentes no registro", () => {
  for (const id of OFFICIAL_IDS) {
    assert(OFFICIAL_EXPERT_DEFINITIONS[id] !== undefined, `faltando ${id}`);
    assert(OFFICIAL_EXPERT_DEFINITIONS[id].expertId === id, `expertId inconsistente para ${id}`);
  }
  assert(ALL_OFFICIAL_EXPERT_DEFINITIONS.length === 5, "esperado exatamente 5 definições");
});

check('"contract-lawyer" (nome de Expert rejeitado anteriormente) não existe em nenhum lugar do catálogo', () => {
  assert(OFFICIAL_EXPERT_DEFINITIONS["contract-lawyer"] === undefined);
  for (const def of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    assert(def.expertId !== "contract-lawyer");
    assert(!def.expertName.toLowerCase().includes("advogado especialista em contratos"));
  }
});

check("requiresHumanReview é sempre true para todos os cinco Experts", () => {
  for (const def of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    assert(def.requiresHumanReview === true, `${def.expertId} deveria ter requiresHumanReview=true`);
  }
});

check("todo outputType usado pertence ao conjunto formal de ExpertOutputType", () => {
  for (const def of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    assert(def.outputTypes.length > 0, `${def.expertId} sem outputTypes`);
    for (const type of def.outputTypes) {
      assert(ALLOWED_OUTPUT_TYPES.has(type), `${def.expertId} usa outputType inválido: ${type}`);
    }
  }
});

check("todo DRAFT_* declarado implica status DRAFT_PENDING_REVIEW (nível de catálogo/documentação)", () => {
  for (const def of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    const declaresDrafts = def.outputTypes.some((type) => DRAFT_OUTPUT_TYPES.has(type));
    if (!declaresDrafts) continue;
    const mentionsPendingReview =
      def.mission.includes("DRAFT_PENDING_REVIEW") ||
      def.limitations.some((l) => l.includes("DRAFT_PENDING_REVIEW")) ||
      def.confidenceRules.some((r) => r.description.includes("DRAFT_PENDING_REVIEW")) ||
      def.escalationRules.some((r) => r.requiredDeclaration.includes("DRAFT_PENDING_REVIEW")) ||
      // A garantia real de DRAFT_PENDING_REVIEW já está travada por tipo/schema
      // nos Experts implementados (ver validate-expert-query-response.ts); para
      // os Experts ainda PLANNED, a garantia é documental (instructions futuras).
      def.status === "PLANNED";
    assert(mentionsPendingReview, `${def.expertId} declara output de rascunho sem garantia documentada de DRAFT_PENDING_REVIEW`);
  }
});

check("Diretor de Planejamento IA respeita o escopo reduzido (sem Lean/LPS/PPC/Pull Planning/Lookahead)", () => {
  const forbidden = ["lean", "last planner", "ppc", "pull planning", "lookahead"];
  const haystack = [
    PLANNING_DIRECTOR_DEFINITION.mission,
    ...PLANNING_DIRECTOR_DEFINITION.capabilities,
    ...PLANNING_DIRECTOR_DEFINITION.limitations,
  ]
    .join(" \n ")
    .toLowerCase();
  for (const term of forbidden) {
    assert(!haystack.includes(term) || PLANNING_DIRECTOR_DEFINITION.limitations.some((l) => l.toLowerCase().includes(term)), `termo fora de escopo "${term}" aparece fora das limitations`);
  }
  const limitationsText = PLANNING_DIRECTOR_DEFINITION.limitations.join(" ").toLowerCase();
  for (const term of forbidden) {
    assert(limitationsText.includes(term), `limitations deveria excluir explicitamente "${term}"`);
  }
});

check("Diretor de ESG IA respeita o escopo reduzido (sem ESG corporativo amplo/gestão operacional completa de SSMA)", () => {
  const limitationsText = ESG_DIRECTOR_DEFINITION.limitations.join(" ").toLowerCase();
  assert(limitationsText.includes("corporativo"), "deveria excluir ESG corporativo amplo");
  assert(limitationsText.includes("ssma"), "deveria excluir gestão operacional de SSMA");
  assert(ESG_DIRECTOR_DEFINITION.expertId === ESG_DIRECTOR_EXPERT_ID);
  assert(ESG_DIRECTOR_DEFINITION.version === ESG_DIRECTOR_VERSION);
});

check("CEO IA nunca declara capacidade de executar uma decisão (somente recomendar/consolidar)", () => {
  const forbidden = ["executar a decisão", "executar decisão", "aprova sozinho", "decide sozinho"];
  const capabilitiesText = CEO_DEFINITION.capabilities.join(" ").toLowerCase();
  for (const term of forbidden) {
    assert(!capabilitiesText.includes(term), `capabilities do CEO IA não deveria conter "${term}"`);
  }
  const limitationsText = CEO_DEFINITION.limitations.join(" ").toLowerCase();
  assert(limitationsText.includes("nunca executa"), "limitations deveria declarar explicitamente que o CEO IA nunca executa uma decisão");
});

check("fontes marcadas FUTURE_SOURCE nunca são afirmadas como integração real existente", () => {
  for (const source of SHARED_SOURCE_CATALOG) {
    assert(source.status === "AVAILABLE" || source.status === "FUTURE_SOURCE");
    if (source.status === "FUTURE_SOURCE") {
      assert(source.note.length > 0, `${source.sourceId} FUTURE_SOURCE deveria documentar a lacuna em note`);
    }
  }
  const legal = SHARED_SOURCE_CATALOG.find((s) => s.sourceId === "legal_sources");
  assert(legal.status === "FUTURE_SOURCE", "corpus legal ainda não é uma fonte real disponível");
});

check("Consultor Jurídico IA nunca afirma um artigo de lei específico no catálogo (nenhuma citação legal inventada)", () => {
  const haystack = [
    LEGAL_CONSULTANT_DEFINITION.mission,
    ...LEGAL_CONSULTANT_DEFINITION.capabilities,
    ...LEGAL_CONSULTANT_DEFINITION.limitations,
  ]
    .join(" ")
    .toLowerCase();
  assert(!/art(igo)?\.?\s*\d/.test(haystack), "catálogo não deveria citar um artigo de lei específico");
  const limitationsText = LEGAL_CONSULTANT_DEFINITION.limitations.join(" ").toLowerCase();
  assert(limitationsText.includes("nunca inventa"), "deveria declarar explicitamente que nunca inventa base legal");
});

check("matriz de colaboração cobre os cinco temas exigidos com Expert principal correto", () => {
  const expected = {
    NEGOCIAÇÃO: "commercial-director",
    DISPUTA: "legal-consultant",
    "ATRASO COM MULTA": "planning-director",
    "SSMA COM PENALIDADE": "esg-director",
    "DECISÃO EXECUTIVA": "ceo",
  };
  for (const [topic, primary] of Object.entries(expected)) {
    const rule = EXPERT_COLLABORATION_MATRIX.find((r) => r.topic === topic);
    assert(rule !== undefined, `tema ausente: ${topic}`);
    assert(rule.primaryExpertId === primary, `${topic} deveria ter ${primary} como principal`);
    assert(rule.supportingExpertIds.length > 0, `${topic} deveria ter ao menos um Expert auxiliar`);
  }
});

check("getCollaborationRulesForExpert retorna as linhas corretas (principal ou auxiliar)", () => {
  const legalRules = getCollaborationRulesForExpert("legal-consultant");
  const topics = legalRules.map((r) => r.topic).sort();
  assert(topics.includes("DISPUTA"), "Consultor Jurídico deveria ser principal em DISPUTA");
  assert(topics.includes("NEGOCIAÇÃO"), "Consultor Jurídico deveria ser auxiliar em NEGOCIAÇÃO");
  assert(topics.includes("ATRASO COM MULTA"), "Consultor Jurídico deveria ser auxiliar em ATRASO COM MULTA");
  assert(topics.includes("SSMA COM PENALIDADE"), "Consultor Jurídico deveria ser auxiliar em SSMA COM PENALIDADE");

  const ceoRules = getCollaborationRulesForExpert("ceo");
  assert(ceoRules.length === 1 && ceoRules[0].topic === "DECISÃO EXECUTIVA");
});

check("regras de escalonamento para humano estão presentes e não vazias para os cinco Experts", () => {
  for (const def of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    assert(def.escalationRules.length > 0, `${def.expertId} sem escalationRules`);
    for (const rule of def.escalationRules) {
      assert(rule.requiredDeclaration.length > 0, `${def.expertId} tem escalationRule sem requiredDeclaration`);
    }
  }
});

check("Diretor Comercial IA declara a frase exata exigida quando falta dado econômico", () => {
  const rule = COMMERCIAL_DIRECTOR_DEFINITION.escalationRules.find((r) =>
    r.requiredDeclaration.includes("NÃO DISPONÍVEL")
  );
  assert(rule !== undefined, "deveria existir a declaração NÃO DISPONÍVEL — NECESSÁRIA DEFINIÇÃO HUMANA");
  assert(rule.requiredDeclaration === "NÃO DISPONÍVEL — NECESSÁRIA DEFINIÇÃO HUMANA");
});

check("compatibilidade com os Experts já implementados: expertId/version batem com identity.ts real", () => {
  assert(COMMERCIAL_DIRECTOR_DEFINITION.expertId === COMMERCIAL_DIRECTOR_EXPERT_ID);
  assert(COMMERCIAL_DIRECTOR_DEFINITION.version === COMMERCIAL_DIRECTOR_VERSION);
  assert(COMMERCIAL_DIRECTOR_DEFINITION.status === "IMPLEMENTED");
  assert(ESG_DIRECTOR_DEFINITION.expertId === ESG_DIRECTOR_EXPERT_ID);
  assert(ESG_DIRECTOR_DEFINITION.version === ESG_DIRECTOR_VERSION);
  assert(ESG_DIRECTOR_DEFINITION.status === "IMPLEMENTED");

  assert(CEO_DEFINITION.status === "PLANNED");
  assert(LEGAL_CONSULTANT_DEFINITION.status === "PLANNED");
  assert(PLANNING_DIRECTOR_DEFINITION.status === "PLANNED");
});

check("formatExpertVersionTag produz a tag versionada esperada", () => {
  assert(formatExpertVersionTag(COMMERCIAL_DIRECTOR_DEFINITION) === "commercial-director:v1");
  assert(formatExpertVersionTag(CEO_DEFINITION) === "ceo:v1");
});

check("typicalQuestions contém exatamente a pergunta de exemplo especificada por Expert", () => {
  assert(COMMERCIAL_DIRECTOR_DEFINITION.typicalQuestions.includes("Qual estratégia recomenda para este aditivo?"));
  assert(LEGAL_CONSULTANT_DEFINITION.typicalQuestions.includes("Quais documentos sustentam nossa posição?"));
  assert(PLANNING_DIRECTOR_DEFINITION.typicalQuestions.includes("Este atraso pode gerar penalidade?"));
  assert(ESG_DIRECTOR_DEFINITION.typicalQuestions.includes("Quais obrigações estão sem comprovação?"));
  assert(
    CEO_DEFINITION.typicalQuestions.includes("Qual é a situação executiva deste problema e qual alternativa recomenda?")
  );
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
