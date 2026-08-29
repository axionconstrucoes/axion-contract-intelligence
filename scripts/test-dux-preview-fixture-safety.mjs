// Bloco 5 — DUX/prévia de e-mail deve ser inequivocamente uma
// simulação. Testes REAIS (não reimplementação) contra:
//   1) fixture-safety-guard.ts: bloqueia qualquer projeto cujo nome
//      contenha o marcador de fixture, nunca bloqueia um projeto real
//      qualquer sem esse marcador;
//   2) send-contract-alert-email.ts: chama o guard ANTES de montar ou
//      enviar o e-mail (nunca depois);
//   3) generate-alert-email-preview.mjs: nunca acessa rede/DB real,
//      sempre usa domínio .invalid para o destinatário, sempre inclui os
//      3 marcadores de segurança exigidos ([TESTE] no assunto, banner
//      "PRÉVIA DE TESTE — NÃO ENVIAR", identificação "PROJETO FICTÍCIO —
//      NÃO CONTRATADO"), e a severidade CRÍTICA só é alcançada através
//      da função real deriveScheduleDelaySeverity (nunca hardcoded).
//
// Uso:
//   node scripts/test-dux-preview-fixture-safety.mjs

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
console.log("BLOCO 5 — segurança da fixture DUX / prévia de e-mail");
console.log("======================================");
console.log("");

const { assertNotEmailFixtureData, EMAIL_FIXTURE_PROJECT_NAME_MARKER, FixtureDataInProductionSendError } = await import(
  "../apps/web/lib/email/fixture-safety-guard.ts"
);

check("assertNotEmailFixtureData: lança para um nome de projeto com o marcador de fixture", () => {
  let threw = false;
  try {
    assertNotEmailFixtureData(`DUX Vinhedo - SP — ${EMAIL_FIXTURE_PROJECT_NAME_MARKER}`);
  } catch (error) {
    threw = error instanceof FixtureDataInProductionSendError;
  }
  assert(threw, "deveria lançar FixtureDataInProductionSendError");
});

check("assertNotEmailFixtureData: NUNCA bloqueia um projeto real qualquer, sem o marcador exato", () => {
  assertNotEmailFixtureData("Obra Residencial Jardim das Acácias - Fase 2");
  assertNotEmailFixtureData("DUX Vinhedo - SP");
});

check("send-contract-alert-email.ts: chama assertNotEmailFixtureData ANTES de montar/enviar o e-mail", () => {
  const source = readSource("apps/web/lib/email/send-contract-alert-email.ts");
  assert(source.includes("assertNotEmailFixtureData(input.alert.projectName)"), "guard não encontrado");
  const guardIndex = source.indexOf("assertNotEmailFixtureData(input.alert.projectName)");
  const buildIndex = source.indexOf("buildContractAlertEmail(");
  const sendIndex = source.indexOf("provider.send(");
  assert(guardIndex !== -1 && buildIndex !== -1 && sendIndex !== -1);
  assert(guardIndex < buildIndex && buildIndex < sendIndex, "o guard precisa rodar antes de montar e antes de enviar o e-mail");
});

check("generate-alert-email-preview.mjs: nunca importa/chama rede, banco ou provider real de e-mail", () => {
  const source = readSource("scripts/generate-alert-email-preview.mjs");
  assert(!/createSupabaseAdminClient|createSupabaseServerClient|getEmailProvider|\bfetch\(/.test(source));
  assert(!/sendContractAlertEmail\(/.test(source), "a prévia nunca deve CHAMAR o fluxo real de envio (menção em comentário é ok)");
});

check("generate-alert-email-preview.mjs: destinatário/remetente em domínio .invalid (RFC 2606, nunca entrega real)", () => {
  const source = readSource("scripts/generate-alert-email-preview.mjs");
  assert(/example\.invalid/.test(source));
  assert(!/reynaldo@axion\.com\.br/.test(source), "não deveria mais usar um e-mail real como destinatário da prévia");
});

check("generate-alert-email-preview.mjs: inclui os 3 marcadores de segurança exigidos no Bloco 5", () => {
  const source = readSource("scripts/generate-alert-email-preview.mjs");
  assert(source.includes("[TESTE]"), "faltando prefixo [TESTE] no assunto");
  assert(source.includes("PRÉVIA DE TESTE — NÃO ENVIAR"), "faltando banner de prévia");
  // A identificação "PROJETO FICTÍCIO — NÃO CONTRATADO" vem do MESMO
  // marcador exportado pelo guard (checado no teste seguinte) — aqui só
  // confirmamos que a constante do guard existe e carrega esse texto
  // exato, nunca uma string divergente reescrita à mão neste script.
  const guardSource = readSource("apps/web/lib/email/fixture-safety-guard.ts");
  assert(guardSource.includes('"PROJETO FICTÍCIO — NÃO CONTRATADO"'), "marcador de projeto fictício ausente do guard");
});

check("generate-alert-email-preview.mjs: usa o MESMO marcador exportado pelo guard (nunca uma string divergente)", () => {
  const source = readSource("scripts/generate-alert-email-preview.mjs");
  assert(source.includes("EMAIL_FIXTURE_PROJECT_NAME_MARKER"), "deveria reaproveitar a constante do guard, nunca duplicar a string");
});

check("generate-alert-email-preview.mjs: a severidade CRÍTICA vem de deriveScheduleDelaySeverity (nunca hardcoded 'CRITICA')", () => {
  const source = readSource("scripts/generate-alert-email-preview.mjs");
  assert(source.includes("deriveScheduleDelaySeverity(fixtureScheduleRecoverability)"), "deveria calcular a severidade pela regra real");
  assert(!/severity:\s*"CRITICA"/.test(source), "não deveria haver 'CRITICA' hardcoded diretamente no input do template");
});

check("generate-alert-email-preview.mjs: a fixture de recuperabilidade usa a combinação exigida (prazo ultrapassado + IMPROVAVEL)", () => {
  const source = readSource("scripts/generate-alert-email-preview.mjs");
  assert(/classification:\s*"IMPROVAVEL"/.test(source));
  assert(/contractualDeadlineOrLimitExceeded:\s*true/.test(source));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
