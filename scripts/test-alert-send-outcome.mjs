// Envio manual de alerta: destino efetivo e confirmação baseados no resultado real do
// servidor (modo piloto), sem enviar nada (só funções puras + leitura de código-fonte).
//
// Uso: node scripts/test-alert-send-outcome.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { describeAlertSendOutcome, maskEmailAddress, pilotNoticeBeforeSend } = await import("../apps/web/lib/email/send-outcome.ts");
const { getPilotSendNotice } = await import("../apps/web/lib/email/pilot-notice.ts");
const { resolveEffectiveRecipient } = await import("../apps/web/lib/email/pilot-outbound-guard.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8").replace(/\r\n/g, "\n");

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

const PILOT_BOX = "crm@axion.com.br";

console.log("");
console.log("======================================");
console.log("ENVIO MANUAL — DESTINO EFETIVO / PILOTO");
console.log("======================================");
console.log("");

check("endereços aparecem parcialmente ocultos", () => {
  assert.equal(maskEmailAddress("maria.souza@axion.com.br"), "ma***@axion.com.br");
  assert.equal(maskEmailAddress("sem-arroba"), "***");
});

check("PILOTO: a mensagem diz que o colaborador selecionado NÃO recebeu e mostra o destino efetivo", () => {
  const o = describeAlertSendOutcome({ mode: "PILOT", intendedRecipientEmail: "maria.souza@axion.com.br", effectiveRecipientEmail: PILOT_BOX });
  assert.equal(o.redirected, true);
  assert.match(o.message, /^MODO PILOTO:/);
  assert.match(o.message, /redirecionada para a caixa de teste \(cr\*\*\*@axion\.com\.br\)/);
  assert.match(o.message, /colaborador selecionado \(ma\*\*\*@axion\.com\.br\) NÃO recebeu/);
  assert.ok(!o.message.includes("maria.souza@") && !o.message.includes(PILOT_BOX), "sem endereços completos");
});

check("PRODUÇÃO: aceite do provedor, nunca 'entrega confirmada'", () => {
  const o = describeAlertSendOutcome({ mode: "PRODUCTION", intendedRecipientEmail: "maria.souza@axion.com.br", effectiveRecipientEmail: "maria.souza@axion.com.br" });
  assert.equal(o.redirected, false);
  assert.match(o.message, /provedor aceitou a mensagem para ma\*\*\*@axion\.com\.br/);
  assert.match(o.message, /não é confirmação de entrega/);
  assert.ok(!/entregue|enviado para/i.test(o.message));
});

check("nenhuma mensagem de resultado afirma 'Alerta enviado para <colaborador>' (texto antigo removido)", () => {
  for (const mode of ["PILOT", "PRODUCTION"]) {
    const o = describeAlertSendOutcome({ mode, intendedRecipientEmail: "a@b.co", effectiveRecipientEmail: mode === "PILOT" ? PILOT_BOX : "a@b.co" });
    assert.ok(!/^Alerta enviado para/.test(o.message));
  }
  assert.ok(!src("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts").includes("Alerta enviado para"));
});

check("servidor: o destino efetivo vem de resolveEffectiveRecipient (mesma fonte do guard) e o resultado devolve modo/pretendido/efetivo", () => {
  const mailer = src("apps/web/lib/email/send-contract-alert-email.ts");
  assert.ok(mailer.includes("resolveEffectiveRecipient(input.recipientEmail)"));
  for (const field of ["outboundMode", "intendedRecipientEmail", "effectiveRecipientEmail"]) assert.ok(mailer.includes(field), field);
  const action = src("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert.ok(action.includes("describeAlertSendOutcome({"));
  assert.ok(action.includes("sendResult.outboundMode"));
});

check("guard e modo de saída preservados: o envio continua passando por applyPilotOutboundGuard no provider", () => {
  assert.ok(src("apps/web/lib/email/gmail-email-provider.ts").includes("applyPilotOutboundGuard"));
  assert.ok(src("apps/web/lib/email/fake-email-provider.ts").includes("applyPilotOutboundGuard"));
  assert.ok(!src("apps/web/lib/email/send-contract-alert-email.ts").includes("process.env.ACC_OUTBOUND_MODE"), "sem segunda leitura do modo");
});

check("aviso ANTES do envio: em piloto aparece; em produção não", () => {
  const prev = { mode: process.env.ACC_OUTBOUND_MODE, rcpt: process.env.ACC_PILOT_RECIPIENT };
  try {
    process.env.ACC_OUTBOUND_MODE = "pilot";
    process.env.ACC_PILOT_RECIPIENT = PILOT_BOX;
    const notice = getPilotSendNotice();
    assert.ok(notice && /Modo piloto ativo/.test(notice) && /cr\*\*\*@axion\.com\.br/.test(notice));
    assert.equal(resolveEffectiveRecipient("x@y.co").effectiveRecipientEmail, PILOT_BOX);

    process.env.ACC_OUTBOUND_MODE = "production";
    assert.equal(getPilotSendNotice(), null);

    // fail-closed: valor desconhecido segue sendo piloto
    process.env.ACC_OUTBOUND_MODE = "qualquer";
    assert.ok(getPilotSendNotice());

    // piloto mal configurado: avisa que o envio será bloqueado
    process.env.ACC_OUTBOUND_MODE = "pilot";
    process.env.ACC_PILOT_RECIPIENT = "outra@pessoa.co";
    assert.match(getPilotSendNotice(), /mal configurado/);
  } finally {
    if (prev.mode === undefined) delete process.env.ACC_OUTBOUND_MODE; else process.env.ACC_OUTBOUND_MODE = prev.mode;
    if (prev.rcpt === undefined) delete process.env.ACC_PILOT_RECIPIENT; else process.env.ACC_PILOT_RECIPIENT = prev.rcpt;
  }
});

check("formulário: exibe o aviso de piloto e mostra a mensagem de piloto em destaque âmbar (não verde de sucesso)", () => {
  const form = src("apps/web/components/ledger/send-contract-alert-form.tsx");
  assert.ok(form.includes("pilotNotice"));
  assert.ok(form.includes('state.success.startsWith("MODO PILOTO")'));
  assert.ok(src("apps/web/app/[projectId]/ledger/[eventId]/page.tsx").includes("pilotNotice={getPilotSendNotice()}"));
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
