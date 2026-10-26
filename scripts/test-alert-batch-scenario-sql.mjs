// CENÁRIO COMPLETO pedido pelo produto (lote de 4 alertas, 3 de 4, retorno, repetição, atraso) — integra a resposta PARCIAL de lote (migration 20261027140000) ao acompanhamento recorrente
// (20261027120000) e às tabelas de lote reais (20260921130000), contra PostgreSQL LOCAL descartável
// (PGlite). Relógio simulado por parâmetro (p_now/p_sent_at) — nada toca banco real.
//
// Cenário central: lote com 4 alertas; 3 respondidos (EM ANDAMENTO, ENVIADO P/, RESOLVIDO), o 4º
// pendente; retorno ao lote; repetição do pendente conforme o risco; liberação após a 4ª ação.
//
// Uso: node scripts/test-alert-batch-scenario-sql.mjs

import assert from "node:assert/strict";
import { as, createLocalDb, expectError } from "./lib/pglite-supabase-stub.mjs";

const U = {
  ana: "00000000-0000-4000-8000-0000000000a1", // destinatária do lote
  bruno: "00000000-0000-4000-8000-0000000000b2", // colaborador ativo
  carla: "00000000-0000-4000-8000-0000000000c3", // colaboradora ativa SEM relação com o lote
  inativo: "00000000-0000-4000-8000-0000000000c4", // INATIVO
  adm: "00000000-0000-4000-8000-0000000000d4", // administrador da obra 1
  adm2: "00000000-0000-4000-8000-0000000000d5", // administrador da obra 2
};
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const EV = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const SEV = { 1: "CRITICA", 2: "ALTA", 3: "MEDIA", 4: "BAIXA", 5: "MEDIA", 6: "BAIXA" };
const T0 = "2027-03-01T12:00:00Z";
const plusH = (h) => new Date(Date.parse(T0) + h * 3600e3).toISOString();

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
create table public.audit_log_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid, actor_type text, actor_user_id uuid, actor_label text,
  action text, entity_type text, entity_id text, detail text, created_at timestamptz default now()
);
`;
const db = await createLocalDb(
  ["20260921130000_contract_alert_batches_foundation.sql", "20261027120000_alert_followups.sql", "20261027140000_alert_batch_partial_responses.sql"],
  PRE
);
for (const [k, id] of Object.entries(U)) await db.query("insert into public.profiles (id,name,email) values ($1,$2,$3)", [id, k, `${k}@exemplo.invalid`]);
await db.query("insert into public.projects (id,name) values ($1,'Obra 1'),($2,'Obra 2')", [P1, P2]);
const member = (p, u, perm, status = "ACTIVE") => db.query("insert into public.project_memberships (project_id,user_id,permission,status) values ($1,$2,$3,$4)", [p, u, perm, status]);
await member(P1, U.ana, "COLABORADOR");
await member(P1, U.bruno, "COLABORADOR");
await member(P1, U.carla, "COLABORADOR");
await member(P1, U.inativo, "COLABORADOR", "INACTIVE");
await member(P1, U.adm, "ADMINISTRADOR");
await member(P2, U.adm2, "ADMINISTRADOR");
for (let n = 1; n <= 6; n += 1) await db.query("insert into public.contract_events (id, project_id) values ($1,$2)", [EV(n), P1]);

const auth = (uid, fn) => as(db, { role: "authenticated", uid }, fn);
const svc = (fn) => as(db, { role: "service_role" }, fn);

async function newBatch(items) {
  const { rows } = await db.query("insert into public.contract_alert_batches (project_id, recipient_user_id, intended_recipient_email, status, sent_at) values ($1,$2,'ana@exemplo.invalid','SENT',$3) returning id", [P1, U.ana, T0]);
  const id = rows[0].id;
  for (const [i, ev] of items.entries()) {
    await db.query("insert into public.contract_alert_batch_items (batch_id,event_id,position,severity,title_snapshot) values ($1,$2,$3,$4,$5)", [id, EV(ev), i + 1, SEV[ev], `Alerta ${ev}`]);
  }
  return id;
}
const openFollowup = (ev, responsible = U.ana, sentAt = T0) =>
  svc(async () => (await db.query("select public.alert_followup_open($1,'CONTRACT_EVENT',$2,$3,$4,$5) as id", [P1, EV(ev), SEV[ev], responsible, sentAt])).rows[0].id);
const save = (uid, batch, ev, action, to = null) => auth(uid, async () => (await db.query("select public.save_contract_alert_batch_item_response($1,$2,$3,$4) as r", [batch, EV(ev), action, to])).rows[0].r);
// Espelho do que o servidor faz depois de salvar: aplica a ação ao acompanhamento (mesma sessão).
const applyFollowup = (uid, ev, action, to = null) => auth(uid, () => db.query("select public.alert_followup_apply_action($1,'CONTRACT_EVENT',$2,$3,$4)", [P1, EV(ev), action, to]));
const item = async (batch, ev) => (await db.query("select action, assigned_user_id, answered_by_user_id from public.contract_alert_batch_items where batch_id=$1 and event_id=$2", [batch, EV(ev)])).rows[0];
const followup = async (ev) => (await db.query("select * from public.alert_followups where source_id=$1 order by created_at desc limit 1", [EV(ev)])).rows[0];
const batchRow = async (b) => (await db.query("select status, responded_at from public.contract_alert_batches where id=$1", [b])).rows[0];
const claim = (now) => svc(async () => (await db.query("select * from public.alert_followup_claim_due(50, $1)", [now])).rows);


console.log("");
console.log("CENÁRIO — LOTE 3 DE 4, REPETIÇÃO E EXECUÇÃO ATRASADA (PGlite local)");
console.log("");

const sent = (c, now) => svc(() => db.query("select public.alert_followup_mark_sent($1,$2,$3,$4)", [c.followup_id, c.claim_token, c.slot, now]));
const mine = (rows, evs) => rows.filter((c) => evs.some((n) => c.source_id === EV(n)));

const B = await newBatch([1, 2, 3, 4]);
for (const ev of [1, 2, 3, 4]) await openFollowup(ev);

await check("1) três ações salvas na hora; final bloqueada; 2) ao retornar as três continuam registradas", async () => {
  await save(U.ana, B, 1, "EM_ANDAMENTO"); await applyFollowup(U.ana, 1, "EM_ANDAMENTO");
  await save(U.ana, B, 2, "ENVIADO_PARA", U.bruno); await applyFollowup(U.ana, 2, "ENVIADO_PARA", U.bruno);
  await save(U.ana, B, 3, "RESOLVIDO"); await applyFollowup(U.ana, 3, "RESOLVIDO");
  const partial = JSON.stringify([1, 2, 3].map((n) => ({ eventId: EV(n), action: n === 1 ? "EM_ANDAMENTO" : n === 2 ? "ENVIADO_PARA" : "RESOLVIDO", assignedUserId: n === 2 ? U.bruno : null })));
  await expectError(auth(U.ana, () => db.query("select public.submit_contract_alert_batch_response($1,$2::jsonb)", [B, partial])), /Todos os alertas precisam ter uma ação/);
  assert.equal((await batchRow(B)).status, "SENT");
  const back = (await db.query("select event_id, action from public.contract_alert_batch_items where batch_id=$1 and action is not null order by position", [B])).rows;
  assert.deepEqual(back.map((r) => r.action), ["EM_ANDAMENTO", "ENVIADO_PARA", "RESOLVIDO"]);
});

await check("3) o alerta sem resposta (4º, BAIXO) volta conforme o seu risco (7 dias), não antes", async () => {
  assert.equal(mine(await claim(plusH(167)), [4]).length, 0, "antes de 7 dias não volta");
  const due = mine(await claim(plusH(168)), [4]);
  assert.equal(due.length, 1);
  assert.equal(due[0].responsible_user_id, U.ana);
  await svc(() => db.query("select public.alert_followup_release($1,$2)", [due[0].followup_id, due[0].claim_token]));
});

await check("4) EM ANDAMENTO e ENVIADO P/ continuam acompanhados até a conclusão; RESOLVIDO não volta nunca mais", async () => {
  for (const h of [24, 48, 96, 168, 400]) {
    const evs = mine(await claim(plusH(h)), [1, 2, 3]);
    for (const c of evs) {
      assert.notEqual(c.source_id, EV(3), "RESOLVIDO jamais é reivindicado");
      await sent(c, plusH(h));
    }
  }
  const f1 = await followup(1); const f2 = await followup(2);
  assert.equal(f1.status, "OPEN"); assert.equal(f2.status, "OPEN");
  assert.equal(f2.responsible_user_id, U.bruno, "ENVIADO P/: acompanhamento com o responsável atual");
  assert.equal((await followup(3)).status, "RESOLVED");
});

await check("5) ao responder o 4º a resposta final é liberada", async () => {
  await save(U.ana, B, 4, "EM_ANDAMENTO");
  const all = JSON.stringify([
    { eventId: EV(1), action: "EM_ANDAMENTO" }, { eventId: EV(2), action: "ENVIADO_PARA", assignedUserId: U.bruno },
    { eventId: EV(3), action: "RESOLVIDO" }, { eventId: EV(4), action: "EM_ANDAMENTO" },
  ]);
  await auth(U.ana, () => db.query("select public.submit_contract_alert_batch_response($1,$2::jsonb)", [B, all]));
  assert.equal((await batchRow(B)).status, "RESPONDED");
});

// ---- Acompanhamentos independentes (obra isolada, relógio simulado) ----
const L = await newBatch([5]);
await openFollowup(5, U.ana, T0); // MÉDIO: a cada 96 h

await check("6) ENVIADO P/ transfere o acompanhamento SEM adiar um lembrete já devido", async () => {
  // já passou do prazo (96 h) e o lembrete ainda não foi reivindicado
  await save(U.ana, L, 5, "ENVIADO_PARA", U.bruno); await applyFollowup(U.ana, 5, "ENVIADO_PARA", U.bruno);
  const due = mine(await claim(plusH(97)), [5]);
  assert.equal(due.length, 1, "o lembrete devido continua devido depois da transferência");
  assert.equal(due[0].responsible_user_id, U.bruno, "vai para o novo responsável");
  await svc(() => db.query("select public.alert_followup_release($1,$2)", [due[0].followup_id, due[0].claim_token]));
});

await check("7) execução ATRASADA: uma só mensagem por alerta, sem acúmulo e sem duplicidade em execuções concorrentes", async () => {
  const late = plusH(96 * 10 + 5); // dez ciclos perdidos
  const first = mine(await claim(late), [5]);
  const second = mine(await claim(late), [5]); // outra execução simultânea
  assert.equal(first.length, 1, "um único lembrete, não dez");
  assert.equal(second.length, 0, "claim vigente: segunda execução não duplica");
  await sent(first[0], late);
  assert.equal(mine(await claim(late), [5]).length, 0, "depois de enviado, nada acumulado");
  const next = (await followup(5)).next_reminder_at;
  assert.ok(Date.parse(next) > Date.parse(late), "próximo lembrete na grade futura");
  assert.ok((Date.parse(next) - Date.parse(T0)) % (96 * 3600e3) === 0, "ancorado na grade do primeiro envio");
});

await check("8) isolamento: usuário/admin de outra obra não lê nem altera; item de outro lote é recusado", async () => {
  const seen = await auth(U.adm2, async () => (await db.query("select count(*)::int c from public.alert_followups")).rows[0].c);
  assert.equal(seen, 0, "admin da obra 2 não enxerga acompanhamentos da obra 1");
  await expectError(save(U.adm2, B, 4, "RESOLVIDO"), /.*/);
  await expectError(save(U.carla, B, 4, "RESOLVIDO"), /.*/);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
await db.close?.();
process.exit(failed ? 1 : 0);
