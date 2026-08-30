// Regra de elevação a risco CRÍTICO por atraso de cronograma — pura,
// função real executada (não reimplementação em JS de uma regra que
// vive só em outro lugar). Cobre exatamente os 3 buckets do requisito
// desta rodada + a preservação da maior severidade + a garantia de que
// a elevação NUNCA vem de texto livre/contagem de dias (só do campo
// estruturado).
//
// Uso:
//   node scripts/test-schedule-delay-critical-severity-rule.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("REGRA DO RISCO CRÍTICO — atraso de cronograma x recuperabilidade");
console.log("======================================");
console.log("");

const { deriveScheduleDelaySeverity } = await import(
  "../apps/web/lib/ai/experts/planning-director/derive-schedule-delay-severity.ts"
);

function recoverability(overrides = {}) {
  return {
    classification: "RECUPERAVEL",
    contractualDeadlineOrLimitExceeded: false,
    evidence: {
      criticalPath: null,
      floatDays: null,
      plannedVsActualProgress: null,
      productivity: null,
      mobilizedResources: null,
      remainingDuration: null,
      recoveryPlan: null,
      reinforcementReprogrammingOrExtensionNeeded: null,
    },
    justification: "Justificativa de teste.",
    assessedAt: "2026-08-29T12:00:00Z",
    ...overrides,
  };
}

check("atraso (dentro do prazo) + RECUPERAVEL → ALTA, sem decisão humana forçada", () => {
  const result = deriveScheduleDelaySeverity(recoverability({ contractualDeadlineOrLimitExceeded: false, classification: "RECUPERAVEL" }));
  assert(result.severity === "ALTA", `esperado ALTA, obtido ${result.severity}`);
  assert(result.requiresHumanDecision === false);
});

check("prazo ULTRAPASSADO + RECUPERAVEL → ALTA (recuperação viável nunca vira CRÍTICO sozinha, mesmo com prazo já estourado)", () => {
  const result = deriveScheduleDelaySeverity(recoverability({ contractualDeadlineOrLimitExceeded: true, classification: "RECUPERAVEL" }));
  assert(result.severity === "ALTA", `esperado ALTA, obtido ${result.severity}`);
});

check("CRÍTICO — prazo ULTRAPASSADO + IMPROVAVEL → CRITICA, exatamente a combinação exigida pela regra", () => {
  const result = deriveScheduleDelaySeverity(recoverability({ contractualDeadlineOrLimitExceeded: true, classification: "IMPROVAVEL" }));
  assert(result.severity === "CRITICA", `esperado CRITICA, obtido ${result.severity}`);
  assert(result.requiresHumanDecision === false);
});

check("IMPROVAVEL mas prazo AINDA NÃO ultrapassado → ALTA, nunca CRÍTICO (as DUAS condições são exigidas juntas)", () => {
  const result = deriveScheduleDelaySeverity(recoverability({ contractualDeadlineOrLimitExceeded: false, classification: "IMPROVAVEL" }));
  assert(result.severity === "ALTA", `esperado ALTA (só 1 das 2 condições), obtido ${result.severity}`);
});

check("recuperabilidade INCERTA (evidências insuficientes) → ALTA + DECISÃO HUMANA NECESSÁRIA, mesmo com prazo ultrapassado", () => {
  const result = deriveScheduleDelaySeverity(recoverability({ contractualDeadlineOrLimitExceeded: true, classification: "INCERTA" }));
  assert(result.severity === "ALTA", `esperado ALTA, obtido ${result.severity}`);
  assert(result.requiresHumanDecision === true, "INCERTA deveria sinalizar decisão humana necessária");
});

check("nenhuma avaliação estruturada disponível (null) → ALTA + DECISÃO HUMANA NECESSÁRIA — nunca CRÍTICO por ausência de dado", () => {
  const result = deriveScheduleDelaySeverity(null);
  assert(result.severity === "ALTA");
  assert(result.requiresHumanDecision === true);
});

check("CRÍTICO — preserva a MAIOR severidade: uma severidade CRITICA já calculada por outra fonte nunca é rebaixada, mesmo que este atraso sozinho só desse ALTA", () => {
  const result = deriveScheduleDelaySeverity(recoverability({ contractualDeadlineOrLimitExceeded: false, classification: "RECUPERAVEL" }), "CRITICA");
  assert(result.severity === "CRITICA", `esperado CRITICA preservada, obtido ${result.severity}`);
});

check("CRÍTICO — o oposto NUNCA acontece: uma severidade menor já existente (ex.: MEDIA) é substituída pela CRITICA calculada aqui quando a combinação exige", () => {
  const result = deriveScheduleDelaySeverity(recoverability({ contractualDeadlineOrLimitExceeded: true, classification: "IMPROVAVEL" }), "MEDIA");
  assert(result.severity === "CRITICA", `esperado CRITICA (maior que MEDIA), obtido ${result.severity}`);
});

check("CRÍTICO — a função só aceita 2 insumos estruturados (classification, contractualDeadlineOrLimitExceeded) — NUNCA um parâmetro de texto livre nem de contagem de dias", () => {
  const source = readSource("apps/web/lib/ai/experts/planning-director/derive-schedule-delay-severity.ts");
  assert(
    /function deriveScheduleDelaySeverity\(\s*recoverability: ScheduleRecoverabilityAssessment \| null,\s*currentHighestSeverity: AlertSeverity/.test(source),
    "a assinatura deveria aceitar só o resultado estruturado + a severidade já calculada, nunca texto/dias"
  );
  assert(!/\bdays\b|\bdaysLate\b|\bdelayDays\b/i.test(source), "não deveria haver nenhum parâmetro/lógica baseada em contagem de dias");
  assert(!/\.includes\(|\.match\(|\/.*i?\)\.test\(/.test(source.replace("classification === ", "")), "não deveria haver nenhuma inspeção de texto livre (string matching) decidindo a severidade");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
