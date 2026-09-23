import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const producer = readFileSync("apps/web/lib/email/run-contract-alert-batches.ts", "utf8");
const weekly = readFileSync("apps/web/lib/email/run-weekly-alert-digests.ts", "utf8");
const cron = readFileSync("apps/web/app/api/cron/weekly-alert-digest/route.ts", "utf8");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK ${name}`);
}

check("produtor é server-only", () => {
  assert(producer.startsWith('import "server-only";'));
});

check("somente LOW/MEDIUM entram no lote automático de contrato", () => {
  assert(producer.includes('.in("risk_level", ["LOW", "MEDIUM"])'));
  assert(!producer.includes('"HIGH", "CRITICAL"'));
});

check("exige responsável e evento contratual vinculados", () => {
  assert(producer.includes('.not("responsible_user_id", "is", null)'));
  assert(producer.includes('.not("related_event_id", "is", null)'));
});

check("ações concluídas/canceladas não entram", () => {
  assert(producer.includes('.not("status", "in", "(COMPLETED,CANCELLED)")'));
});

check("idempotência bloqueia eventos já em PENDING/SENT/RESPONDED", () => {
  assert(producer.includes('.from("contract_alert_batch_items")'));
  assert(producer.includes('.from("contract_alert_batches")'));
  assert(producer.includes('.in("status", ["PENDING", "SENT", "RESPONDED"])'));
  assert(producer.includes("blockedEventIds.add(row.event_id)"));
});

check("FAILED não bloqueia retry automático", () => {
  const statusFilter = producer.match(/\.in\("status", \[(.*?)\]\)/s)?.[1] ?? "";
  assert(!statusFilter.includes('"FAILED"'));
});

check("evento duplicado por múltiplas ações SLA entra uma única vez e preserva maior risco", () => {
  assert(producer.includes("const actionByEventId = new Map"));
  assert(producer.includes('current.risk_level === "LOW" && action.risk_level === "MEDIUM"'));
});

check("produtor carrega evento, avaliação IA e evidências reais", () => {
  assert(producer.includes('.from("contract_events")'));
  assert(producer.includes('.from("event_ai_assessments")'));
  assert(producer.includes('.from("event_evidence")'));
});

check("risco operacional da SLA tem fallback determinístico para severidade do lote", () => {
  assert(producer.includes('LOW: "BAIXA"'));
  assert(producer.includes('MEDIUM: "MEDIA"'));
  assert(producer.includes("assessment?.severity ?? SLA_TO_ALERT_SEVERITY[action.risk_level]"));
});

check("agrupa por projeto + responsável e usa sender validado", () => {
  assert(producer.includes("groupKey(action.project_id, action.responsible_user_id)"));
  assert(producer.includes("createAndSendContractAlertBatch({"));
  assert(producer.includes("recipientUserId: first.responsible_user_id"));
});

check("override institucional de entrega vem da configuração por projeto, nunca hardcoded", () => {
  assert(producer.includes("pilot_delivery_override_email"));
  assert(producer.includes("configByProjectId.get(first.project_id)?.pilot_delivery_override_email"));
  assert(!producer.includes('deliveryEmail: "crm@axion.com.br"'));
});

check("weekly digest legado exclui ações ligadas a contract_event para evitar e-mail duplicado", () => {
  assert(weekly.includes('.is("related_event_id", null)'));
});

check("cron semanal executa digest legado e lote de contrato no mesmo ciclo", () => {
  assert(cron.includes("runWeeklyAlertDigests()"));
  assert(cron.includes("runContractAlertBatches()"));
  assert(cron.includes("weeklyDigest"));
  assert(cron.includes("contractBatches"));
});

console.log(`\n${passed} verificações concluídas.`);
