import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK ${name}`);
}

const source = readFileSync("apps/web/lib/email/create-and-send-contract-alert-batch.ts", "utf8");

check("sender é server-only", () => {
  assert(source.startsWith('import "server-only";'));
});

check("cria lote PENDING antes do envio", () => {
  assert(source.includes('.from("contract_alert_batches")'));
  assert(source.includes("intended_recipient_email: recipient.email"));
  assert(source.includes("correlation_id: correlationId"));
});

check("valida destinatário ACTIVE no projeto", () => {
  assert(source.includes('.from("project_memberships")'));
  assert(source.includes('.eq("status", "ACTIVE")'));
});

check("valida todos os eventos no mesmo projeto antes de criar os itens", () => {
  assert(source.includes('.from("contract_events")'));
  assert(source.includes("eventRows.length !== eventIds.length"));
  assert(source.includes("event.project_id !== input.projectId"));
});

check("persiste snapshots mínimos dos itens", () => {
  assert(source.includes('.from("contract_alert_batch_items")'));
  assert(source.includes("position: index + 1"));
  assert(source.includes("severity: item.severity"));
  assert(source.includes("title_snapshot: item.title"));
});

check("usa template oficial do lote", () => {
  assert(source.includes("buildContractAlertBatchEmail"));
  assert(source.includes("respondItemUrl:"));
  assert(source.includes("batchUrl"));
});

check("usa o provider oficial e o pilot outbound guard", () => {
  assert(source.includes("getEmailProvider"));
  assert(source.includes("resolveEffectiveRecipient"));
  assert(source.includes("provider.send({"));
  assert(source.includes("to: recipient.email"));
});

check("o mesmo correlationId vai ao banco e ao provider", () => {
  assert(source.includes("const correlationId = crypto.randomUUID();"));
  assert(source.includes("correlation_id: correlationId"));
  assert(/provider\.send\(\{[\s\S]*?correlationId,[\s\S]*?\}\);/.test(source));
  assert(source.includes("CorrelationId=${correlationId}"));
});

check("falha de envio marca FAILED", () => {
  assert(source.includes('status: "FAILED"'));
  assert(source.includes('failure_reason: "Falha no envio do lote de alertas de contrato."'));
});

check("sucesso marca SENT antes dos registros auxiliares", () => {
  const sentUpdate = source.indexOf('status: "SENT"');
  const emailInsert = source.indexOf('.from("emails").insert');
  const auditInsert = source.indexOf('.from("audit_log_entries").insert');
  assert(sentUpdate !== -1 && emailInsert > sentUpdate && auditInsert > sentUpdate);
});

check("persiste destinatário efetivo e provider_message_id", () => {
  assert(source.includes("effective_recipient_email: resolvedRecipient.effectiveRecipientEmail"));
  assert(source.includes("provider_message_id: sent.providerMessageId"));
  assert(source.includes("sent_at: sent.sentAt"));
});

check("registra auditoria do lote", () => {
  assert(source.includes('action: "CONTRACT_ALERT_BATCH_SENT"'));
  assert(source.includes('entity_type: "CONTRACT_ALERT_BATCH"'));
  assert(source.includes("CorrelationId="));
});

console.log(`\n${passed} verificações concluídas.`);
