// Critérios de risco NOS PROMPTS dos Experts e INTEGRAÇÃO real da sugestão/revisão no fluxo de
// alertas e providências (não só o módulo isolado). Sem rede, sem banco e SEM provedores externos:
// o script remove do ambiente qualquer variável de provedor/chave e confirma que o provedor
// resolvido é o simulado (fake).
//
// Uso: node scripts/test-risk-criteria-integration.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Garantia anti-chamada-real: nenhuma chave nem seleção de provedor herdada do ambiente.
for (const key of Object.keys(process.env)) {
  if (/^ANTHROPIC_|^AXION_AI_PROVIDER|^OPENAI_/.test(key)) delete process.env[key];
}

register("./ts-module-resolver.mjs", import.meta.url);
const criteria = await import("../apps/web/lib/ai/risk-criteria.ts");
const spec = await import("../apps/web/lib/ai/alert-consult/specialties.ts");
const notice = await import("../apps/web/lib/risk-classification/pre-send-notice.ts");
const risk = await import("../apps/web/lib/risk-classification/suggest-risk.ts");
const { resolveAiProviderForExpert } = await import("../apps/web/lib/ai/providers/resolve-provider-for-expert.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

console.log("\n======================================");
console.log("RISCO — CRITÉRIOS NOS PROMPTS E INTEGRAÇÃO NO FLUXO");
console.log("======================================\n");

await check("sem chave nem seleção de provedor no ambiente: todos os Experts resolvem para o provedor SIMULADO", async () => {
  for (const id of ["commercial-director", "esg-director", "ceo", "legal-consultant", "planning-director"]) {
    assert.equal(resolveAiProviderForExpert(id).id, "fake", id);
  }
});

const EXPERTS = [
  ["ceo", "CEO_INSTRUCTIONS", "CEO_VERSION"],
  ["commercial-director", "COMMERCIAL_DIRECTOR_INSTRUCTIONS", "COMMERCIAL_DIRECTOR_VERSION"],
  ["esg-director", "ESG_DIRECTOR_INSTRUCTIONS", "ESG_DIRECTOR_VERSION"],
  ["legal-consultant", "LEGAL_CONSULTANT_INSTRUCTIONS", "LEGAL_CONSULTANT_VERSION"],
  ["planning-director", "PLANNING_DIRECTOR_INSTRUCTIONS", "PLANNING_DIRECTOR_VERSION"],
];

await check("o texto dos quatro critérios é EXATO (definição de Reynaldo) e espelha RISK_CRITERIA da sugestão determinística", () => {
  const text = criteria.RISK_CRITERIA_INSTRUCTIONS;
  assert.ok(text.includes("CRÍTICO (CRITICAL): risco iminente de descumprimento e penalização contratual, exigindo ação imediata."));
  assert.ok(text.includes("ALTO (HIGH): risco iminente de descumprimento e penalização, com tempo para mitigação."));
  assert.ok(text.includes("MÉDIO (MEDIUM): risco com possível consequência a médio prazo."));
  assert.ok(text.includes("BAIXO (LOW): risco processual de acompanhamento ou organização."));
  // mesma ideia da regra determinística (RISK_CRITERIA): iminente/penalização/mitigação/médio prazo/processual
  assert.match(risk.RISK_CRITERIA.CRITICA, /iminente.*penalização contratual.*ação imediata/);
  assert.match(risk.RISK_CRITERIA.ALTA, /iminente.*tempo para mitigação/);
  assert.match(risk.RISK_CRITERIA.MEDIA, /médio prazo/);
  assert.match(risk.RISK_CRITERIA.BAIXA, /processual/);
});

await check("o bloco NÃO inventa limite de dias, exige fato × inferência × ausente, cláusula/evidência e confirmação", () => {
  const text = criteria.RISK_CRITERIA_INSTRUCTIONS;
  assert.ok(!/\b\d+\s*(dias?|horas?)\b/i.test(text), "sem número de dias/horas como limiar");
  assert.match(text, /NÃO existe número fixo de dias/);
  assert.match(text, /FATO .*INFERÊNCIA .*INFORMAÇÃO AUSENTE/s);
  assert.match(text, /Nunca transforme suspeita em fato/);
  assert.match(text, /só pode ser afirmada quando existir cláusula/);
  assert.match(text, /Cite as cláusulas e as evidências/);
  assert.match(text, /Pendente de confirmação/);
  assert.match(text, /peça a confirmação em\s+"informacoesFaltantes"/);
  assert.match(text, /SUGESTÃO provisória/);
});

for (const [dir, instrName, versionName] of EXPERTS) {
  await check(`${dir}: as instruções incluem o bloco de critérios e a versão foi atualizada`, async () => {
    const mod = await import(`../apps/web/lib/ai/experts/${dir}/identity.ts`);
    const instructions = mod[instrName];
    assert.ok(instructions.includes(criteria.RISK_CRITERIA_INSTRUCTIONS.trim()), "bloco de critérios presente");
    assert.ok(instructions.includes(mod[versionName]), "cabeçalho cita a versão atual");
  });
}

await check("versões subiram: ceo v3, comercial v4, ESG v3, jurídico v5, planejamento v5", async () => {
  const get = async (dir, name) => (await import(`../apps/web/lib/ai/experts/${dir}/identity.ts`))[name];
  assert.equal(await get("ceo", "CEO_VERSION"), "v3");
  assert.equal(await get("commercial-director", "COMMERCIAL_DIRECTOR_VERSION"), "v4");
  assert.equal(await get("esg-director", "ESG_DIRECTOR_VERSION"), "v3");
  assert.equal(await get("legal-consultant", "LEGAL_CONSULTANT_VERSION"), "v5");
  assert.equal(await get("planning-director", "PLANNING_DIRECTOR_VERSION"), "v5");
});

await check("ESG: o prompt continua dizendo que o risco ESG vem de regras objetivas (os critérios não substituem a regra)", async () => {
  const { ESG_DIRECTOR_INSTRUCTIONS } = await import("../apps/web/lib/ai/experts/esg-director/identity.ts");
  assert.match(ESG_DIRECTOR_INSTRUCTIONS, /já é calculado por regras objetivas/);
});

await check("consulta por especialidade: pergunta padrão intacta; instruções trazem critérios, opções práticas e peso das fontes", () => {
  assert.equal(
    spec.DEFAULT_ALERT_CONSULT_QUESTION,
    "Como tratar ou mitigar esta situação de risco? Apresente opções práticas de acordo com sua especialidade."
  );
  for (const s of spec.ALERT_CONSULT_SPECIALTIES) {
    const q = spec.composeSpecialtyQuestion(s, spec.DEFAULT_ALERT_CONSULT_QUESTION, "Contexto X");
    assert.ok(q.includes("opções PRÁTICAS conforme a sua especialidade"), s.id);
    assert.ok(q.includes("CRÍTICO = risco iminente de descumprimento e penalização contratual, exigindo ação imediata"), s.id);
    assert.ok(q.includes("BAIXO = risco processual de acompanhamento ou organização"), s.id);
    assert.ok(q.includes("Não existe número fixo de dias"), s.id);
    assert.ok(q.includes("NÃO executa ações nem altera o alerta"), s.id);
  }
});

await check("área ADMINISTRATIVO NÃO é mapeada para Documentação e Entrega: o cadastro não define o escopo da área; seleção manual", () => {
  assert.equal(spec.preselectSpecialtyForArea("ADMINISTRATIVO"), "geral");
  assert.equal(spec.preselectSpecialtyForArea("COMPRAS"), "geral");
  assert.equal(spec.preselectSpecialtyForArea(null), "geral");
  assert.equal(spec.preselectSpecialtyForArea("ENGENHARIA"), "engenharia");
});

// ---- Integração no fluxo (evidência de código) ----------------------------------------------
await check("EVENTOS: o grau efetivo (revisão humana) alimenta a leitura do evento e a lista — data.ts aplica applyReviewedSeverity em getEvents e getEvent", () => {
  const data = src("apps/web/lib/data.ts");
  assert.ok(/return applyReviewedSeverity\(supabase, mappedEvents\)/.test(data));
  assert.ok(/await applyReviewedSeverity\(supabase, \[\s*mapContractEventRow/.test(data));
});

await check("ENVIO MANUAL: usa o evento com o grau efetivo e a página mostra o aviso pré-envio ANTES do formulário", () => {
  const send = src("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert.match(send, /severity: event\.aiAssessment\.severity/);
  assert.match(send, /getEvent\(/);
  const page = src("apps/web/app/[projectId]/ledger/[eventId]/page.tsx");
  const noticeAt = page.indexOf("<EventRiskPreSendNotice");
  const formAt = page.indexOf("<SendContractAlertForm");
  assert.ok(noticeAt > 0 && noticeAt < formAt, "aviso antes do formulário");
  assert.ok(page.includes("<EventRiskReviewSection"), "painel de revisão na mesma página");
});

await check("LOTES/LEMBRETES: o produtor de lotes aplica o grau revisado", () => {
  assert.match(src("apps/web/lib/email/run-contract-alert-batches.ts"), /loadReviewedEventSeverities/);
});

await check("PROVIDÊNCIAS: painel de revisão em cada linha; revisão grava o grau na providência (base dos alertas) e ajusta o acompanhamento", () => {
  assert.match(src("apps/web/components/delivery/delivery-items-table.tsx"), /<RiskReviewPanel/);
  const sql = src("supabase/migrations/20261028120000_risk_classification_reviews.sql");
  assert.match(sql, /update public\.project_delivery_items set risk = p_new_level/);
  assert.match(sql, /update public\.alert_followups/);
  assert.match(src("apps/web/lib/delivery/delivery-alert-plan.ts"), /item\.risk/);
  assert.match(src("apps/web/components/delivery/delivery-admin-controls.tsx"), /MÉDIO provisório \(nunca crítico por padrão\)/);
});

await check("a revisão recalcula a sugestão NO SERVIDOR com cláusula, evidência e prazo lidos do banco (navegador só declara)", () => {
  const action = src("apps/web/app/[projectId]/risco/actions.ts");
  assert.match(action, /loadRiskSourceContext\(/);
  assert.match(action, /suggestRisk\(/);
  assert.match(action, /rpc\("review_risk_classification"/);
});

// ---- Aviso pré-envio (comportamento) --------------------------------------------------------
const CLAUSE = { kind: "CLAUSULA", label: "Cláusula 8.2 – Prazos", url: "/p/revisao-clausulas" };
const base = {
  currentLevel: "ALTA",
  originalLevel: "ALTA",
  hasHumanReview: false,
  verifiedClause: null,
  obligationDescription: null,
  evidence: [],
  deadline: { status: "DESCONHECIDO", date: null, ref: null },
};

await check("sem revisão e sem cláusula/prazo: pede confirmação, lista o que falta e NÃO cria certeza (nível indeterminado)", () => {
  const n = notice.buildPreSendRiskNotice(base);
  assert.equal(n.needsConfirmation, true);
  assert.equal(n.origin, "CLASSIFICACAO_AUTOMATICA");
  assert.equal(n.suggestion.status, "INDETERMINADA");
  assert.equal(n.suggestion.level, null);
  assert.ok(n.missingInformation.length > 0);
  assert.match(n.headline, /Alto \(classificação automática, ainda não revisada/);
});

await check("já revisada por pessoa autorizada: informa a origem e não repete o pedido de confirmação", () => {
  const n = notice.buildPreSendRiskNotice({ ...base, hasHumanReview: true, verifiedClause: CLAUSE });
  assert.equal(n.needsConfirmation, false);
  assert.equal(n.origin, "REVISADA_POR_PESSOA");
  assert.deepEqual(n.missingInformation, []);
  assert.match(n.headline, /revisada por pessoa autorizada/);
});

await check("o aviso é só leitura: o módulo não grava nem envia nada e a recorrência 1/2/4/7 não é tocada", async () => {
  const code = src("apps/web/lib/risk-classification/pre-send-notice.ts");
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(/.test(code));
  const policy = await import("../apps/web/lib/alerts/repeat-policy.ts");
  assert.deepEqual(policy.REPEAT_INTERVAL_DAYS, { CRITICA: 1, ALTA: 2, MEDIA: 4, BAIXA: 7 });
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
