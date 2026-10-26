// Migration 20261027120000_alert_followups.sql contra PostgreSQL LOCAL descartável (PGlite).
// Nada toca banco real. Ver limites em scripts/lib/pglite-supabase-stub.mjs.
//
// Uso: node scripts/test-alert-followups-sql.mjs

import assert from "node:assert/strict";
import { as, createLocalDb, expectError } from "./lib/pglite-supabase-stub.mjs";

const U = {
  ana: "00000000-0000-4000-8000-0000000000a1", // responsável
  bruno: "00000000-0000-4000-8000-0000000000b2", // colaborador ativo
  carla: "00000000-0000-4000-8000-0000000000c3", // colaboradora INATIVA
  adm: "00000000-0000-4000-8000-0000000000d4", // administrador da obra 1
  adm2: "00000000-0000-4000-8000-0000000000d5", // administrador da obra 2
  fora: "00000000-0000-4000-8000-0000000000e6", // só da obra 2
};
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const EV = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

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

const db = await createLocalDb(["20261027120000_alert_followups.sql"]);
for (const [k, id] of Object.entries(U)) await db.query("insert into public.profiles (id,name,email) values ($1,$2,$3)", [id, k, `${k}@exemplo.invalid`]);
await db.query("insert into public.projects (id,name) values ($1,'Obra 1'),($2,'Obra 2')", [P1, P2]);
const member = (p, u, perm, status = "ACTIVE") => db.query("insert into public.project_memberships (project_id,user_id,permission,status) values ($1,$2,$3,$4)", [p, u, perm, status]);
await member(P1, U.ana, "COLABORADOR");
await member(P1, U.bruno, "COLABORADOR");
await member(P1, U.carla, "COLABORADOR", "INACTIVE");
await member(P1, U.adm, "ADMINISTRADOR");
await member(P2, U.adm2, "ADMINISTRADOR");
await member(P2, U.fora, "COLABORADOR");

const T0 = "2026-11-02T12:00:00Z";
const plusH = (h) => new Date(Date.parse(T0) + h * 3600e3).toISOString();
const row = async (id) => (await db.query("select * from public.alert_followups where id=$1", [id])).rows[0];
const open = (ev, sev = "CRITICA", resp = U.ana, proj = P1) =>
  as(db, { role: "service_role" }, async () =>
    (await db.query("select public.alert_followup_open($1,'CONTRACT_EVENT',$2,$3,$4,$5) as id", [proj, EV(ev), sev, resp, T0])).rows[0].id);
const act = (uid, ev, action, to = null, proj = P1) =>
  as(db, { role: "authenticated", uid }, () => db.query("select public.alert_followup_apply_action($1,'CONTRACT_EVENT',$2,$3,$4)", [proj, EV(ev), action, to]));

console.log("");
console.log("======================================");
console.log("ACOMPANHAMENTO — MIGRATION (PGlite local)");
console.log("======================================");
console.log("");

await check("abertura: calendário = envio + intervalo do risco (24/48/96/168 h) e abertura idempotente", async () => {
  const exp = { CRITICA: 24, ALTA: 48, MEDIA: 96, BAIXA: 168 };
  let n = 1;
  for (const [sev, h] of Object.entries(exp)) {
    const id = await open(n, sev);
    const again = await open(n, sev);
    assert.equal(again, id, "idempotente");
    const r = await row(id);
    assert.equal(r.interval_hours, h);
    assert.equal(new Date(r.next_reminder_at).toISOString(), plusH(h));
    assert.equal(r.status, "OPEN");
    n += 1;
  }
  const c = (await db.query("select count(*)::int c from public.alert_followups where project_id=$1", [P1])).rows[0].c;
  assert.equal(c, 4);
});

await check("constraints: intervalo incompatível com o risco, responsável fora da obra e estado incoerente são recusados", async () => {
  await expectError(db.query("insert into public.alert_followups (project_id,source_type,source_id,severity,interval_hours,responsible_user_id,next_reminder_at) values ($1,'CONTRACT_EVENT',$2,'CRITICA',48,$3,now())", [P1, EV(90), U.ana]), /check/i);
  await expectError(db.query("insert into public.alert_followups (project_id,source_type,source_id,severity,interval_hours,responsible_user_id,next_reminder_at) values ($1,'CONTRACT_EVENT',$2,'CRITICA',24,$3,now())", [P1, EV(91), U.fora]), /foreign key|violates/i);
  await expectError(db.query("insert into public.alert_followups (project_id,source_type,source_id,severity,interval_hours,responsible_user_id,next_reminder_at,status) values ($1,'CONTRACT_EVENT',$2,'CRITICA',24,$3,null,'OPEN')", [P1, EV(92), U.ana]), /check/i);
});

await check("EM ANDAMENTO: responsável e admin da obra podem; terceiros e admin de OUTRA obra não; calendário não muda", async () => {
  const id = await open(10, "ALTA");
  const before = (await row(id)).next_reminder_at;
  await act(U.ana, 10, "EM_ANDAMENTO");
  await act(U.ana, 10, "EM_ANDAMENTO");
  await act(U.adm, 10, "EM_ANDAMENTO");
  const r = await row(id);
  assert.equal(r.in_progress, true);
  assert.equal(r.in_progress_by_user_id, U.ana, "primeiro autor preservado");
  assert.equal(new Date(r.next_reminder_at).getTime(), new Date(before).getTime(), "repetir não posterga");
  assert.equal(r.status, "OPEN");
  const ev = (await db.query("select count(*)::int c from public.alert_followup_events where followup_id=$1 and kind='IN_PROGRESS_CONFIRMED'", [id])).rows[0].c;
  assert.equal(ev, 3, "histórico de cada confirmação");
  await expectError(act(U.bruno, 10, "EM_ANDAMENTO"), /permissão/);
  await expectError(act(U.adm2, 10, "EM_ANDAMENTO"), /permissão|não encontrado/);
});

await check("ENVIADO P/: só para colaborador ATIVO da obra; troca o responsável sem concluir nem mexer no prazo; histórico completo", async () => {
  const id = await open(11, "CRITICA");
  const before = (await row(id)).next_reminder_at;
  await expectError(act(U.ana, 11, "ENVIADO_PARA", U.carla), /ativo vinculado/);
  await expectError(act(U.ana, 11, "ENVIADO_PARA", U.fora), /ativo vinculado/);
  await expectError(act(U.ana, 11, "ENVIADO_PARA", U.ana), /já está com este responsável/);
  await expectError(act(U.ana, 11, "ENVIADO_PARA", null), /Selecione/);
  await act(U.ana, 11, "ENVIADO_PARA", U.bruno);
  const r = await row(id);
  assert.equal(r.responsible_user_id, U.bruno);
  assert.equal(r.status, "OPEN");
  assert.equal(new Date(r.next_reminder_at).getTime(), new Date(before).getTime());
  const e = (await db.query("select actor_user_id,from_user_id,to_user_id from public.alert_followup_events where followup_id=$1 and kind='FORWARDED'", [id])).rows[0];
  assert.deepEqual([e.actor_user_id, e.from_user_id, e.to_user_id], [U.ana, U.ana, U.bruno]);
  await expectError(act(U.ana, 11, "EM_ANDAMENTO"), /permissão/); // o anterior perde a autoridade
});

await check("RESOLVIDO: registra quem/quando, interrompe lembretes e não é mais reivindicável", async () => {
  const id = await open(12, "CRITICA");
  await act(U.ana, 12, "RESOLVIDO");
  const r = await row(id);
  assert.equal(r.status, "RESOLVED");
  assert.equal(r.next_reminder_at, null);
  assert.equal(r.resolved_by_user_id, U.ana);
  assert.ok(r.resolved_at);
  const claimed = await as(db, { role: "service_role" }, async () => (await db.query("select * from public.alert_followup_claim_due(50, $1)", [plusH(24 * 30)])).rows);
  assert.ok(!claimed.some((c) => c.followup_id === id));
  await act(U.ana, 12, "EM_ANDAMENTO"); // sem acompanhamento aberto: no-op documentado
  assert.equal((await row(id)).status, "RESOLVED");
  // uma nova abertura para o mesmo alerta é permitida (outro ciclo) — o índice parcial só vale para ABERTOS
  const again = await open(12, "CRITICA");
  assert.notEqual(again, id);
});

await check("claim atômico: claim vigente não é reivindicado de novo; expirado volta a ser devido; tokens distintos", async () => {
  const id = await open(13, "CRITICA");
  const claim = (now) => as(db, { role: "service_role" }, async () => (await db.query("select * from public.alert_followup_claim_due(100, $1)", [now])).rows);
  const due = plusH(24);
  const c1 = (await claim(due)).filter((r) => r.followup_id === id);
  assert.equal(c1.length, 1);
  assert.equal(new Date(c1[0].slot).toISOString(), due);
  const c2 = (await claim(plusH(24.05))).filter((r) => r.followup_id === id);
  assert.equal(c2.length, 0, "claim vigente");
  const c3 = (await claim(plusH(24.5))).filter((r) => r.followup_id === id);
  assert.equal(c3.length, 1, "claim expirado (10 min)");
  assert.notEqual(c3[0].claim_token, c1[0].claim_token);
});

await check("mark_sent: avança na grade SEM acumular após 10 dias parados; token errado é recusado", async () => {
  const id = await open(14, "CRITICA");
  const svc = (sql, params) => as(db, { role: "service_role" }, () => db.query(sql, params));
  const now = plusH(24 * 10 + 3);
  const claimed = (await svc("select * from public.alert_followup_claim_due(100, $1)", [now])).rows.find((r) => r.followup_id === id);
  await expectError(svc("select public.alert_followup_mark_sent($1,$2,$3,$4)", [id, "11111111-1111-4111-8111-111111111111", claimed.slot, now]), /inválida/);
  await svc("select public.alert_followup_mark_sent($1,$2,$3,$4)", [id, claimed.claim_token, claimed.slot, now]);
  const r = await row(id);
  assert.equal(r.claim_token, null);
  assert.equal(new Date(r.last_sent_slot).toISOString(), plusH(24));
  assert.equal(new Date(r.next_reminder_at).toISOString(), plusH(24 * 11), "próximo slot da grade, 1 único lembrete");
  assert.equal(r.failure_count, 0);
  const sent = (await db.query("select count(*)::int c from public.alert_followup_events where followup_id=$1 and kind='REMINDER_SENT'", [id])).rows[0].c;
  assert.equal(sent, 1);
});

await check("mark_failed: NÃO marca como enviado nem avança; falha fica no histórico; próxima execução reenvia", async () => {
  const id = await open(15, "ALTA");
  const svc = (sql, params) => as(db, { role: "service_role" }, () => db.query(sql, params));
  const claimed = (await svc("select * from public.alert_followup_claim_due(100, $1)", [plusH(48)])).rows.find((r) => r.followup_id === id);
  await svc("select public.alert_followup_mark_failed($1,$2,$3,$4)", [id, claimed.claim_token, "SMTP_INDISPONIVEL", plusH(48)]);
  const r = await row(id);
  assert.equal(r.last_sent_slot, null);
  assert.equal(r.last_reminder_at, null);
  assert.equal(new Date(r.next_reminder_at).toISOString(), plusH(48));
  assert.equal(r.failure_count, 1);
  assert.equal(r.claim_token, null);
  const ev = (await db.query("select detail from public.alert_followup_events where followup_id=$1 and kind='REMINDER_FAILED'", [id])).rows;
  assert.deepEqual(ev.map((e) => e.detail), ["SMTP_INDISPONIVEL"]);
  const again = (await svc("select * from public.alert_followup_claim_due(100, $1)", [plusH(49)])).rows.filter((x) => x.followup_id === id);
  assert.equal(again.length, 1, "continua devido");
});

await check("RLS: responsável e admin da obra leem; terceiros e usuários de outra obra não; UPDATE direto não altera nada", async () => {
  const id = await open(16, "MEDIA");
  const count = (uid) => as(db, { role: "authenticated", uid }, async () => (await db.query("select count(*)::int c from public.alert_followups where id=$1", [id])).rows[0].c);
  assert.equal(await count(U.ana), 1);
  assert.equal(await count(U.adm), 1);
  assert.equal(await count(U.bruno), 0);
  assert.equal(await count(U.adm2), 0);
  assert.equal(await count(U.fora), 0);
  await as(db, { role: "authenticated", uid: U.ana }, () => db.query("update public.alert_followups set status='RESOLVED', next_reminder_at=null where id=$1", [id]));
  assert.equal((await row(id)).status, "OPEN", "sem policy de UPDATE, nada muda");
  const ev = (uid) => as(db, { role: "authenticated", uid }, async () => (await db.query("select count(*)::int c from public.alert_followup_events where followup_id=$1", [id])).rows[0].c);
  assert.ok((await ev(U.ana)) >= 1);
  assert.equal(await ev(U.bruno), 0);
});

await check("funções de serviço (abrir/claim/mark_sent/mark_failed) NÃO são executáveis por usuário autenticado", async () => {
  await expectError(as(db, { role: "authenticated", uid: U.adm }, () => db.query("select * from public.alert_followup_claim_due(10)")), /permission denied/);
  await expectError(as(db, { role: "authenticated", uid: U.adm }, () => db.query("select public.alert_followup_open($1,'CONTRACT_EVENT',$2,'ALTA',$3,now())", [P1, EV(99), U.ana])), /permission denied/);
});

await check("ação por usuário exige sessão (auth.uid) e ação válida", async () => {
  await expectError(as(db, { role: "authenticated", uid: null }, () => db.query("select public.alert_followup_apply_action($1,'CONTRACT_EVENT',$2,'RESOLVIDO',null)", [P1, EV(1)])), /Sessão expirada/);
  await open(17, "BAIXA");
  await expectError(act(U.ana, 17, "QUALQUER"), /Ação inválida/);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
await db.close();
if (failed > 0) process.exit(1);
