// Resposta PARCIAL de lote (migration 20261027140000) integrada ao acompanhamento recorrente
// (20261027120000) e às tabelas de lote reais (20260921130000), contra PostgreSQL LOCAL descartável
// (PGlite). Relógio simulado por parâmetro (p_now/p_sent_at) — nada toca banco real.
//
// Cenário central: lote com 4 alertas; 3 respondidos (EM ANDAMENTO, ENVIADO P/, RESOLVIDO), o 4º
// pendente; retorno ao lote; repetição do pendente conforme o risco; liberação após a 4ª ação.
//
// Uso: node scripts/test-alert-batch-partial-sql.mjs

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
console.log("======================================");
console.log("LOTE — RESPOSTAS PARCIAIS (PGlite local)");
console.log("======================================");
console.log("");

const B = await newBatch([1, 2, 3, 4]);
for (const ev of [1, 2, 3, 4]) await openFollowup(ev);

await check("3 DE 4: cada ação confirmada é salva na hora; o 4º permanece pendente e o lote continua aberto", async () => {
  const r1 = await save(U.ana, B, 1, "EM_ANDAMENTO");
  assert.deepEqual([r1.answered, r1.total, r1.complete], [1, 4, false]);
  await applyFollowup(U.ana, 1, "EM_ANDAMENTO");
  const r2 = await save(U.ana, B, 2, "ENVIADO_PARA", U.bruno);
  assert.deepEqual([r2.answered, r2.total, r2.complete], [2, 4, false]);
  await applyFollowup(U.ana, 2, "ENVIADO_PARA", U.bruno);
  const r3 = await save(U.ana, B, 3, "RESOLVIDO");
  assert.deepEqual([r3.answered, r3.total, r3.complete], [3, 4, false]);
  await applyFollowup(U.ana, 3, "RESOLVIDO");

  assert.equal((await item(B, 1)).action, "EM_ANDAMENTO");
  assert.equal((await item(B, 2)).action, "ENVIADO_PARA");
  assert.equal((await item(B, 2)).assigned_user_id, U.bruno);
  assert.equal((await item(B, 3)).action, "RESOLVIDO");
  assert.equal((await item(B, 4)).action, null, "4º pendente");
  assert.equal((await batchRow(B)).status, "SENT", "lote NÃO é concluído com 3 de 4");
});

await check("EM ANDAMENTO e ENVIADO P/ contam como resposta ao lote, mas NÃO como resolução; só RESOLVIDO resolve", async () => {
  const f1 = await followup(1);
  const f2 = await followup(2);
  const f3 = await followup(3);
  const f4 = await followup(4);
  assert.deepEqual([f1.status, f1.in_progress], ["OPEN", true]);
  assert.deepEqual([f2.status, f2.responsible_user_id], ["OPEN", U.bruno]);
  assert.equal(f3.status, "RESOLVED");
  assert.deepEqual([f4.status, f4.in_progress], ["OPEN", false]);
});

await check("a resposta FINAL continua recusada com 3 de 4 (mesmo com as 3 salvas) e é liberada quando as 4 ações existem", async () => {
  const payload = (evs) => JSON.stringify(evs.map((ev) => ({ eventId: EV(ev), action: ev === 1 ? "EM_ANDAMENTO" : ev === 2 ? "ENVIADO_PARA" : "RESOLVIDO", assignedUserId: ev === 2 ? U.bruno : null })));
  await expectError(auth(U.ana, () => db.query("select public.submit_contract_alert_batch_response($1,$2::jsonb)", [B, payload([1, 2, 3])])), /Todos os alertas precisam ter uma ação/);
  assert.equal((await batchRow(B)).status, "SENT");
  assert.equal((await item(B, 1)).action, "EM_ANDAMENTO", "as 3 ações salvas foram preservadas");

  // 4ª ação salva (também como resposta parcial) → o lote passa a estar completo
  const r4 = await save(U.ana, B, 4, "EM_ANDAMENTO");
  assert.deepEqual([r4.answered, r4.total, r4.complete], [4, 4, true]);
  await applyFollowup(U.ana, 4, "EM_ANDAMENTO");
  const all = JSON.stringify([
    { eventId: EV(1), action: "EM_ANDAMENTO" },
    { eventId: EV(2), action: "ENVIADO_PARA", assignedUserId: U.bruno },
    { eventId: EV(3), action: "RESOLVIDO" },
    { eventId: EV(4), action: "EM_ANDAMENTO" },
  ]);
  await auth(U.ana, () => db.query("select public.submit_contract_alert_batch_response($1,$2::jsonb)", [B, all]));
  const b = await batchRow(B);
  assert.equal(b.status, "RESPONDED");
  assert.ok(b.responded_at);
});

await check("retorno ao lote: ações já registradas são preservadas e novas confirmações tratam só o que falta (idempotente)", async () => {
  const B2 = await newBatch([5, 6].map((n) => n));
  await openFollowup(5);
  await openFollowup(6);
  await save(U.ana, B2, 5, "EM_ANDAMENTO");
  await save(U.ana, B2, 5, "EM_ANDAMENTO"); // repetir não duplica nem quebra
  const stored = await item(B2, 5);
  assert.equal(stored.action, "EM_ANDAMENTO");
  const audits = (await db.query("select count(*)::int c from public.audit_log_entries where entity_id=$1 and action='CONTRACT_ALERT_BATCH_ITEM_RESPONDED'", [EV(5)])).rows[0].c;
  assert.ok(audits >= 2, "cada confirmação fica na auditoria");
  assert.equal((await item(B2, 6)).action, null);
  // "voltar" ao lote = ler de novo: nada foi perdido
  const reread = (await db.query("select count(action)::int a, count(*)::int t from public.contract_alert_batch_items where batch_id=$1", [B2])).rows[0];
  assert.deepEqual([reread.a, reread.t], [1, 2]);
  // mudar de ideia antes da resposta final é permitido
  await save(U.ana, B2, 5, "RESOLVIDO");
  assert.equal((await item(B2, 5)).action, "RESOLVIDO");
});

await check("REPETIÇÃO: o alerta sem resposta volta conforme o risco; em andamento/encaminhado seguem para o responsável ATUAL; resolvido não volta", async () => {
  // Estado dos acompanhamentos dos eventos 1–4 (criados em T0):  1 CRÍTICO(24h, em andamento) · 2 ALTO(48h, com Bruno) · 3 MÉDIO resolvido · 4 BAIXO(168h)
  const at24 = (await claim(plusH(24))).filter((c) => [1, 2, 3, 4].some((n) => c.source_id === EV(n)));
  assert.deepEqual(at24.map((c) => c.source_id), [EV(1)], "só o crítico (24h) está devido; resolvido nunca");
  assert.equal(at24[0].responsible_user_id, U.ana);
  const sent = (c, now) => svc(() => db.query("select public.alert_followup_mark_sent($1,$2,$3,$4)", [c.followup_id, c.claim_token, c.slot, now]));
  await sent(at24[0], plusH(24));

  const at48 = (await claim(plusH(48))).filter((c) => [1, 2, 3, 4].some((n) => c.source_id === EV(n))).map((c) => [c.source_id, c.responsible_user_id]).sort();
  assert.deepEqual(at48, [[EV(1), U.ana], [EV(2), U.bruno]].sort(), "crítico de novo (grade de 24h) e o ALTO vai para BRUNO, o responsável atual");

  const at168 = (await claim(plusH(168 + 1))).filter((c) => c.source_id === EV(4));
  assert.equal(at168.length, 1, "o BAIXO (7 dias) volta no seu intervalo");
});

await check("alerta pendente repetido em NOVO lote: responder no novo lote atualiza também o lote antigo (sem pendência órfã)", async () => {
  const OLD = await newBatch([1]);
  const NEW = await newBatch([1]);
  await openFollowup(1, U.ana, plusH(1000)); // novo ciclo (o anterior foi resolvido? aqui só garante um aberto)
  await save(U.ana, NEW, 1, "EM_ANDAMENTO");
  assert.equal((await item(OLD, 1)).action, "EM_ANDAMENTO", "o item pendente do lote antigo recebeu a mesma ação");
});

await check("permissões: só o destinatário do lote ou o administrador DA MESMA obra salvam; outros membros, inativos e admin de outra obra não", async () => {
  const B3 = await newBatch([1]);
  await expectError(save(U.carla, B3, 1, "EM_ANDAMENTO"), /permissão/);
  await expectError(save(U.bruno, B3, 1, "EM_ANDAMENTO"), /permissão/);
  await expectError(save(U.adm2, B3, 1, "EM_ANDAMENTO"), /permissão/);
  await expectError(save(U.inativo, B3, 1, "EM_ANDAMENTO"), /permissão/);
  await save(U.adm, B3, 1, "EM_ANDAMENTO");
  assert.equal((await item(B3, 1)).answered_by_user_id, U.adm);
  await expectError(auth(null, () => db.query("select public.save_contract_alert_batch_item_response($1,$2,'RESOLVIDO',null)", [B3, EV(1)])), /Sessão expirada/);
});

await check("validações: ENVIADO P/ só para colaborador ATIVO da obra; ação inválida; item de outro lote; lote já respondido", async () => {
  const B4 = await newBatch([1, 2]);
  await expectError(save(U.ana, B4, 1, "ENVIADO_PARA", U.inativo), /colaborador ativo/);
  await expectError(save(U.ana, B4, 1, "ENVIADO_PARA", U.adm2), /colaborador ativo/);
  await expectError(save(U.ana, B4, 1, "ENVIADO_PARA", null), /colaborador ativo/);
  await expectError(save(U.ana, B4, 1, "TALVEZ"), /Ação inválida/);
  await expectError(save(U.ana, B4, 6, "EM_ANDAMENTO"), /não pertence/);
  await expectError(save(U.ana, B, 1, "RESOLVIDO"), /já foi respondido/);
});

await check("sem duplicidade: abrir o acompanhamento de novo e salvar de novo não cria registros extras", async () => {
  const before = (await db.query("select count(*)::int c from public.alert_followups where status='OPEN' and source_id=$1", [EV(2)])).rows[0].c;
  await openFollowup(2);
  await openFollowup(2);
  const after = (await db.query("select count(*)::int c from public.alert_followups where status='OPEN' and source_id=$1", [EV(2)])).rows[0].c;
  assert.equal(after, before);
  assert.ok(after <= 1);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
await db.close();
if (failed > 0) process.exit(1);
