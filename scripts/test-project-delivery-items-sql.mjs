// Migration 20261027130000_project_delivery_items.sql (e a integração com o acompanhamento
// recorrente) contra PostgreSQL LOCAL descartável (PGlite). Nada toca banco real.
//
// Uso: node scripts/test-project-delivery-items-sql.mjs

import assert from "node:assert/strict";
import { register } from "node:module";
import { as, createLocalDb, expectError } from "./lib/pglite-supabase-stub.mjs";

register("./ts-module-resolver.mjs", import.meta.url);
const { DEFAULT_DELIVERY_CHECKLIST } = await import("../apps/web/lib/delivery/delivery-items.ts");

const U = {
  ana: "00000000-0000-4000-8000-0000000000a1", // colaboradora ativa
  bruno: "00000000-0000-4000-8000-0000000000b2", // colaborador ativo
  carla: "00000000-0000-4000-8000-0000000000c3", // INATIVA
  ger: "00000000-0000-4000-8000-0000000000f7", // gerente da obra 1
  adm: "00000000-0000-4000-8000-0000000000d4", // administrador da obra 1
  adm2: "00000000-0000-4000-8000-0000000000d5", // administrador da obra 2
  fora: "00000000-0000-4000-8000-0000000000e6", // só da obra 2
};
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";

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

const db = await createLocalDb(["20261027120000_alert_followups.sql", "20261027130000_project_delivery_items.sql"]);
for (const [k, id] of Object.entries(U)) await db.query("insert into public.profiles (id,name,email) values ($1,$2,$3)", [id, k, `${k}@exemplo.invalid`]);
await db.query("insert into public.projects (id,name,baseline_end_date) values ($1,'Obra 1','2027-08-15'),($2,'Obra 2','2027-12-31')", [P1, P2]);
const member = (p, u, perm, status = "ACTIVE") => db.query("insert into public.project_memberships (project_id,user_id,permission,status) values ($1,$2,$3,$4)", [p, u, perm, status]);
await member(P1, U.ana, "COLABORADOR");
await member(P1, U.bruno, "COLABORADOR");
await member(P1, U.carla, "COLABORADOR", "INACTIVE");
await member(P1, U.ger, "GERENTE");
await member(P1, U.adm, "ADMINISTRADOR");
await member(P2, U.adm2, "ADMINISTRADOR");
await member(P2, U.fora, "COLABORADOR");

const auth = (uid, fn) => as(db, { role: "authenticated", uid }, fn);
const svc = (fn) => as(db, { role: "service_role" }, fn);
const items = async (p = P1) => (await db.query("select * from public.project_delivery_items where project_id=$1 order by checklist_key nulls last, title", [p])).rows;
const byKey = async (k, p = P1) => (await db.query("select * from public.project_delivery_items where project_id=$1 and checklist_key=$2", [p, k])).rows[0];
const events = async (id) => (await db.query("select kind, detail, actor_user_id from public.project_delivery_item_events where item_id=$1 order by created_at, id", [id])).rows;

console.log("");
console.log("======================================");
console.log("PROVIDÊNCIAS — MIGRATION (PGlite local)");
console.log("======================================");
console.log("");

await check("checklist inicial: 14 itens idênticos ao da especificação TS, idempotente e sem nada inventado", async () => {
  const n = await auth(U.ger, async () => (await db.query("select public.delivery_items_seed_checklist($1) as n", [P1])).rows[0].n);
  assert.equal(n, 14);
  const again = await auth(U.ger, async () => (await db.query("select public.delivery_items_seed_checklist($1) as n", [P1])).rows[0].n);
  assert.equal(again, 0, "idempotente");
  const rows = await items();
  assert.equal(rows.length, 14);
  const sqlSet = new Set(rows.map((r) => `${r.checklist_key}|${r.title}|${r.phase}`));
  const tsSet = new Set(DEFAULT_DELIVERY_CHECKLIST.map((t) => `${t.key}|${t.title}|${t.phase}`));
  assert.deepEqual([...sqlSet].sort(), [...tsSet].sort(), "SQL e TS têm o MESMO checklist");
  for (const r of rows) {
    assert.deepEqual([r.deadline, r.responsible_user_id, r.risk, r.evidence, r.justification, r.cno_number, r.applicability_confirmed, r.blocks_delivery, r.status], [null, null, null, null, null, null, false, false, "PENDENTE"]);
  }
  assert.equal(rows.find((r) => r.checklist_key === "CNO").phase, "INICIO");
});

await check("permissões: colaborador e usuário de outra obra NÃO configuram; leitura só por membros ATIVOS da obra", async () => {
  await expectError(auth(U.ana, () => db.query("select public.delivery_items_seed_checklist($1)", [P1])), /permissão/);
  await expectError(auth(U.adm2, () => db.query("select public.delivery_items_seed_checklist($1)", [P1])), /permissão/);
  const count = (uid) => auth(uid, async () => (await db.query("select count(*)::int c from public.project_delivery_items where project_id=$1", [P1])).rows[0].c);
  assert.equal(await count(U.ana), 14);
  assert.equal(await count(U.adm), 14);
  assert.equal(await count(U.carla), 0, "membro inativo não lê");
  assert.equal(await count(U.fora), 0, "outra obra não lê");
  assert.equal(await count(U.adm2), 0);
  const upd = await auth(U.ana, () => db.query("update public.project_delivery_items set title='x' where project_id=$1", [P1]));
  assert.equal(upd.affectedRows ?? 0, 0, "sem policy de UPDATE direto");
});

await check("providência específica da obra: adiciona (gestor+), valida nome/fase e registra histórico", async () => {
  const id = await auth(U.ger, async () => (await db.query("select public.delivery_item_add_custom($1,'Licença ambiental de operação','ENTREGA') as id", [P1])).rows[0].id);
  const row = (await db.query("select * from public.project_delivery_items where id=$1", [id])).rows[0];
  assert.equal(row.checklist_key, null);
  assert.equal(row.status, "PENDENTE");
  assert.equal((await events(id))[0].kind, "CREATED");
  await expectError(auth(U.ger, () => db.query("select public.delivery_item_add_custom($1,'  ','ENTREGA')", [P1])), /nome/);
  await expectError(auth(U.ger, () => db.query("select public.delivery_item_add_custom($1,'X','OUTRA')", [P1])), /Fase inválida/);
  await expectError(auth(U.ana, () => db.query("select public.delivery_item_add_custom($1,'X','ENTREGA')", [P1])), /permissão/);
});

await check("responsável interno: só colaborador ATIVO da obra; dependência externa exige a parte e preserva o responsável", async () => {
  const item = await byKey("AGUA_PEDIDO");
  const set = (fields, uid = U.ger) => auth(uid, () => db.query("select public.delivery_item_update_fields($1,$2::jsonb)", [item.id, JSON.stringify(fields)]));
  await expectError(set({ responsible_user_id: U.carla }), /colaborador ativo/);
  await expectError(set({ responsible_user_id: U.fora }), /colaborador ativo/);
  await set({ responsible_user_id: U.ana, deadline: "2027-06-30", risk: "ALTA", applicability_confirmed: true });
  await expectError(set({ dependency_kind: "CONCESSIONARIA" }), /parte externa/);
  await set({ dependency_kind: "CONCESSIONARIA", dependency_name: "Concessionária local de água" });
  const r = await byKey("AGUA_PEDIDO");
  assert.equal(r.responsible_user_id, U.ana, "responsável interno preservado");
  assert.equal(r.dependency_kind, "CONCESSIONARIA");
  assert.equal(r.risk, "ALTA");
  assert.equal(String(r.deadline).slice(0, 10) === "2027-06-30" || r.deadline instanceof Date, true);
  await set({ dependency_kind: "" });
  assert.equal((await byKey("AGUA_PEDIDO")).dependency_name, null, "remover dependência limpa o nome");
  await expectError(set({ risk: "EXTREMO" }), /check/i);
  await expectError(set({ deadline: "2027-06-30" }, U.ana), /permissão/);
  assert.ok((await events(item.id)).some((e) => e.kind === "FIELD"));
});

await check("evidência registrada NÃO altera a situação", async () => {
  const item = await byKey("DATABOOK");
  await auth(U.ger, () => db.query("select public.delivery_item_update_fields($1,$2::jsonb)", [item.id, JSON.stringify({ evidence: "Databook_v3.pdf" })]));
  const r = await byKey("DATABOOK");
  assert.equal(r.status, "PENDENTE");
  assert.equal(r.evidence, "Databook_v3.pdf");
  assert.ok((await events(item.id)).some((e) => e.kind === "EVIDENCE" && /não foi alterada/.test(e.detail)));
});

await check("NÃO APLICÁVEL exige justificativa; CONCLUÍDO exige autorizado + evidência/justificativa; mesma situação é recusada", async () => {
  const item = await byKey("ISS");
  const st = (status, just = null, ev = null, uid = U.ger) => auth(uid, () => db.query("select public.delivery_item_change_status($1,$2,$3,$4)", [item.id, status, just, ev]));
  await expectError(st("NAO_APLICAVEL", "  "), /justificativa/);
  await expectError(st("CONCLUIDO"), /evidência.*justificativa/);
  await expectError(st("CONCLUIDO", null, "Guia quitada", U.ana), /usuário autorizado/);
  await expectError(st("PENDENTE"), /já está nesta situação/);
  await st("EM_ANDAMENTO");
  await st("CONCLUIDO", null, "Guia de quitação nº 8812");
  const done = await byKey("ISS");
  assert.equal(done.status, "CONCLUIDO");
  assert.equal(done.evidence, "Guia de quitação nº 8812");
  assert.equal(done.concluded_by_user_id, U.ger);
  assert.ok(done.concluded_at);
  await st("PENDENTE"); // reabrir limpa a conclusão
  assert.equal((await byKey("ISS")).concluded_at, null);
  const hist = (await events(item.id)).filter((e) => e.kind === "STATUS").map((e) => e.detail);
  assert.deepEqual(hist, ["PENDENTE → EM_ANDAMENTO", "EM_ANDAMENTO → CONCLUIDO", "CONCLUIDO → PENDENTE"]);
  const na = await byKey("AVCB");
  await auth(U.adm, () => db.query("select public.delivery_item_change_status($1,'NAO_APLICAVEL','Obra sem exigência de AVCB (laudo do corpo de bombeiros)',null)", [na.id]));
  assert.equal((await byKey("AVCB")).status, "NAO_APLICAVEL");
  assert.match((await events(na.id)).at(-1).detail, /PENDENTE → NAO_APLICAVEL: Obra sem exigência/);
});

await check("constraints do banco protegem mesmo contra escrita direta de serviço (concluído sem evidência, N/A sem justificativa)", async () => {
  const item = await byKey("ESGOTO_PEDIDO");
  await expectError(svc(() => db.query("update public.project_delivery_items set status='CONCLUIDO', concluded_at=now() where id=$1", [item.id])), /check/i);
  await expectError(svc(() => db.query("update public.project_delivery_items set status='NAO_APLICAVEL' where id=$1", [item.id])), /check/i);
});

await check("registro COMPARTILHADO com alertas: trocar o responsável encaminha o acompanhamento; encerrar o resolve", async () => {
  const item = await byKey("ENERGIA_PEDIDO");
  await auth(U.ger, () => db.query("select public.delivery_item_update_fields($1,$2::jsonb)", [item.id, JSON.stringify({ responsible_user_id: U.ana })]));
  const fid = await svc(async () => (await db.query("select public.alert_followup_open($1,'DELIVERY_ITEM',$2,'ALTA',$3,'2027-06-16T12:00:00Z') as id", [P1, item.id, U.ana])).rows[0].id);
  const before = (await db.query("select next_reminder_at, responsible_user_id from public.alert_followups where id=$1", [fid])).rows[0];
  await auth(U.ger, () => db.query("select public.delivery_item_update_fields($1,$2::jsonb)", [item.id, JSON.stringify({ responsible_user_id: U.bruno })]));
  const after = (await db.query("select next_reminder_at, responsible_user_id, status from public.alert_followups where id=$1", [fid])).rows[0];
  assert.equal(after.responsible_user_id, U.bruno);
  assert.equal(new Date(after.next_reminder_at).getTime(), new Date(before.next_reminder_at).getTime(), "prazo não reinicia");
  assert.equal(after.status, "OPEN");
  const fwd = (await db.query("select from_user_id,to_user_id,actor_user_id from public.alert_followup_events where followup_id=$1 and kind='FORWARDED'", [fid])).rows;
  assert.deepEqual(fwd.map((f) => [f.from_user_id, f.to_user_id, f.actor_user_id]), [[U.ana, U.bruno, U.ger]]);
  await auth(U.ger, () => db.query("select public.delivery_item_change_status($1,'CONCLUIDO',null,'Protocolo 2027/445')", [item.id]));
  const closed = (await db.query("select status,next_reminder_at,resolved_by_user_id from public.alert_followups where id=$1", [fid])).rows[0];
  assert.deepEqual([closed.status, closed.next_reminder_at, closed.resolved_by_user_id], ["RESOLVED", null, U.ger]);
});

await check("isolamento entre obras: nada de uma obra é visível ou alterável por quem é só de outra", async () => {
  await auth(U.adm2, () => db.query("select public.delivery_items_seed_checklist($1)", [P2]));
  const item1 = await byKey("AS_BUILT");
  await expectError(auth(U.adm2, () => db.query("select public.delivery_item_update_fields($1,$2::jsonb)", [item1.id, JSON.stringify({ risk: "BAIXA" })])), /permissão/);
  await expectError(auth(U.adm2, () => db.query("select public.delivery_item_change_status($1,'EM_ANDAMENTO',null,null)", [item1.id])), /usuário autorizado/);
  const seen = await auth(U.adm2, async () => (await db.query("select count(*)::int c from public.project_delivery_items where project_id=$1", [P1])).rows[0].c);
  assert.equal(seen, 0);
  assert.equal((await items(P2)).length, 14);
});

await check("sem sessão nenhuma função de escrita executa", async () => {
  await expectError(auth(null, () => db.query("select public.delivery_items_seed_checklist($1)", [P1])), /Sessão expirada/);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
await db.close();
if (failed > 0) process.exit(1);
