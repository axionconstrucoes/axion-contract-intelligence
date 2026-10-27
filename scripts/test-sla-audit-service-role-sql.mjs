// Migration 20261029110000: auditoria de ações SLA quando a mudança vem do worker (service_role, sem auth.uid()).
// Replay de TODAS as migrations em PGlite (descartável, sem rede) + cenários mínimos.
//
// Antes da correção, mudar sla_actions.status para IN_PROGRESS (ou trocar o responsável) sem auth.uid()
// inseria audit_log_entries com actor_type = 'USER' e autor nulo e violava audit_log_entries_check:
// a transação inteira falhava (ex.: resposta por e-mail -> TOMANDO PROVIDÊNCIAS).
//
// Uso: node scripts/test-sla-audit-service-role-sql.mjs

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "supabase", "migrations");
const platform = /const PLATFORM = `([\s\S]*?)`;/.exec(readFileSync(path.join(here, "test-migrations-full-replay.mjs"), "utf8"))[1];

let passed = 0;
let failed = 0;
const assert = (c, m) => {
  if (!c) throw new Error(m ?? "assertion failed");
};
async function check(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}\n     ${String(error.message).split("\n")[0].slice(0, 300)}`);
    failed += 1;
  }
}

const db = new PGlite();
await db.exec(platform);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) await db.exec(readFileSync(path.join(dir, f), "utf8").replace(/^﻿/, "").replace(/create extension if not exists pgcrypto[^;]*;/gi, ""));

const P = "00000000-0000-4000-8000-0000000000a0";
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
for (const [id, n] of [[U1, 1], [U2, 2]]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `u${n}@x.test`]);
await db.exec(`
  insert into public.profiles (id, name, email, origin) values ('${U1}', 'U1', 'u1@x.test', 'AXION_INTERNO'), ('${U2}', 'U2', 'u2@x.test', 'AXION_INTERNO') on conflict (id) do nothing;
  insert into public.projects (id, code, name, client, location, start_date, baseline_end_date) values ('${P}', 'SIM-AUDIT', 'Auditoria (SIMULADO)', 'x', 'x', date '2026-01-01', date '2027-01-01');
  insert into public.project_memberships (project_id, user_id, permission, status, area) values ('${P}', '${U1}', 'GESTOR', 'ACTIVE', 'PLANEJAMENTO'), ('${P}', '${U2}', 'COLABORADOR', 'ACTIVE', 'PLANEJAMENTO');
`);
const newAction = async (n) => {
  const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  await db.query("insert into public.sla_actions (id, project_id, origin, title, risk_level, area, responsible_user_id, assume_due_at, created_by_type) values ($1,$2,'OTHER','Ação teste','HIGH','PLANEJAMENTO',$3, now() + interval '1 hour','SYSTEM')", [id, P, U1]);
  return id;
};
const asWorker = () => db.exec("select set_config('app.uid','',false), set_config('request.jwt.claim.sub','',false)");
const asUser = (uid) => db.exec(`select set_config('app.uid','${uid}',false), set_config('request.jwt.claim.sub','${uid}',false)`);
const audit = async (id, action) => (await db.query("select actor_type, actor_user_id from public.audit_log_entries where entity_id = $1 and action = $2", [id, action])).rows;

await check("S1 worker (sem auth.uid()) inicia a ação informando quem agiu → ACTION_STARTED como USER do usuário informado (antes: a transação falhava)", async () => {
  const id = await newAction(1);
  await asWorker();
  await db.query("update public.sla_actions set status = 'IN_PROGRESS', acknowledged_at = now(), acknowledged_by_user_id = $2 where id = $1", [id, U2]);
  const rows = await audit(id, "ACTION_STARTED");
  assert(rows.length === 1 && rows[0].actor_type === "USER" && rows[0].actor_user_id === U2, JSON.stringify(rows));
});
await check("S2 worker sem usuário identificável → ACTION_STARTED como SYSTEM (sem autor, sem rótulo)", async () => {
  const id = await newAction(2);
  await asWorker();
  await db.query("update public.sla_actions set status = 'IN_PROGRESS' where id = $1", [id]);
  const rows = await audit(id, "ACTION_STARTED");
  assert(rows.length === 1 && rows[0].actor_type === "SYSTEM" && rows[0].actor_user_id === null, JSON.stringify(rows));
});
await check("S3 usuário autenticado: comportamento inalterado (autor = auth.uid())", async () => {
  const id = await newAction(3);
  await asUser(U1);
  await db.query("update public.sla_actions set status = 'IN_PROGRESS' where id = $1", [id]);
  const rows = await audit(id, "ACTION_STARTED");
  assert(rows.length === 1 && rows[0].actor_type === "USER" && rows[0].actor_user_id === U1, JSON.stringify(rows));
  await asWorker();
});
await check("S4 reatribuição de responsável: worker → SYSTEM; usuário autenticado → USER", async () => {
  const a = await newAction(4);
  await asWorker();
  await db.query("update public.sla_actions set responsible_user_id = $2 where id = $1", [a, U2]);
  let rows = await audit(a, "ACTION_REASSIGNED");
  assert(rows.length === 1 && rows[0].actor_type === "SYSTEM" && rows[0].actor_user_id === null, JSON.stringify(rows));
  const b = await newAction(5);
  await asUser(U1);
  await db.query("update public.sla_actions set responsible_user_id = $2 where id = $1", [b, U2]);
  rows = await audit(b, "ACTION_REASSIGNED");
  assert(rows.length === 1 && rows[0].actor_type === "USER" && rows[0].actor_user_id === U1, JSON.stringify(rows));
  await asWorker();
});
await check("S5 as demais auditorias da função seguem iguais (assumida, concluída, vencida)", async () => {
  const id = await newAction(6);
  await asWorker();
  await db.query("update public.sla_actions set acknowledged_at = now(), acknowledged_by_user_id = $2 where id = $1", [id, U1]);
  await db.query("update public.sla_actions set status = 'COMPLETED', completed_at = now(), completed_by_user_id = $2, completion_note = 'ok' where id = $1", [id, U1]);
  assert((await audit(id, "ACTION_ACKNOWLEDGED"))[0].actor_user_id === U1 && (await audit(id, "ACTION_COMPLETED"))[0].actor_user_id === U1);
  const o = await newAction(7);
  await db.query("update public.sla_actions set status = 'OVERDUE' where id = $1", [o]);
  assert((await audit(o, "ACTION_OVERDUE"))[0].actor_type === "SYSTEM");
});
await check("S6 a migration é um CREATE OR REPLACE (não edita migrations já aplicadas) e tem o nome/versão esperados", () => {
  const f = files.find((x) => x.startsWith("20261029110000_"));
  assert(f, "migration ausente");
  const sql = readFileSync(path.join(dir, f), "utf8");
  assert(/create or replace function public\.audit_sla_action_updated/i.test(sql) && !/drop (function|trigger|table)/i.test(sql));
});

await db.close();
console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
