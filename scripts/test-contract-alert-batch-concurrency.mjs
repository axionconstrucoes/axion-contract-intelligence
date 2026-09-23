import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const producer = readFileSync(
  "apps/web/lib/email/run-contract-alert-batches.ts",
  "utf8"
);

const migration = readFileSync(
  "supabase/migrations/20260923210000_contract_alert_batch_dispatch_claims.sql",
  "utf8"
);

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK ${name}`);
}

check("claim é adquirido por grupo em uma única RPC", () => {
  assert(producer.includes('"claim_contract_alert_batch_events"'));
  assert(producer.includes("p_event_ids: groupEventIds"));
});

check("grupo sem claim nunca chega ao sender", () => {
  const claimPos = producer.indexOf("if (!claimGroupId)");
  const sendPos = producer.indexOf("createAndSendContractAlertBatch({");
  assert(claimPos >= 0 && sendPos > claimPos);
});

check("claim ativo bloqueia concorrência por event_id", () => {
  assert(
    migration.includes(
      "create unique index contract_alert_batch_dispatch_claims_active_event_uidx"
    )
  );
  assert(migration.includes("where state in ('CLAIMED', 'SENT')"));
});

check("aquisição do grupo é tudo ou nada", () => {
  assert(migration.includes("if v_inserted <> v_expected then"));
  assert(migration.includes("delete from public.contract_alert_batch_dispatch_claims"));
  assert(migration.includes("return null;"));
});

check("FAILED permite retry", () => {
  const activeIndex =
    migration.match(
      /create unique index contract_alert_batch_dispatch_claims_active_event_uidx[\s\S]*?where state in \('CLAIMED', 'SENT'\);/
    )?.[0] ?? "";

  assert(activeIndex);
  assert(!activeIndex.includes("FAILED"));
});

check("envio bem-sucedido marca claim como SENT", () => {
  assert(producer.includes('state: "SENT"'));
  assert(producer.includes("batch_id: sent.batchId"));
});

check("falha de envio marca claim como FAILED", () => {
  assert(producer.includes('state: "FAILED"'));
});

check("resultado contabiliza bloqueio concorrente", () => {
  assert(producer.includes("eventsSkippedAsConcurrentClaim"));
});

check("RPC é restrita ao service_role", () => {
  assert(
    migration.includes(
      "grant execute on function public.claim_contract_alert_batch_events(uuid[], uuid, uuid)"
    )
  );
  assert(migration.includes("to service_role;"));
});

console.log(`\n${passed} verificações concluídas.`);
