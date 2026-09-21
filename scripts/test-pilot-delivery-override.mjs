// Override de ENTREGA do piloto — todos os e-mails de alerta de risco do
// projeto entregues SOMENTE na caixa institucional (axion@axion.com.br);
// destinatário lógico/responsável/auditoria continuam da pessoa; nenhum
// CC/BCC; deduplicação por endereço efetivo; proteção contra loop.
// Funções REAIS (puras) + FakeEmailProvider com o guard global; nenhum
// e-mail real, nenhuma escrita remota.
//
// Uso:
//   node scripts/test-pilot-delivery-override.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { normalizeDeliveryOverrideEmail, resolveDeliveryAddress } = await import("../apps/web/lib/email/pilot-delivery-override");
const guard = await import("../apps/web/lib/email/pilot-outbound-guard");
const { FakeEmailProvider } = await import("../apps/web/lib/email/fake-email-provider");
const { planRiskAlerts } = await import("../apps/web/lib/risk-alerts/plan-risk-alerts");
const { applyAlertAction } = await import("../apps/web/lib/risk-alerts/alert-state-machine");
const { resolveMatrixPolicy } = await import("../apps/web/lib/sla/resolve-matrix-policy");
const { evaluatePilotReadiness, SUGGESTED_INGESTION_ALERT_SEVERITY } = await import("../apps/web/lib/risk-alerts/pilot-readiness");
const pipeline = await import("../apps/web/lib/risk-alerts/replies/reply-pipeline");
const { extractInboundFromGmail } = await import("../apps/web/lib/risk-alerts/replies/gmail-reply-extract");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n?/g, "\n");

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}
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

// ------------------------------------------------------------------ fixtures (piloto: um único humano, entrega institucional)
const PROJECT = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "cccccccc-0000-4000-8000-000000000001";
const U_R = "aaaaaaaa-0000-4000-8000-000000000001"; // responsável humano do piloto (N1/N2/N3)
const U_OUT = "aaaaaaaa-0000-4000-8000-000000000009"; // membro fora da allowlist
const HUMAN = "responsavel.piloto@axion.com.br"; // e-mail LÓGICO do humano (fictício)
const BOX = "axion@axion.com.br"; // caixa institucional (override)
const NOW = "2026-09-22T15:00:00.000Z";
const TZ = "America/Sao_Paulo";
const settings = { projectId: PROJECT, timezone: TZ, businessDayStartHour: 8, businessDayEndHour: 18, updatedAt: "" };
const responsibles = () => [{ id: "r1", projectId: PROJECT, area: "PLANEJAMENTO", responsibleDirectUserId: U_R, responsibleDirectInvitationId: null, responsibleDirectName: null, secondaryResponsibleUserId: null, secondaryResponsibleInvitationId: null, secondaryResponsibleName: null, escalation1UserId: U_R, escalation1InvitationId: null, escalation1Name: null, escalation2UserId: null, escalation2Name: null, boardUserId: U_R, boardInvitationId: null, boardName: null, updatedAt: "" }];
const rule = (riskLevel, o = {}) => ({ id: `rule-${riskLevel}`, projectId: PROJECT, riskLevel, area: null, timeUnit: "BUSINESS_HOURS", assumeDeadlineValue: 4, respondDeadlineValue: null, completeDeadlineValue: null, escalation2AfterValue: 4, boardAfterValue: 4, notifyByEmail: true, requiresAcknowledgmentConfirmation: true, requiresDelayJustification: true, isDefault: false, active: true, ...o });
const rules = [rule("LOW", { timeUnit: "BUSINESS_DAYS", assumeDeadlineValue: 3, requiresAcknowledgmentConfirmation: false }), rule("MEDIUM", { timeUnit: "BUSINESS_DAYS", assumeDeadlineValue: 1 }), rule("HIGH"), rule("CRITICAL", { timeUnit: "CLOCK_HOURS", assumeDeadlineValue: 1, escalation2AfterValue: 1, boardAfterValue: 2 })];
const recipients = () => new Map([
  [U_R, { userId: U_R, name: "Responsável Piloto", email: HUMAN, membershipStatus: "ACTIVE" }],
  [U_OUT, { userId: U_OUT, name: "Fora", email: "fora@axion.com.br", membershipStatus: "ACTIVE" }],
]);
const config = (o = {}) => ({ enabled: true, riskAlertsEnabled: true, pilotRecipientAllowlistUserIds: [U_R], senderDomain: "axion.com.br", severityMap: SUGGESTED_INGESTION_ALERT_SEVERITY, pilotProjectConfirmedAt: NOW, pilotDeliveryOverrideEmail: BOX, ...o });
const policyFor = (area, riskLevel) => resolveMatrixPolicy({ rules, responsibles: responsibles(), settings, area, riskLevel });
const riskCase = (o = {}) => ({ sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", area: "PLANEJAMENTO", riskLevel: "HIGH", title: "t", summary: "s", impact: "", recommendation: null, fingerprint: "fp-1", originPath: "x", closed: false, reference: "W37", ...o });
const existingRecord = (o = {}) => ({ id: "case-1", sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", area: "PLANEJAMENTO", riskLevel: "HIGH", previousRiskLevel: null, fingerprint: "fp-1", status: "OPEN", slaActionId: "act-1", lastDigestWindow: null, firstSeenAt: "2026-09-21T12:00:00.000Z", lastChangedAt: "2026-09-21T12:00:00.000Z", closedAt: null, title: "t", summary: "s", impact: "", recommendation: null, originPath: "", reference: "", state: "OPEN", currentLevel: "RESPONSAVEL", currentResponsibleUserId: U_R, previousResponsibleUserId: null, topLevelReachedAt: null, visibleCode: "ABCDEF12", ...o });
const linkedAction = (o = {}) => ({ id: "act-1", status: "PENDING", currentEscalationLevel: "RESPONSAVEL", assumeDueAt: "2026-09-21T16:00:00.000Z", respondDueAt: null, completeDueAt: null, acknowledgedAt: null, completedAt: null, contractualDeadline: null, responsibleUserId: U_R, ...o });
const plan = (o = {}) => planRiskAlerts({ now: o.now ?? NOW, projectId: PROJECT, projectName: "Piloto", featureEnabled: true, providerConfigured: true, dryRun: false, config: config(), timeZone: TZ, cases: o.cases ?? [riskCase()], existingCases: o.existingCases ?? [], linkedActions: o.linkedActions ?? new Map(), policyFor, recipients: recipients(), existingIdempotencyKeys: new Set(), previousDigestSentAt: null });
const snapshot = (o = {}) => ({ id: CASE_ID, projectId: PROJECT, sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", riskLevel: "HIGH", state: "OPEN", currentLevel: "RESPONSAVEL", topLevelReachedAt: null, currentResponsibleUserId: U_R, previousResponsibleUserId: null, slaActionId: "act-1", title: "t", reference: "r", activeForward: null, escalatedLevels: [], ...o });
const PILOT_ENV = { outboundMode: "pilot", pilotRecipient: "reynaldo@axion.com.br", alertReplyMailbox: BOX, now: new Date(NOW), onReplyToRemoved: () => {} };

/** Simula o que deliver() faz com uma entrada da outbox: override de entrega + guard do provider + envio fake. */
async function simulateDelivery(entry, eventKey, delivered = new Set()) {
  const resolution = resolveDeliveryAddress({ logicalEmail: entry.recipient.email, overrideEmail: config().pilotDeliveryOverrideEmail, eventKey });
  if (resolution.overridden && delivered.has(resolution.dedupKey)) return { skipped: true, resolution };
  let guarded = null;
  const provider = new FakeEmailProvider({ onGuardedInput: (i) => (guarded = i) });
  process.env.ACC_OUTBOUND_MODE = "pilot";
  process.env.ACC_PILOT_RECIPIENT = "reynaldo@axion.com.br";
  process.env.GOOGLE_GMAIL_INBOUND_MAILBOX = BOX;
  try {
    const token = pipeline.generateReplyToken();
    await provider.send({ to: resolution.deliveryEmail, subject: "Alerta", text: "t", correlationId: `c-${eventKey}`, replyTo: pipeline.buildOpaqueReplyTo(BOX, token), replyToContext: { kind: "RISK_ALERT_CONVERSATION", outboxId: "dddddddd-0000-4000-8000-000000000001", conversationId: "eeeeeeee-0000-4000-8000-000000000001" } });
  } finally {
    delete process.env.ACC_OUTBOUND_MODE;
    delete process.env.ACC_PILOT_RECIPIENT;
    delete process.env.GOOGLE_GMAIL_INBOUND_MAILBOX;
  }
  delivered.add(resolution.dedupKey);
  return { skipped: false, resolution, guarded };
}
const noPersonal = (guarded) => guarded.to === BOX && guarded.cc === undefined && guarded.bcc === undefined && !JSON.stringify(guarded).includes("reynaldo@") && !JSON.stringify(guarded).includes(HUMAN);

console.log("");
console.log("OVERRIDE DE ENTREGA DO PILOTO — TESTES");
console.log("======================================");
console.log("");

await check("1. Normalização/validação do endereço de override (lowercase; rejeita inválidos, CR/LF, listas)", () => {
  assert(normalizeDeliveryOverrideEmail("  Axion@Axion.com.br ") === BOX);
  for (const bad of ["", null, undefined, "axion", "a@b", "axion@axion.com.br,outro@axion.com.br", "axion@axion.com.br\r\nBcc: x@y.z", "<axion@axion.com.br>", "axion @axion.com.br"]) {
    assert(normalizeDeliveryOverrideEmail(bad) === null, `deveria rejeitar ${JSON.stringify(bad)}`);
  }
  const sql = readSource("supabase/migrations/20260921120000_pilot_delivery_override.sql");
  assert(sql.includes("add column pilot_delivery_override_email text") && sql.includes("pilot_delivery_override_email = lower(btrim(pilot_delivery_override_email))") && sql.includes("revoke update (pilot_delivery_override_email)"));
});
await check("2. Override muda só a entrega: destinatário lógico preservado; sem override => entrega normal", () => {
  const r = resolveDeliveryAddress({ logicalEmail: HUMAN, overrideEmail: BOX, eventKey: "case-1:IMMEDIATE:-" });
  assert(r.deliveryEmail === BOX && r.logicalEmail === HUMAN && r.overridden === true && r.dedupKey === `case-1:IMMEDIATE:-:${BOX}`);
  const n = resolveDeliveryAddress({ logicalEmail: HUMAN, overrideEmail: null, eventKey: "k" });
  assert(n.deliveryEmail === HUMAN && n.overridden === false);
  const same = resolveDeliveryAddress({ logicalEmail: BOX, overrideEmail: BOX, eventKey: "k" });
  assert(same.overridden === false && same.deliveryEmail === BOX);
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(cycle.includes("to: delivery.deliveryEmail,") && cycle.includes("enviado ao usuário ${recipientUserId}") && cycle.includes("Override de entrega do piloto"), "To efetivo + destinatário lógico na auditoria");
  assert(!/\bcc:|\bbcc:/.test(cycle), "nunca CC/BCC");
});
await check("3. Alerta imediato (HIGH): destinatário lógico = humano; entrega = caixa institucional; nunca reynaldo@", async () => {
  const p = plan();
  const immediate = p.outbox.filter((e) => e.notificationType === "IMMEDIATE");
  assert(immediate.length === 1 && immediate[0].recipient.userId === U_R && immediate[0].recipient.email === HUMAN && immediate[0].recipient.status === "PENDING");
  const { guarded, resolution } = await simulateDelivery(immediate[0], `case-1:IMMEDIATE:-`);
  assert(resolution.deliveryEmail === BOX && guarded && noPersonal(guarded), JSON.stringify(guarded));
  assert(guarded.replyTo === `axion+alerta-${pipeline.extractReplyTokens([guarded.replyTo])[0]}@axion.com.br`, "Reply-To = caixa institucional");
});
await check("4. Digest (LOW/MEDIUM, quarta 07:00): um único e-mail, entregue na caixa institucional", async () => {
  const p = plan({ now: "2026-09-23T10:30:00.000Z", cases: [riskCase({ riskLevel: "MEDIUM", fingerprint: "fp-m" }), riskCase({ sourceId: "cmp-2", riskLevel: "LOW", fingerprint: "fp-l" })] });
  const digest = p.outbox.filter((e) => e.notificationType === "DIGEST");
  assert(digest.length === 1 && digest[0].recipient.userId === U_R, `digest=${digest.length}`);
  const { guarded } = await simulateDelivery(digest[0], `${digest[0].digestWindow}:DIGEST:-`);
  assert(noPersonal(guarded));
});
await check("5. Escalonamento por prazo (N1→N2→N3) e imediato por ação: entrega na caixa institucional; níveis distintos na auditoria", async () => {
  const delivered = new Set();
  const late = plan({ now: "2026-09-21T17:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction()]]) });
  const esc = late.outbox.find((e) => e.notificationType === "ESCALATION");
  assert(esc && esc.escalationLevel === "ESCALAO_1" && esc.recipient.userId === U_R);
  const a = await simulateDelivery(esc, `case-1:ESCALATION:${esc.escalationLevel}`, delivered);
  assert(noPersonal(a.guarded));
  const t = applyAlertAction({ now: NOW, snapshot: snapshot({ currentLevel: "ESCALAO_1" }), action: "TAKING_ACTION", actorUserId: U_R, origin: "WEB", payload: { text: "x" }, policy: policyFor("PLANEJAMENTO", "HIGH"), config: config(), recipients: recipients(), eligibleForwardUserIds: [U_OUT] });
  const imm = t.outbox.find((e) => e.notificationType === "ESCALATION");
  assert(t.ok && imm.escalationLevel === "DIRETORIA" && imm.recipientUserId === U_R && imm.status === "PENDING");
  const b = await simulateDelivery({ recipient: { email: HUMAN } }, `${CASE_ID}:ESCALATION:DIRETORIA`, delivered);
  assert(!b.skipped && noPersonal(b.guarded), "nível diferente => evento diferente => entregue (não deduplicado)");
  assert(delivered.size === 2);
});
await check("6. Encaminhamento manual (ENVIAR P/ terceiro fora da allowlist): exceção do piloto mantém o destinatário lógico, mas a ENTREGA vai à caixa institucional", async () => {
  const t = applyAlertAction({ now: NOW, snapshot: snapshot(), action: "FORWARD", actorUserId: U_R, origin: "WEB", payload: { targetUserId: U_OUT, text: "veja", confirmed: true }, policy: policyFor("PLANEJAMENTO", "HIGH"), config: config(), recipients: recipients(), eligibleForwardUserIds: [U_OUT] });
  const fwd = t.outbox.find((e) => e.notificationType === "FORWARD");
  assert(t.ok && fwd.recipientUserId === U_OUT && fwd.status === "PENDING" && fwd.payloadSummary.pilotException === true);
  const { guarded, resolution } = await simulateDelivery({ recipient: { email: "fora@axion.com.br" } }, `${CASE_ID}:FORWARD:-`);
  assert(resolution.logicalEmail === "fora@axion.com.br" && resolution.deliveryEmail === BOX && noPersonal(guarded) && !JSON.stringify(guarded).includes("fora@"));
});
await check("7. Deduplicação pelo e-mail normalizado: mesmo evento × mesmo endereço efetivo não sai duas vezes", async () => {
  const delivered = new Set();
  const first = await simulateDelivery({ recipient: { email: HUMAN } }, "case-9:IMMEDIATE:-", delivered);
  const second = await simulateDelivery({ recipient: { email: "Outro.Logico@axion.com.br" } }, "case-9:IMMEDIATE:-", delivered);
  assert(!first.skipped && second.skipped === true, "segundo destinatário lógico do mesmo evento é deduplicado");
  const other = await simulateDelivery({ recipient: { email: HUMAN } }, "case-9:ESCALATION:ESCALAO_1", delivered);
  assert(!other.skipped);
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(cycle.includes("ctx.deliveredKeys.has(delivery.dedupKey)") && cycle.includes("Deduplicado pelo override de entrega do piloto") && cycle.includes("ctx.deliveredKeys.add(delivery.dedupKey);"));
});
await check("8. Nenhum envio para reynaldo@: guard não redireciona a caixa institucional; quem está fora da allowlist é suprimido, não redirecionado", () => {
  const r = guard.resolveEffectiveRecipient(BOX, PILOT_ENV);
  assert(r.mode === "PILOT" && r.effectiveRecipientEmail === BOX, "caixa institucional admitida em modo piloto");
  assert(guard.ACC_PILOT_INSTITUTIONAL_MAILBOXES.length === 1 && guard.ACC_PILOT_INSTITUTIONAL_MAILBOXES[0] === BOX);
  assert(guard.ACC_PILOT_ALLOWED_RECIPIENTS.length === 4, "lista fixa de participantes intacta");
  const p = plan({ cases: [riskCase()] });
  // Ninguém além do humano da allowlist é destinatário lógico; ninguém é redirecionado para reynaldo@.
  assert(p.outbox.every((e) => e.recipient.userId === U_R || e.recipient.status === "SUPPRESSED"));
  const sup = planRiskAlerts({ now: NOW, projectId: PROJECT, projectName: "P", featureEnabled: true, providerConfigured: true, dryRun: false, config: config({ pilotRecipientAllowlistUserIds: [U_OUT] }), timeZone: TZ, cases: [riskCase()], existingCases: [], linkedActions: new Map(), policyFor, recipients: recipients(), existingIdempotencyKeys: new Set(), previousDigestSentAt: null });
  assert(sup.outbox.filter((e) => e.notificationType === "IMMEDIATE").every((e) => e.recipient.status === "SUPPRESSED" && e.recipient.suppressionReason === "PILOT_RECIPIENT_SUPPRESSED"));
});
await check("9. Respostas: Reply-To = caixa institucional; mensagens da própria caixa (loop), autorespostas e bounces são ignoradas", () => {
  const ctx = { accMailboxes: [BOX], seenMessageIds: new Set(["<sent-1@acc>"]) };
  const base = { to: [`axion+alerta-${"x".repeat(24)}@axion.com.br`], messageId: "<r1@x>", inReplyTo: null, references: [] };
  assert(pipeline.filterInboundMessage({ ...base, from: BOX }, ctx) === "IGNORED_SELF", "mensagem originada da própria caixa");
  assert(pipeline.filterInboundMessage({ ...base, from: `axion+alerta-${"y".repeat(24)}@axion.com.br` }, ctx) === "IGNORED_SELF", "plus-address da própria caixa");
  assert(pipeline.filterInboundMessage({ ...base, from: HUMAN, autoSubmitted: "auto-replied" }, ctx) === "IGNORED_AUTO_REPLY");
  assert(pipeline.filterInboundMessage({ ...base, from: HUMAN, subject: "Resposta automática: ausente" }, ctx) === "IGNORED_AUTO_REPLY");
  assert(pipeline.filterInboundMessage({ ...base, from: "mailer-daemon@googlemail.com", returnPath: "<>" }, ctx) === "IGNORED_BOUNCE");
  assert(pipeline.filterInboundMessage({ ...base, from: HUMAN, messageId: "<sent-1@acc>" }, ctx) === "IGNORED_LOOP");
  assert(pipeline.filterInboundMessage({ ...base, from: HUMAN }, ctx) === "OK", "resposta humana legítima passa");
  const sentByBox = extractInboundFromGmail({ id: "m1", threadId: "t1", labelIds: ["SENT"], internalDate: "1789900000000", payload: { headers: [{ name: "From", value: `ACC <${BOX}>` }, { name: "To", value: BOX }], body: { data: "" } } }, BOX);
  assert(sentByBox.isSentByMailbox === true, "e-mail que o ACC enviou para a própria caixa nunca vira 'resposta'");
  const worker = readSource("scripts/weekly-schedule-email-ingest.mjs");
  assert(worker.includes("-from:me") && worker.includes("extracted.isSentByMailbox) return;"));
});
await check("10. Readiness: override deve ser a própria caixa inbound (respostas voltam à caixa que recebe os alertas); divergência bloqueia", () => {
  const base = { featureEnabled: true, config: config(), providerConfigured: true, explicitRuleLevels: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], matrixStatuses: [], allowlistValid: true, projectConfirmed: true, workspaceConfigured: true, severityMapConfigured: true, replyMailboxConfigured: true, replyMailbox: BOX, deliveryOverrideEmail: BOX };
  assert(evaluatePilotReadiness(base).ready === true);
  const mismatch = evaluatePilotReadiness({ ...base, replyMailbox: "outra@axion.com.br" });
  assert(!mismatch.ready && mismatch.blockers.includes("DELIVERY_OVERRIDE_REPLY_MAILBOX_MISMATCH"));
  assert(evaluatePilotReadiness({ ...base, deliveryOverrideEmail: null, replyMailbox: "outra@axion.com.br" }).ready === true, "sem override não há exigência de igualdade");
});
await check("11. Fora do piloto nada muda: sem override a entrega é normal; caixa institucional não é usuário; script valida o endereço", () => {
  const r = resolveDeliveryAddress({ logicalEmail: HUMAN, overrideEmail: null, eventKey: "k" });
  assert(r.deliveryEmail === HUMAN && !r.overridden);
  const store = readSource("apps/web/lib/risk-alerts/supabase-store.ts");
  assert(store.includes("pilotDeliveryOverrideEmail: normalizeDeliveryOverrideEmail(s(config.pilot_delivery_override_email))"));
  assert(!/profiles[\s\S]{0,200}axion@axion\.com\.br/.test(store), "nenhum profile/usuário fictício para a caixa institucional");
  const cfg = readSource("scripts/configure-weekly-schedule-ingestion.mjs");
  assert(cfg.includes('option("delivery-override")') && cfg.includes("--delivery-override inválido") && cfg.includes("payload.pilot_delivery_override_email = null;"));
  assert(!/reynaldo@|axion@axion\.com\.br/.test(readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts")), "nenhum endereço fixo no ciclo");
});
await check("12. Nenhum e-mail real, nenhuma escrita remota neste teste", () => {
  assert(!process.env.ACC_WEEKLY_REPORTS_ENABLED && !process.env.GOOGLE_GMAIL_INBOUND_MAILBOX && !process.env.ACC_OUTBOUND_MODE);
  assert(!/fetch\(|createSupabase/.test(readSource("apps/web/lib/email/pilot-delivery-override.ts")));
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
