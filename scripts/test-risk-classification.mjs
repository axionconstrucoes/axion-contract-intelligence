// Sugestão de grau de risco pelos critérios de Reynaldo (módulo puro) — quatro riscos, justificativas,
// incerteza, ausência de limiar de dias, fato × inferência × recomendação e recorrência preservada.
// Nada acessa banco, rede ou IA.
//
// Uso: node scripts/test-risk-classification.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const R = await import("../apps/web/lib/risk-classification/suggest-risk.ts");
const B = await import("../apps/web/lib/risk-classification/facts-builders.ts");
const P = await import("../apps/web/lib/alerts/repeat-policy.ts");

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

const CLAUSE = { kind: "CLAUSULA", label: "Cláusula 12.3 – Multa por atraso", url: "/p/revisao-clausulas#12-3" };
const EVID = [{ kind: "EVIDENCIA", label: "Notificação do cliente (e-mail)", url: "/p/ledger/e1#evidencia-1" }];
const facts = (over = {}) => ({
  nature: { value: "DESCUMPRIMENTO_CONTRATUAL", source: "PESSOA_AUTORIZADA" },
  obligation: { description: "Entregar o as-built no prazo", clauseRef: CLAUSE },
  consequence: { description: "Multa de 0,5% por dia de atraso", clauseRef: CLAUSE },
  deadline: { status: "A_VENCER", dueDate: "2027-05-30" },
  imminence: { value: "SIM", source: "PESSOA_AUTORIZADA" },
  mitigationTime: { value: "SIM", source: "PESSOA_AUTORIZADA" },
  evidence: EVID,
  ...over,
});

console.log("======================================");
console.log("CLASSIFICAÇÃO DE RISCO — CRITÉRIOS");
console.log("======================================");

check("CRÍTICO: iminente + penalidade com cláusula + sem tempo para mitigar", () => {
  const s = R.suggestRisk(facts({ mitigationTime: { value: "NAO", source: "PESSOA_AUTORIZADA" } }));
  assert.equal(s.level, "CRITICA");
  assert.equal(s.status, "DEFINIDA");
  assert.equal(s.uncertainty, "BAIXA");
  assert.equal(s.criterion, R.RISK_CRITERIA.CRITICA);
  assert.deepEqual(s.missingInformation, []);
});

check("ALTO: iminente + penalidade com cláusula + ainda há tempo para mitigar", () => {
  const s = R.suggestRisk(facts());
  assert.equal(s.level, "ALTA");
  assert.equal(s.criterion, R.RISK_CRITERIA.ALTA);
});

check("MÉDIO: descumprimento NÃO iminente (possível consequência a médio prazo)", () => {
  const s = R.suggestRisk(facts({ imminence: { value: "NAO", source: "PESSOA_AUTORIZADA" }, mitigationTime: { value: "DESCONHECIDA" } }));
  assert.equal(s.level, "MEDIA");
  assert.equal(s.status, "DEFINIDA");
});

check("BAIXO: risco processual (acompanhamento/organização)", () => {
  const s = R.suggestRisk(facts({ nature: { value: "PROCESSUAL", source: "PESSOA_AUTORIZADA" }, obligation: null, consequence: null }));
  assert.equal(s.level, "BAIXA");
  assert.equal(s.criterion, R.RISK_CRITERIA.BAIXA);
});

check("prazo VENCIDO é o único fato derivado: conta como iminente sem declaração", () => {
  const s = R.suggestRisk(facts({ deadline: { status: "VENCIDO", dueDate: "2027-04-01" }, imminence: { value: "DESCONHECIDA" }, mitigationTime: { value: "NAO", source: "PESSOA_AUTORIZADA" } }));
  assert.equal(s.level, "CRITICA");
  assert.ok(s.basis.some((b) => b.kind === "FATO" && /vencido/.test(b.text)));
});

check("SEM penalidade apoiada em cláusula: nunca afirma penalização — fica MÉDIO e pede confirmação", () => {
  const noRef = R.suggestRisk(facts({ consequence: { description: "Multa de 0,5% por dia", clauseRef: null } }));
  assert.equal(noRef.level, "MEDIA");
  assert.ok(noRef.missingInformation.some((m) => /penalidade/i.test(m)));
  assert.ok(!noRef.basis.some((b) => b.kind === "FATO" && /Consequência contratual prevista/.test(b.text)), "penalidade sem cláusula não vira fato");
  assert.ok(noRef.basis.some((b) => b.kind === "INFERENCIA" && /não se afirma penalização/.test(b.text)));
  const none = R.suggestRisk(facts({ consequence: null }));
  assert.equal(none.level, "MEDIA");
});

check("dados insuficientes: não escolhe — INDETERMINADA, níveis possíveis, incerteza ALTA e o que confirmar", () => {
  const s = R.suggestRisk(facts({ imminence: { value: "DESCONHECIDA" }, deadline: { status: "DESCONHECIDO" } }));
  assert.equal(s.level, null);
  assert.equal(s.status, "INDETERMINADA");
  assert.equal(s.uncertainty, "ALTA");
  assert.deepEqual(s.possibleLevels, ["MEDIA", "ALTA"], "entre iminente (ALTA, com tempo) e não iminente (MÉDIA)");
  assert.equal(s.minimumLevel, "MEDIA");
  assert.ok(s.missingInformation.some((m) => /iminente/.test(m)));
  assert.ok(s.missingInformation.some((m) => /Prazo contratual/.test(m)));
  assert.ok(s.basis.some((b) => b.kind === "RECOMENDACAO"));
});

check("iminente + penalidade confirmada + mitigação desconhecida: ALTO ou CRÍTICO, sem escolher", () => {
  const s = R.suggestRisk(facts({ mitigationTime: { value: "DESCONHECIDA" } }));
  assert.equal(s.level, null);
  assert.deepEqual(s.possibleLevels, ["ALTA", "CRITICA"]);
  assert.ok(s.missingInformation.some((m) => /tempo para mitigação/.test(m)));
});

check("natureza desconhecida (ex.: providência sem vínculo contratual): INDETERMINADA, sem inventar", () => {
  const s = R.suggestRisk({ nature: { value: "DESCONHECIDA" }, deadline: { status: "SEM_PRAZO" }, imminence: { value: "DESCONHECIDA" }, mitigationTime: { value: "DESCONHECIDA" }, evidence: [] });
  assert.equal(s.level, null);
  assert.ok(s.missingInformation.some((m) => /Natureza/.test(m)));
  assert.ok(s.missingInformation.some((m) => /Evidência/.test(m)));
  assert.equal(s.uncertainty, "ALTA");
});

check("sem evidência: nível definido mas incerteza sobe e a falta é apontada", () => {
  const s = R.suggestRisk(facts({ evidence: [] }));
  assert.equal(s.level, "ALTA");
  assert.equal(s.uncertainty, "MEDIA");
  assert.ok(s.missingInformation.some((m) => /Evidência/.test(m)));
});

check("fato × inferência × recomendação: fatos trazem referência verificável; texto os rotula separadamente", () => {
  const s = R.suggestRisk(facts());
  const kinds = new Set(s.basis.map((b) => b.kind));
  assert.ok(kinds.has("FATO") && kinds.has("INFERENCIA"));
  for (const f of s.basis.filter((b) => b.kind === "FATO" && /Obrigação|Consequência|evidência/.test(b.text))) {
    assert.ok(f.refs.length > 0, `fato sem referência: ${f.text}`);
    assert.ok(f.refs.every((r) => r.label));
  }
  assert.match(s.justification, /\[Fato\]/);
  assert.match(s.justification, /\[Inferência\]/);
  assert.equal(s.requiresHumanReview, true);
});

check("nenhum limiar numérico de dias: a mesma data resulta no que foi DECLARADO, não em dias", () => {
  const src = readFileSync(new URL("../apps/web/lib/risk-classification/suggest-risk.ts", import.meta.url), "utf8");
  assert.ok(!/\bdias?\s*[<>]=?\s*\d|\d+\s*dias\s*(para|de)\s*(crit|alt|m[eé]d)/i.test(src.replace(/\/\/.*$/gm, "")), "sem corte de dias no código");
  const a = R.suggestRisk(facts({ deadline: { status: "A_VENCER", dueDate: "2027-05-30" }, imminence: { value: "NAO", source: "PESSOA_AUTORIZADA" } }));
  const b = R.suggestRisk(facts({ deadline: { status: "A_VENCER", dueDate: "2027-12-30" }, imminence: { value: "NAO", source: "PESSOA_AUTORIZADA" } }));
  assert.equal(a.level, b.level, "data diferente, mesma declaração, mesmo nível");
});

check("formulário: valores inválidos viram 'desconhecido' e a cláusula só vale quando verificada e confirmada", () => {
  const form = B.parseRiskReviewForm({ nature: "XPTO", deadlineStatus: "A_VENCER", deadlineDate: "30/05/2027", imminence: "SIM", mitigationTime: "NAO", consequenceDescription: "Multa", consequenceInVerifiedClause: "on" });
  assert.equal(form.nature, "DESCONHECIDA");
  assert.equal(form.deadlineDate, null);
  const semClausula = B.buildRiskFacts({ form, verifiedClause: null, evidence: EVID });
  assert.equal(semClausula.consequence.clauseRef, null, "sem cláusula verificada a penalidade não tem apoio");
  const naoConfirmou = B.buildRiskFacts({ form: { ...form, consequenceInVerifiedClause: false }, verifiedClause: CLAUSE, evidence: EVID });
  assert.equal(naoConfirmou.consequence.clauseRef, null, "sem a confirmação da pessoa a penalidade não é atribuída à cláusula");
  const ok = B.buildRiskFacts({ form: { ...form, nature: "DESCUMPRIMENTO_CONTRATUAL" }, verifiedClause: CLAUSE, evidence: EVID });
  assert.equal(R.suggestRisk(ok).level, "CRITICA");
});

check("prazo de providência: data anterior a hoje = vencido; sem data = sem prazo (nada presumido)", () => {
  assert.equal(B.deadlineStatusFromDate("2027-03-01", "2027-03-02"), "VENCIDO");
  assert.equal(B.deadlineStatusFromDate("2027-03-02", "2027-03-02"), "A_VENCER");
  assert.equal(B.deadlineStatusFromDate(null, "2027-03-02"), "SEM_PRAZO");
});

check("recorrência preservada por grau: 1 / 2 / 4 / 7 dias (nada muda com a classificação)", () => {
  assert.deepEqual([P.REPEAT_INTERVAL_DAYS.CRITICA, P.REPEAT_INTERVAL_DAYS.ALTA, P.REPEAT_INTERVAL_DAYS.MEDIA, P.REPEAT_INTERVAL_DAYS.BAIXA], [1, 2, 4, 7]);
  assert.deepEqual([P.REPEAT_INTERVAL_HOURS.CRITICA, P.REPEAT_INTERVAL_HOURS.ALTA, P.REPEAT_INTERVAL_HOURS.MEDIA, P.REPEAT_INTERVAL_HOURS.BAIXA], [24, 48, 96, 168]);
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} falha(s).`);
process.exit(failed === 0 ? 0 : 1);
