// Revisão humana do grau de risco (migration 20261028120000) contra PostgreSQL LOCAL descartável
// (PGlite). Cobre: IA preservada, justificativa/histórico, permissões e isolamento entre obras,
// imutabilidade do histórico, providências (revisão e alteração direta) e ajuste da recorrência
// do acompanhamento aberto sem mexer no próximo lembrete.
//
// Uso: node scripts/test-risk-classification-sql.mjs

import assert from "node:assert/strict";
import { as, createLocalDb, expectError } from "./lib/pglite-supabase-stub.mjs";

const U = {
  ana: "00000000-0000-4000-8000-0000000000a1", // colaboradora ativa
  ger: "00000000-0000-4000-8000-0000000000f7", // gerente da obra 1
  adm: "00000000-0000-4000-8000-0000000000d4", // administrador da obra 1
  adm2: "00000000-0000-4000-8000-0000000000d5", // administrador da obra 2
  inativo: "00000000-0000-4000-8000-0000000000c4", // gerente INATIVO da obra 1
};
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const EV1 = "00000000-0000-4000-8000-000000000201"; // obra 1
const EV2 = "00000000-0000-4000-8000-000000000202"; // obra 2
const T0 = "2027-03-01T12:00:00Z";

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

const PRE = `
create table public.contract_events (id uuid primary key, project_id uuid not null references public.projects(id));
create table public.event_ai_assessments (id uuid primary key default gen_random_uuid(), event_id uuid not null unique references public.contract_events(id), severity text not null);
create table public.audit_log_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid, actor_type text, actor_user_id uuid, actor_label text,
  action text, entity_type text, entity_id text, detail text, created_at timestamptz default now()
);
`;
const db = await createLocalDb(
  ["20261027120000_alert_followups.sql", "20261027130000_project_delivery_items.sql", "20261027150000_delivery_item_respond.sql", "20261028120000_risk_classification_reviews.sql"],
  PRE
);
for (const [k, id] of Object.entries(U)) await db.query("insert into public.profiles (id,name,email) values ($1,$2,$3)", [id, k, `${k}@exemplo.invalid`]);
await db.query("insert into public.projects (id,name,baseline_end_date) values ($1,'Obra 1','2027-08-15'),($2,'Obra 2','2027-12-31')", [P1, P2]);
const member = (p, u, perm, status = "ACTIVE") => db.query("insert into public.project_memberships (project_id,user_id,permission,status) values ($1,$2,$3,$4)", [p, u, perm, status]);
await member(P1, U.ana, "COLABORADOR");
await member(P1, U.ger, "GERENTE");
await member(P1, U.adm, "ADMINISTRADOR");
await member(P1, U.inativo, "GERENTE", "INACTIVE");
await member(P2, U.adm2, "ADMINISTRADOR");
await db.query("insert into public.contract_events (id,project_id) values ($1,$2),($3,$4)", [EV1, P1, EV2, P2]);
await db.query("insert into public.event_ai_assessments (event_id,severity) values ($1,'MEDIA'),($2,'BAIXA')", [EV1, EV2]);

const auth = (uid, fn) => as(db, { role: "authenticated", uid }, fn);
const svc = (fn) => as(db, { role: "service_role" }, fn);
const review = (uid, type, id, level, just = "Cláusula 12.3 prevê multa e o prazo vence esta semana.", ref = null, sug = null) =>
  auth(uid, async () => (await db.query("select public.review_risk_classification($1,$2,$3,$4,$5,$6::jsonb) as id", [type, id, level, just, ref, sug ? JSON.stringify(sug) : null])).rows[0].id);
const history = async (id) => (await db.query("select * from public.risk_classification_reviews where source_id=$1 order by created_at, id", [id])).rows;

console.log("");
console.log("======================================");
console.log("CLASSIFICAÇÃO DE RISCO — MIGRATION (PGlite local)");
console.log("======================================");
console.log("");

await check("revisão de evento: grava histórico (anterior = IA), justificativa, referência e sugestão; IA preservada", async () => {
  const sug = { level: "ALTA", status: "DEFINIDA", basis: [{ kind: "FATO", text: "x" }] };
  await review(U.ger, "CONTRACT_EVENT", EV1, "ALTA", "Há multa prevista e ainda há tempo para mitigar.", "Cláusula 12.3", sug);
  const h = await history(EV1);
  assert.equal(h.length, 1);
  assert.equal(h[0].previous_level, "MEDIA", "anterior = classificação da IA");
  assert.equal(h[0].new_level, "ALTA");
  assert.equal(h[0].suggested_level, "ALTA");
  assert.equal(h[0].origin, "REVISAO_HUMANA");
  assert.equal(h[0].reviewer_user_id, U.ger);
  assert.equal(h[0].reference, "Cláusula 12.3");
  assert.equal(h[0].suggestion.basis[0].kind, "FATO");
  const ai = (await db.query("select severity from public.event_ai_assessments where event_id=$1", [EV1])).rows[0].severity;
  assert.equal(ai, "MEDIA", "a classificação da IA NÃO é sobrescrita");
});

await check("segunda revisão parte da revisão anterior (não da IA) e o histórico acumula", async () => {
  await review(U.adm, "CONTRACT_EVENT", EV1, "CRITICA", "Sem tempo de mitigação: o prazo vence hoje.");
  const h = await history(EV1);
  assert.deepEqual(h.map((r) => [r.previous_level, r.new_level]), [["MEDIA", "ALTA"], ["ALTA", "CRITICA"]]);
});

await check("validações: justificativa vazia, grau inválido, mesmo grau e origem inválida são recusados", async () => {
  await expectError(review(U.ger, "CONTRACT_EVENT", EV1, "ALTA", "   "), /justificativa/);
  await expectError(review(U.ger, "CONTRACT_EVENT", EV1, "GRAVISSIMA"), /inválido/);
  await expectError(review(U.ger, "CONTRACT_EVENT", EV1, "CRITICA"), /já é este/);
  await expectError(review(U.ger, "OUTRO", EV1, "BAIXA"), /Origem/);
  await expectError(review(U.ger, "CONTRACT_EVENT", "00000000-0000-4000-8000-0000000009ff", "BAIXA"), /não encontrado/);
});

await check("permissões: colaborador, membro inativo e administrador de OUTRA obra não revisam", async () => {
  await expectError(review(U.ana, "CONTRACT_EVENT", EV1, "BAIXA"), /gestor, gerente ou administrador/);
  await expectError(review(U.inativo, "CONTRACT_EVENT", EV1, "BAIXA"), /gestor, gerente ou administrador/);
  await expectError(review(U.adm2, "CONTRACT_EVENT", EV1, "BAIXA"), /gestor, gerente ou administrador/);
  await expectError(review(U.ger, "CONTRACT_EVENT", EV2, "ALTA"), /gestor, gerente ou administrador/); // evento da obra 2
  assert.equal((await history(EV2)).length, 0);
});

await check("leitura do histórico: membros ativos da própria obra; outra obra não lê", async () => {
  const count = (uid, p) => auth(uid, async () => (await db.query("select count(*)::int c from public.risk_classification_reviews where project_id=$1", [p])).rows[0].c);
  assert.equal(await count(U.ana, P1), 2);
  assert.equal(await count(U.adm2, P1), 0);
  assert.equal(await count(U.inativo, P1), 0);
});

await check("histórico é imutável e não aceita escrita direta (nem do service role)", async () => {
  await expectError(svc(() => db.query("update public.risk_classification_reviews set justification='x'")), /não pode ser alterado/);
  await expectError(svc(() => db.query("delete from public.risk_classification_reviews")), /não pode ser alterado/);
  const direct = await auth(U.ger, () => db.query("insert into public.risk_classification_reviews (project_id,source_type,source_id,new_level,justification) values ($1,'CONTRACT_EVENT',$2,'BAIXA','x')", [P1, EV1])).then(() => "aceito", (e) => String(e.message));
  assert.match(direct, /row-level security|permission denied/i, "sem policy de INSERT para usuários");
});

await check("acompanhamento aberto: grau novo ajusta o intervalo (1/2/4/7 dias) SEM mexer no próximo lembrete", async () => {
  const fu = await svc(async () => (await db.query("select public.alert_followup_open($1,'CONTRACT_EVENT',$2,'ALTA',$3,$4::timestamptz) as id", [P1, EV1, U.ana, T0])).rows[0].id);
  const before = (await db.query("select severity, interval_hours, next_reminder_at from public.alert_followups where id=$1", [fu])).rows[0];
  assert.equal(before.interval_hours, 48);
  // evento já está CRITICA (2ª revisão); volta para MEDIA e depois BAIXA
  await review(U.ger, "CONTRACT_EVENT", EV1, "MEDIA", "Mitigação já contratada com o cliente.");
  let after = (await db.query("select severity, interval_hours, next_reminder_at from public.alert_followups where id=$1", [fu])).rows[0];
  assert.equal(after.severity, "MEDIA");
  assert.equal(after.interval_hours, 96);
  assert.equal(new Date(after.next_reminder_at).toISOString(), new Date(before.next_reminder_at).toISOString(), "próximo lembrete intocado");
  await review(U.ger, "CONTRACT_EVENT", EV1, "BAIXA", "Risco apenas de acompanhamento.");
  after = (await db.query("select severity, interval_hours from public.alert_followups where id=$1", [fu])).rows[0];
  assert.deepEqual([after.severity, after.interval_hours], ["BAIXA", 168]);
  await review(U.ger, "CONTRACT_EVENT", EV1, "CRITICA", "Prazo venceu e há penalidade prevista.");
  after = (await db.query("select severity, interval_hours from public.alert_followups where id=$1", [fu])).rows[0];
  assert.deepEqual([after.severity, after.interval_hours], ["CRITICA", 24]);
});

await check("providência: revisão grava histórico + evento da providência, atualiza o risco e não duplica o registro", async () => {
  await auth(U.ger, () => db.query("select public.delivery_items_seed_checklist($1)", [P1]));
  const item = (await db.query("select * from public.project_delivery_items where project_id=$1 and checklist_key='AVCB'", [P1])).rows[0];
  assert.equal(item.risk, null);
  await review(U.ger, "DELIVERY_ITEM", item.id, "ALTA", "Sem AVCB não há entrega; ainda há tempo para protocolar.");
  const after = (await db.query("select risk from public.project_delivery_items where id=$1", [item.id])).rows[0];
  assert.equal(after.risk, "ALTA");
  const h = await history(item.id);
  assert.equal(h.length, 1, "uma única linha (o gatilho não duplica)");
  assert.equal(h[0].previous_level, null);
  assert.equal(h[0].origin, "REVISAO_HUMANA");
  const ev = (await db.query("select detail from public.project_delivery_item_events where item_id=$1 and kind='FIELD'", [item.id])).rows;
  assert.ok(ev.some((e) => /Risco revisado: a definir → ALTA/.test(e.detail)));
  // providência pode chegar a CRÍTICO por revisão (nunca por padrão)
  await review(U.adm, "DELIVERY_ITEM", item.id, "CRITICA", "Prazo legal vencido sem protocolo.");
  assert.equal((await db.query("select risk from public.project_delivery_items where id=$1", [item.id])).rows[0].risk, "CRITICA");
});

await check("providência: alteração DIRETA do risco pela tabela entra no histórico como 'sem justificativa'", async () => {
  const item = (await db.query("select * from public.project_delivery_items where project_id=$1 and checklist_key='ISS'", [P1])).rows[0];
  await auth(U.ger, () => db.query("select public.delivery_item_update_fields($1,$2::jsonb)", [item.id, JSON.stringify({ risk: "MEDIA" })]));
  const h = await history(item.id);
  assert.equal(h.length, 1);
  assert.equal(h[0].origin, "ALTERACAO_DIRETA_PROVIDENCIA");
  assert.equal(h[0].new_level, "MEDIA");
  assert.equal(h[0].reviewer_user_id, U.ger);
  assert.match(h[0].justification, /sem justificativa informada/);
});

await check("providência de outra obra e permissões: gestor da obra 2 não revisa; colaborador não revisa", async () => {
  const item = (await db.query("select * from public.project_delivery_items where project_id=$1 and checklist_key='AS_BUILT'", [P1])).rows[0];
  await expectError(review(U.adm2, "DELIVERY_ITEM", item.id, "ALTA"), /gestor, gerente ou administrador/);
  await expectError(review(U.ana, "DELIVERY_ITEM", item.id, "ALTA"), /gestor, gerente ou administrador/);
  assert.equal((await db.query("select risk from public.project_delivery_items where id=$1", [item.id])).rows[0].risk, null);
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} falha(s).`);
await db.close?.();
process.exit(failed === 0 ? 0 : 1);
