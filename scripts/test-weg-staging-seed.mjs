// Seed de homologação do projeto FICTÍCIO "WEG" — validação INTEGRAL em PostgreSQL descartável (PGlite),
// com as 117 migrations reais, o seed real (scripts/sql/homologation/seed-weg-staging.sql) e o código REAL
// do ciclo de alertas, do store (supabase-store.ts) e das RPCs SQL (record_risk_alert_action,
// escalate_sla_action_system). Provider = FakeEmailProvider; rede bloqueada; relógio simulado.
//
// Diferença para test-weg-alert-simulation.mjs: lá o banco é um modelo em memória; aqui é o SQL real.
//
// Uso: node --import ./scripts/lib/block-live-ai.mjs scripts/test-weg-staging-seed.mjs

import net from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

// ---------------------------------------------------------------- segurança
const FORBIDDEN_ENV = /^(SUPABASE_|NEXT_PUBLIC_SUPABASE|GOOGLE_(?!GMAIL_INBOUND_MAILBOX$|GMAIL_SENDER_EMAIL$)|ANTHROPIC_API_KEY|ELEVENLABS_|CRON_SECRET|ACC_RISK_ALERTS_|HML_DB_URL)/;
const leaked = Object.keys(process.env).filter((k) => FORBIDDEN_ENV.test(k));
if (leaked.length > 0) {
  console.error(`ABORTADO: credenciais/segredos presentes no ambiente (${leaked.join(", ")}). Rode com ambiente limpo (env -i).`);
  process.exit(2);
}
const networkAttempts = [];
globalThis.fetch = async (...args) => {
  networkAttempts.push(`fetch ${String(args[0]).slice(0, 80)}`);
  throw new Error("NETWORK_BLOCKED");
};
net.Socket.prototype.connect = function blockedConnect() {
  networkAttempts.push("net.Socket.connect");
  throw new Error("NETWORK_BLOCKED");
};

const CRM = "crm@axion.com.br";
process.env.ACC_WEEKLY_REPORTS_ENABLED = "true";
process.env.AXION_APP_BASE_URL = "https://acc-homologacao.invalid";
process.env.ACC_OUTBOUND_MODE = "pilot";
process.env.ACC_PILOT_RECIPIENT = CRM;
process.env.GOOGLE_GMAIL_INBOUND_MAILBOX = CRM;
process.env.GOOGLE_GMAIL_SENDER_EMAIL = CRM;
delete process.env.AXION_EMAIL_PROVIDER;
delete process.env.ACC_PILOT_ADDITIONAL_RECIPIENTS;

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
register("./ts-module-resolver.mjs", import.meta.url);
register("./lib/weg-alert-sim/hooks.mjs", import.meta.url);

const { runRiskAlertCycle } = await import("../apps/web/lib/risk-alerts/run-risk-alert-cycle");
const { processAlertReplies } = await import("../apps/web/lib/risk-alerts/replies/process-alert-replies");
const { createSupabaseRiskAlertStore } = await import("../apps/web/lib/risk-alerts/supabase-store");
const { applyAlertAction } = await import("../apps/web/lib/risk-alerts/alert-state-machine");
const { hashActionToken } = await import("../apps/web/lib/risk-alerts/action-links");
const { resolveMatrixPolicy } = await import("../apps/web/lib/sla/resolve-matrix-policy");
const { FakeEmailProvider } = await import("../apps/web/lib/email/fake-email-provider");
const { createPostgrestAdapter } = await import("./lib/pglite-postgrest-adapter.mjs");

// ---------------------------------------------------------------- mini-framework
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
    console.log(`FAIL ${name}\n     ${String(error.message).split("\n")[0].slice(0, 400)}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------- banco descartável + seed
const PROJECT = "5eed0000-0000-4000-8000-000000000001";
const U = { RESP: "5eed0001-0000-4000-8000-000000000001", GESTOR: "5eed0001-0000-4000-8000-000000000002", DIR: "5eed0001-0000-4000-8000-000000000003", FORA: "5eed0001-0000-4000-8000-000000000004" };
const EMAIL = { [U.RESP]: "responsavel.weg.teste@axion.com.br", [U.GESTOR]: "gestor.weg.teste@axion.com.br", [U.DIR]: "diretor.weg.teste@axion.com.br", [U.FORA]: "colega.fora.allowlist@axion.com.br" };
const SEED_SQL = readFileSync(path.join(repo, "scripts", "sql", "homologation", "seed-weg-staging.sql"), "utf8");
const platform = /const PLATFORM = `([\s\S]*?)`;/.exec(readFileSync(path.join(here, "test-migrations-full-replay.mjs"), "utf8"))[1];
const migrationsDir = path.join(repo, "supabase", "migrations");

async function newMigratedDb(include = () => true) {
  const db = new PGlite();
  await db.exec(platform);
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql") && include(x)).sort()) {
    await db.exec(readFileSync(path.join(migrationsDir, f), "utf8").replace(/^﻿/, "").replace(/create extension if not exists pgcrypto[^;]*;/gi, ""));
  }
  return db;
}
const addAuthUsers = async (db, ids) => {
  for (const id of ids) await db.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [id, EMAIL[id] ?? `${id}@sim.test`]);
};
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const count = async (db, table, where = "true") => (await q(db, `select count(*)::int c from public.${table} where ${where}`))[0].c;

console.log("== A. Seed: trava, aplicação e idempotência (migrations reais)");
const base = await newMigratedDb();

await check("A1 sem os 4 usuários simulados em auth.users o seed é RECUSADO (nada é gravado)", async () => {
  await addAuthUsers(base, [U.RESP, U.GESTOR, U.DIR]);
  let msg = "";
  try {
    await base.exec(SEED_SQL);
  } catch (error) {
    msg = error.message;
  }
  assert(/SEED RECUSADO.*auth\.users/.test(msg), msg);
  assert((await count(base, "projects")) === 0, "o seed recusado não pode gravar projeto");
});
await check("A2 com os usuários criados o seed aplica sem erro", async () => {
  await addAuthUsers(base, [U.FORA]);
  await base.exec(SEED_SQL);
  assert((await count(base, "projects")) === 1);
});
await check("A3 conteúdo: projeto, 4 usuários/papéis, matriz (4 níveis), contrato+aditivo, cláusulas, obrigações, eventos e fontes dos alertas", async () => {
  assert((await count(base, "project_memberships")) === 4 && (await count(base, "profiles")) === 4);
  assert((await count(base, "sla_matrix_rules")) === 4 && (await count(base, "sla_area_responsibles")) === 1);
  const resp = (await q(base, "select responsible_direct_user_id r, escalation_1_user_id g, board_user_id d from sla_area_responsibles"))[0];
  assert(resp.r === U.RESP && resp.g === U.GESTOR && resp.d === U.DIR, "cadeia Responsável → Gestor → Diretoria");
  assert((await count(base, "documents", "kind in ('CONTRATO_BASE','ADITIVO')")) === 2 && (await count(base, "clauses")) === 5 && (await count(base, "esg_obligations")) === 2 && (await count(base, "contract_events")) === 2);
  assert((await count(base, "weekly_schedule_ingestion_alerts")) === 3 && (await count(base, "schedule_version_comparisons")) === 2);
  const rules = await q(base, "select risk_level, time_unit, assume_deadline_value::int a from sla_matrix_rules order by 1");
  assert(rules.find((r) => r.risk_level === "CRITICAL").time_unit === "CLOCK_HOURS" && rules.find((r) => r.risk_level === "CRITICAL").a === 1, "prazos reduzidos só aqui");
  const cfg = (await q(base, "select risk_alerts_enabled, pilot_delivery_override_email o, array_length(pilot_recipient_allowlist_user_ids,1) n from project_weekly_schedule_ingestion_configs"))[0];
  assert(cfg.risk_alerts_enabled && cfg.o === CRM && cfg.n === 3, "override = CRM e allowlist de 3 (o 4º usuário fica fora)");
});
await check("A4 idempotência: reaplicar o seed não duplica nada", async () => {
  const tables = ["projects", "profiles", "project_memberships", "sla_matrix_rules", "documents", "document_versions", "clauses", "esg_obligations", "contract_events", "weekly_schedule_ingestion_alerts", "schedule_version_comparisons"];
  const before = await Promise.all(tables.map((t) => count(base, t)));
  await base.exec(SEED_SQL);
  const after = await Promise.all(tables.map((t) => count(base, t)));
  assert(JSON.stringify(before) === JSON.stringify(after), `${before} != ${after}`);
  assert((await q(base, "select current_setting('app.uid', true) u"))[0].u === "", "identidade temporária do seed é limpa no final");
});
await check("A5 identificação inequívoca: prefixo SIM-, UUIDs 5eed…, textos (FICTÍCIO/SIMULADO) e e-mails só *.weg.teste / colega.fora / crm", async () => {
  assert((await q(base, "select code, name from projects"))[0].code === "SIM-WEG-001");
  const bad = await q(base, `select 'projects' t, id::text from projects where id::text not like '5eed%'
     union all select 'documents', id::text from documents where id::text not like '5eed%'
     union all select 'clauses', id::text from clauses where id::text not like '5eed%'
     union all select 'alerts', id::text from weekly_schedule_ingestion_alerts where id::text not like '5eed%'`);
  assert(bad.length === 0, `ids sem prefixo: ${JSON.stringify(bad)}`);
  const plain = await q(base, `select title from clauses where text not like '%FICTÍCIO%' union all select title from documents where title not like '%FICTÍCIO%' union all select name from profiles where name not like '%SIMULADO%'`);
  assert(plain.length === 0, `sem marcação: ${JSON.stringify(plain)}`);
  const emails = (await q(base, "select email from profiles")).map((r) => r.email);
  assert(emails.every((e) => /\.weg\.teste@axion\.com\.br$/.test(e) || e === EMAIL[U.FORA]), emails.join());
});
await check("A6 trava: banco com projeto NÃO simulado recusa o seed (proteção contra execução em produção)", async () => {
  await base.query("insert into projects (id, code, name, client, location, start_date, baseline_end_date) values ('00000000-0000-4000-8000-0000000000aa','REAL-001','Obra real','Cliente real','x', date '2026-01-01', date '2027-01-01')");
  let msg = "";
  try {
    await base.exec(SEED_SQL);
  } catch (error) {
    msg = error.message;
  }
  assert(/SEED RECUSADO.*não são simulados/.test(msg), msg);
  await base.query("delete from projects where code = 'REAL-001'");
});
await check("A7 RLS: membro vê só o projeto simulado; não membro não vê nada (cláusulas e obrigações incluídas)", async () => {
  const asUser = async (uid, sql) => {
    await base.exec(`select set_config('app.uid', '${uid}', false); set role authenticated;`);
    try {
      return await q(base, sql);
    } finally {
      await base.exec("reset role; select set_config('app.uid', '', false);");
    }
  };
  assert((await asUser(U.RESP, "select id from projects")).length === 1);
  assert((await asUser(U.RESP, "select id from clauses")).length === 5);
  assert((await asUser("00000000-0000-4000-8000-0000000000ff", "select id from projects")).length === 0, "não membro vê projeto");
  assert((await asUser("00000000-0000-4000-8000-0000000000ff", "select id from clauses")).length === 0, "não membro vê cláusulas");
});

// clones rápidos do banco já semeado
const snapshot = await base.dumpDataDir("none");
await base.close();
async function seededClone() {
  return new PGlite({ loadDataDir: snapshot });
}

// ---------------------------------------------------------------- harness do ciclo real
const T0 = "2026-11-04T13:00:00.000Z"; // quarta 10:00 em São Paulo — janela do consolidado aberta
const plusMin = (iso, m) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();

function harness(db) {
  const rec = { calls: [], attempts: 0 };
  const failure = { on: false, only: null };
  let lastGuarded = null;
  class RecordingFakeProvider extends FakeEmailProvider {
    constructor() {
      super({ onGuardedInput: (g) => (lastGuarded = g), shouldFail: (input) => failure.on && (!failure.only || failure.only(input)) });
    }
    async send(input) {
      rec.attempts += 1;
      await new Promise((resolve) => setImmediate(resolve));
      lastGuarded = null;
      const result = await super.send(input);
      rec.calls.push({ raw: { ...input }, guarded: lastGuarded, result });
      return result;
    }
  }
  const provider = new RecordingFakeProvider();
  const expert = { answer: async () => ({ answerText: "Resposta simulada (sem IA).", confidence: 0.5, requiresHumanReview: true }) };
  const store = createSupabaseRiskAlertStore(createPostgrestAdapter(db));
  const run = (nowIso) => runRiskAlertCycle({ now: new Date(nowIso), store, provider, expert });
  return { db, rec, failure, store, run };
}
const outbox = (db, where = "true") => q(db, `select * from risk_alert_outbox where ${where} order by scheduled_for, created_at`);
const digestCalls = (h) => h.rec.calls.filter((c) => /CONSOLIDADO SEMANAL/.test(c.raw.subject));

console.log("== B. Ciclo real sobre o seed: BAIXO/MÉDIO (consolidado) e ALTO/CRÍTICO (imediato) → somente crm@");
const dbB = await seededClone();
const hB = harness(dbB);
const rB1 = await hB.run(T0);
await check("B1 prontidão do projeto: sem bloqueios; 5 casos (LOW, 2×MEDIUM, HIGH, CRITICAL) e 2 ações SLA", async () => {
  const p = rB1.projects[0];
  assert(p.blockedReason === null && p.readinessBlockers.length === 0, `bloqueios: ${p.blockedReason} ${p.readinessBlockers}`);
  const levels = (await q(dbB, "select risk_level l, count(*)::int c from risk_alert_cases group by 1 order by 1")).map((r) => `${r.l}:${r.c}`).join(",");
  assert(levels === "CRITICAL:1,HIGH:1,LOW:1,MEDIUM:2", levels);
  assert((await count(dbB, "sla_actions")) === 2);
});
await check("B2 todas as mensagens saem SOMENTE para crm@, com o responsável lógico preservado na outbox", async () => {
  assert(hB.rec.calls.length === 3, `envios: ${hB.rec.calls.length}`);
  for (const c of hB.rec.calls) assert(c.raw.to === CRM && c.guarded.to === CRM && c.guarded.subject.startsWith("[TESTE CONTROLADO] "));
  const rows = await outbox(dbB);
  assert(rows.length === 3 && rows.every((r) => r.status === "SENT" && r.recipient_email === CRM && r.recipient_user_id === U.RESP && r.provider === "FAKE" && r.attempt_count === 1));
  assert(rows.filter((r) => r.notification_type === "IMMEDIATE").length === 2 && rows.filter((r) => r.notification_type === "DIGEST").length === 1);
});
await check("B3 consolidado contém os 3 itens BAIXO/MÉDIO e guarda os metadados estruturados (digestItems) sem texto livre", async () => {
  const d = (await outbox(dbB, "notification_type = 'DIGEST'"))[0];
  assert(d.payload_summary.digestItems.length === 3 && d.payload_summary.medium === 2 && d.payload_summary.low === 1);
  assert(!/FICTÍCIO|SIMULADO/.test(JSON.stringify(d.payload_summary.digestItems)), "sem texto livre persistido");
});
await check("B4 prazos reduzidos no SQL: ALTO e CRÍTICO vencem em 1 h corrida (matriz do seed)", async () => {
  const rows = await q(dbB, "select assume_due_at, created_at from sla_actions");
  assert(rows.length === 2);
  for (const r of rows) assert(new Date(r.assume_due_at).toISOString() === plusMin(T0, 60), r.assume_due_at);
});
await check("B5 IDEMPOTÊNCIA: reexecutar (mesmo instante e +5 min) e rodar 3 ciclos SIMULTÂNEOS não cria nem envia nada novo", async () => {
  await hB.run(T0);
  await hB.run(plusMin(T0, 5));
  await Promise.all([hB.run(plusMin(T0, 6)), hB.run(plusMin(T0, 6)), hB.run(plusMin(T0, 7))]);
  assert(hB.rec.calls.length === 3 && (await count(dbB, "risk_alert_outbox")) === 3 && (await count(dbB, "risk_alert_cases")) === 5);
  assert((await outbox(dbB)).every((r) => r.attempt_count === 1));
});

console.log("== C. Escalonamento Responsável → Gestor → Diretoria com as RPCs SQL reais");
await check("C1 T+61 min: ALTO e CRÍTICO sobem ao Nível 2 (RPC escalate_sla_action_system); e-mails ao GESTOR lógico, entregues em crm@", async () => {
  await hB.run(plusMin(T0, 61));
  const esc = await outbox(dbB, "notification_type = 'ESCALATION' and escalation_level = 'ESCALAO_1'");
  assert(esc.length === 2 && esc.every((r) => r.recipient_user_id === U.GESTOR && r.status === "SENT" && r.recipient_email === CRM), JSON.stringify(esc.map((r) => [r.status, r.recipient_user_id])));
  assert((await q(dbB, "select distinct current_escalation_level l from sla_actions")).map((r) => r.l).join() === "ESCALAO_1");
});
await check("C2 T+121 min: sobe à Diretoria; sem duplicar ao repetir", async () => {
  await hB.run(plusMin(T0, 121));
  await hB.run(plusMin(T0, 121));
  const esc = await outbox(dbB, "notification_type = 'ESCALATION' and escalation_level = 'DIRETORIA'");
  assert(esc.length === 2 && esc.every((r) => r.recipient_user_id === U.DIR && r.status === "SENT" && r.recipient_email === CRM));
});
await check("C3 [CORREÇÃO #2 no SQL real] T+181 min: TOP_LEVEL_REACHED gravado UMA vez por caso, caso vai a DIRETORIA, sem e-mail extra e sem auditoria repetida", async () => {
  const before = hB.rec.calls.length;
  for (const m of [181, 182, 240, 600]) await hB.run(plusMin(T0, m));
  const events = await q(dbB, "select case_id, from_level, to_level, origin from risk_alert_action_events where action_type = 'TOP_LEVEL_REACHED'");
  assert(events.length === 2 && events.every((e) => e.origin === "SYSTEM" && e.to_level === "DIRETORIA"), JSON.stringify(events));
  const cases = await q(dbB, "select current_level, top_level_reached_at from risk_alert_cases where risk_level in ('HIGH','CRITICAL')");
  assert(cases.every((c) => c.current_level === "DIRETORIA" && c.top_level_reached_at), JSON.stringify(cases));
  assert(hB.rec.calls.length === before, "o limite da cadeia não envia e-mail");
  const audits = await count(dbB, "audit_log_entries", "action = 'RISK_ALERT_TOP_LEVEL_REACHED'");
  assert(audits === 2, `auditorias RISK_ALERT_TOP_LEVEL_REACHED: ${audits}`);
});
await check("C4 sequência final por caso: RESPONSAVEL → ESCALAO_1 → DIRETORIA (cada nível uma única vez), nenhum envio a usuário fora da allowlist", async () => {
  for (const level of ["HIGH", "CRITICAL"]) {
    const seq = (await outbox(dbB, `risk_level = '${level}'`)).map((r) => r.escalation_level).join(">");
    assert(seq === "RESPONSAVEL>ESCALAO_1>DIRETORIA", `${level}: ${seq}`);
  }
  assert((await count(dbB, "risk_alert_outbox", `recipient_user_id = '${U.FORA}'`)) === 0);
  assert(hB.rec.calls.every((c) => c.guarded.to === CRM));
});

console.log("== D. Respostas: botão (token), página web e Reply-To — RPC record_risk_alert_action real");
const dbD = await seededClone();
const hD = harness(dbD);
await hD.run(T0);
const caseOf = async (db, level) => (await q(db, "select id from risk_alert_cases where risk_level = $1 limit 1", [level]))[0].id;
const critD = await caseOf(dbD, "CRITICAL");
const highD = await caseOf(dbD, "HIGH");
const actD = async (caseId, { now, action, actor, origin, payload }) => {
  const loaded = await hD.store.loadCaseSnapshotForAction(caseId);
  const snap = await hD.store.loadProjectSnapshot(PROJECT);
  const policy = resolveMatrixPolicy({ rules: snap.matrixRules, responsibles: snap.areaResponsibles, settings: snap.settings, area: loaded.record.area, riskLevel: loaded.snapshot.riskLevel });
  return applyAlertAction({ now, snapshot: loaded.snapshot, action, actorUserId: actor, origin, payload, policy, config: snap.config, recipients: snap.recipients, eligibleForwardUserIds: [U.GESTOR, U.DIR] });
};
const tokenFor = (caseId, action) => {
  const call = hD.rec.calls.find((c) => (c.guarded.html ?? "").includes(`/alertas/${caseId}?acao=${action}`));
  const m = new RegExp(`/alertas/${caseId}\\?acao=${action}&(?:amp;)?t=([^"'&\\s<]+)`).exec(`${call.guarded.html}\n${call.guarded.text}`);
  return decodeURIComponent(m[1]);
};

await check("D1 BOTÃO: TOMANDO PROVIDÊNCIAS pelo link do e-mail → IN_PROGRESS, escalonamento imediato ao gestor, token consumido (uso único)", async () => {
  const now = plusMin(T0, 2);
  const tokenHash = hashActionToken(tokenFor(critD, "TAKING_ACTION"));
  const t = await actD(critD, { now, action: "TAKING_ACTION", actor: U.RESP, origin: "EMAIL", payload: { text: "Equipe acionada para tratar o desvio hoje." } });
  assert(t.ok, t.message);
  await hD.store.applyTransition(critD, t, U.RESP, { actionLinkTokenHash: tokenHash });
  const c = (await q(dbD, "select state, current_level from risk_alert_cases where id = $1", [critD]))[0];
  assert(c.state === "IN_PROGRESS" && c.current_level === "ESCALAO_1", JSON.stringify(c));
  assert((await q(dbD, "select status from sla_actions where id = (select sla_action_id from risk_alert_cases where id = $1)", [critD]))[0].status === "IN_PROGRESS");
  assert((await q(dbD, "select used_at from risk_alert_action_links where token_hash = $1", [tokenHash]))[0].used_at, "token deve estar consumido");
  const pending = await outbox(dbD, `case_id = '${critD}' and escalation_level = 'ESCALAO_1'`);
  assert(pending.length === 1 && pending[0].status === "PENDING" && pending[0].recipient_user_id === U.GESTOR && pending[0].origin === "EMAIL_REPLY");
  const before = hD.rec.calls.length;
  await hD.run(now);
  assert(hD.rec.calls.length === before + 1 && hD.rec.calls.at(-1).guarded.to === CRM);
  assert((await outbox(dbD, `case_id = '${critD}' and escalation_level = 'ESCALAO_1'`))[0].status === "SENT");
});
await check("D2 BOTÃO: reutilizar o mesmo link ou repetir a ação no mesmo minuto é rejeitado pelo SQL (sem duplicar e-mail)", async () => {
  const tokenHash = hashActionToken(tokenFor(critD, "TAKING_ACTION"));
  const t = await actD(critD, { now: plusMin(T0, 12), action: "OTHER", actor: U.RESP, origin: "EMAIL", payload: { text: "Atualização" } });
  assert(t.ok, t.message);
  let rejected = false;
  try {
    await hD.store.applyTransition(critD, t, U.RESP, { actionLinkTokenHash: tokenHash });
  } catch (error) {
    rejected = /link|token|utiliz|expir|inv/i.test(error.message);
  }
  assert(rejected, "link de uso único aceito de novo");
  const before = await count(dbD, "risk_alert_outbox");
  const again = await actD(critD, { now: plusMin(T0, 2), action: "TAKING_ACTION", actor: U.RESP, origin: "WEB", payload: { text: "Equipe acionada para tratar o desvio hoje." } });
  if (again.ok) {
    let dup = false;
    try {
      await hD.store.applyTransition(critD, again, U.RESP);
    } catch {
      dup = true;
    }
    assert(dup, "evento duplicado aceito");
  }
  assert((await count(dbD, "risk_alert_outbox")) === before);
});
await check("D3 PÁGINA WEB: RESOLVER exige confirmação, justificativa e evidência; ALTO fica em revisão humana até o gestor confirmar → RESOLVED + ação SLA COMPLETED", async () => {
  const base_ = { now: plusMin(T0, 3), action: "RESOLVED", actor: U.RESP, origin: "WEB" };
  assert((await actD(highD, { ...base_, payload: { confirmed: false } })).code === "CONFIRMATION_REQUIRED");
  assert((await actD(highD, { ...base_, payload: { confirmed: true } })).code === "JUSTIFICATION_REQUIRED");
  assert((await actD(highD, { ...base_, payload: { confirmed: true, justification: "Tratado" } })).code === "EVIDENCE_REQUIRED");
  const ok = await actD(highD, { ...base_, payload: { confirmed: true, justification: "Tratado", evidence: "Ata fictícia 04/11" } });
  assert(ok.ok && ok.caseUpdate.state === "RESOLUTION_PROPOSED");
  await hD.store.applyTransition(highD, ok, U.RESP);
  const confirm = await actD(highD, { now: plusMin(T0, 4), action: "RESOLUTION_CONFIRMED", actor: U.GESTOR, origin: "WEB", payload: { confirmed: true, text: "Confirmado pelo gestor." } });
  assert(confirm.ok, confirm.message);
  await hD.store.applyTransition(highD, confirm, U.GESTOR);
  const c = (await q(dbD, "select state, resolved_at, resolved_by_user_id from risk_alert_cases where id = $1", [highD]))[0];
  assert(c.state === "RESOLVED" && c.resolved_at && c.resolved_by_user_id === U.GESTOR, JSON.stringify(c));
  assert((await q(dbD, "select status from sla_actions where id = (select sla_action_id from risk_alert_cases where id = $1)", [highD]))[0].status === "COMPLETED");
  assert((await actD(highD, { now: plusMin(T0, 5), action: "OTHER", actor: U.RESP, origin: "WEB", payload: { text: "x" } })).code === "ALREADY_RESOLVED");
});
await check("D4 após RESOLVIDO (ALTO) e EM ANDAMENTO (CRÍTICO) o prazo vencido não escala mais à Diretoria nem envia e-mails", async () => {
  const before = hD.rec.calls.length;
  await hD.run(plusMin(T0, 200));
  await hD.run(plusMin(T0, 400));
  assert((await count(dbD, "risk_alert_outbox", "escalation_level = 'DIRETORIA'")) === 0);
  assert(hD.rec.calls.length === before);
});
await check("D5 REPLY-TO: resposta do responsável pelo próprio e-mail é ACEITA ([CORREÇÃO #1] no SQL real), aplica a ação e escala; reprocessar não repete", async () => {
  const dbR = await seededClone();
  const hR = harness(dbR);
  await hR.run(T0);
  const crit = await caseOf(dbR, "CRITICAL");
  const call = hR.rec.calls.find((c) => (c.guarded.html ?? "").includes(`/alertas/${crit}?acao=`));
  const replyTo = call.guarded.replyTo;
  assert(/^crm\+alerta-[A-Za-z0-9_-]{16,}@axion\.com\.br$/.test(replyTo), replyTo);
  await dbR.query(
    `insert into alert_email_messages (project_id, direction, provider, provider_message_id, message_id_header, sender_email, recipients, subject, body_original, status, received_at)
     values ($1, 'INBOUND', 'GMAIL', 'sim-gmail-1', '<sim-resposta-1@axion.test>', $2, $3, 'Re: alerta', $4, 'RECEIVED', $5)`,
    [PROJECT, EMAIL[U.RESP], `{${replyTo}}`, "Estou tomando as providências: equipe acionada, andamento em execução hoje.", plusMin(T0, 9)]
  );
  hR.store.setClock?.(plusMin(T0, 10));
  const result = await processAlertReplies(hR.store, PROJECT, plusMin(T0, 10), [CRM]);
  assert(result.applied === 1 && result.ignored === 0, JSON.stringify(result));
  const msg = (await q(dbR, "select status, classification, correlation_method, sender_user_id from alert_email_messages where provider_message_id = 'sim-gmail-1'"))[0];
  assert(msg.status === "PROCESSED" && msg.classification === "STATUS_UPDATE" && msg.correlation_method === "REPLY_TO_TOKEN" && msg.sender_user_id === U.RESP, JSON.stringify(msg));
  assert((await q(dbR, "select state from risk_alert_cases where id = $1", [crit]))[0].state === "IN_PROGRESS");
  const esc = await outbox(dbR, `case_id = '${crit}' and escalation_level = 'ESCALAO_1'`);
  assert(esc.length === 1 && esc[0].origin === "EMAIL_REPLY" && esc[0].recipient_user_id === U.GESTOR);
  const events = await count(dbR, "risk_alert_action_events");
  await processAlertReplies(hR.store, PROJECT, plusMin(T0, 11), [CRM]);
  assert((await count(dbR, "risk_alert_action_events")) === events, "reprocessar repetiu a ação");
  // remetentes: o próprio crm@ é ignorado; usuário fora da allowlist é não autorizado
  await dbR.query(`insert into alert_email_messages (project_id, direction, provider, provider_message_id, message_id_header, sender_email, recipients, subject, body_original, status, received_at)
     values ($1,'INBOUND','GMAIL','sim-gmail-2','<sim-resposta-2@axion.test>',$2,$4,'Re','Estou tomando as providências hoje, andamento em execução.','RECEIVED',$5),
            ($1,'INBOUND','GMAIL','sim-gmail-3','<sim-resposta-3@axion.test>',$3,$4,'Re','Estou tomando as providências hoje, andamento em execução.','RECEIVED',$5)`, [PROJECT, CRM, EMAIL[U.FORA], `{${replyTo}}`, plusMin(T0, 12)]);
  await processAlertReplies(hR.store, PROJECT, plusMin(T0, 13), [CRM]);
  const st = Object.fromEntries((await q(dbR, "select provider_message_id p, status s from alert_email_messages where provider_message_id in ('sim-gmail-2','sim-gmail-3')")).map((r) => [r.p, r.s]));
  assert(st["sim-gmail-2"] === "IGNORED_SELF" && st["sim-gmail-3"] === "UNAUTHORIZED_REPLY", JSON.stringify(st));
  await dbR.close();
});

console.log("== E. Consolidado semanal: falha → retentativa segura (SQL real)");
await check("E1 falha do consolidado na quarta: a linha fica PENDENTE e é reenviada no ciclo seguinte (mesma linha, mesmo destinatário, sem duplicar)", async () => {
  const db = await seededClone();
  const h = harness(db);
  h.failure.on = true;
  h.failure.only = (i) => /CONSOLIDADO SEMANAL/.test(i.subject);
  await h.run(T0);
  let d = (await outbox(db, "notification_type = 'DIGEST'"))[0];
  assert(d.status === "PENDING" && d.attempt_count === 1 && /falha simulada/i.test(d.last_error), `${d.status}/${d.attempt_count}`);
  h.failure.on = false;
  await Promise.all([h.run(plusMin(T0, 30)), h.run(plusMin(T0, 30))]);
  const rows = await outbox(db, "notification_type = 'DIGEST'");
  assert(rows.length === 1 && rows[0].id === d.id && rows[0].status === "SENT" && rows[0].recipient_user_id === U.RESP && rows[0].recipient_email === CRM);
  assert(digestCalls(h).length === 1, `envios do consolidado: ${digestCalls(h).length}`);
  await db.close();
});
await check("E2 [CORREÇÃO do digest] retentativa FORA da janela (quinta): conteúdo reconstruído dos metadados e enviado uma vez, sem RISK_CASE_REQUIRED", async () => {
  const db = await seededClone();
  const h = harness(db);
  h.failure.on = true;
  h.failure.only = (i) => /CONSOLIDADO SEMANAL/.test(i.subject);
  await h.run(T0);
  h.failure.on = false;
  await Promise.all([h.run(plusMin(T0, 24 * 60)), h.run(plusMin(T0, 24 * 60))]);
  const d = (await outbox(db, "notification_type = 'DIGEST'"))[0];
  assert(d.status === "SENT" && d.attempt_count === 2 && !/RISK_CASE_REQUIRED/.test(d.last_error ?? ""), `${d.status}/${d.attempt_count}/${d.last_error}`);
  assert(digestCalls(h).length === 1);
  const html = digestCalls(h)[0].raw.html;
  assert(/2 risco\(s\) M/.test(html) && /1 risco\(s\) BAIXO/.test(`${html}`), "itens do consolidado original");
  assert((await count(db, "audit_log_entries", "action = 'RISK_ALERT_DIGEST_RETRY_SENT'")) === 1);
  await db.close();
});

console.log("== G. Ordem de implantação e compatibilidade das migrations 20261029* (lease e auditoria do worker)");
const NEW_MIGRATIONS = readdirSync(migrationsDir).filter((f) => f.startsWith("20261029")).sort();
const runMigration = (db, f) => db.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
await check("G1 existem exatamente as 2 migrations novas, aditivas e idempotentes (add column if not exists / create or replace)", () => {
  assert(NEW_MIGRATIONS.length === 2 && /risk_alert_outbox_send_claim/.test(NEW_MIGRATIONS[0]) && /sla_action_audit_service_role_actor/.test(NEW_MIGRATIONS[1]), NEW_MIGRATIONS.join());
  const sqlAll = NEW_MIGRATIONS.map((f) => readFileSync(path.join(migrationsDir, f), "utf8")).join("\n");
  assert(/add column if not exists claimed_at/i.test(sqlAll) && /create or replace function public\.audit_sla_action_updated/i.test(sqlAll));
  assert(!/\b(drop\s+(table|column|function|trigger)|alter\s+column|truncate|delete\s+from|update\s+public\.)/i.test(sqlAll.replace(/--.*$/gm, "")), "sem DDL/DML destrutivo");
});
await check("G2 CÓDIGO ANTES DA MIGRATION: falha fechada — nada é enviado, nenhuma linha é alterada; depois da migration (sobre os dados existentes) os envios saem UMA vez; reaplicar é no-op", async () => {
  const db = await newMigratedDb((f) => !NEW_MIGRATIONS.includes(f)); // banco no estado ANTERIOR às migrations novas
  await addAuthUsers(db, Object.values(U));
  await db.exec(SEED_SQL);
  const h = harness(db);
  assert((await q(db, "select count(*)::int c from information_schema.columns where table_name = 'risk_alert_outbox' and column_name = 'claimed_at'"))[0].c === 0);
  await h.run(T0);
  await h.run(plusMin(T0, 1));
  assert(h.rec.calls.length === 0, `envios sem a coluna: ${h.rec.calls.length}`);
  let rows = await outbox(db);
  assert(rows.length === 3 && rows.every((r) => r.status === "PENDING" && r.attempt_count === 0 && !r.sent_at), "linhas intactas e pendentes");
  for (const f of NEW_MIGRATIONS) await runMigration(db, f); // aplicação sobre dados existentes
  rows = await outbox(db);
  assert(rows.length === 3 && rows.every((r) => r.claimed_at === null && r.status === "PENDING"), "migration preserva as linhas existentes");
  await Promise.all([h.run(plusMin(T0, 5)), h.run(plusMin(T0, 5))]);
  rows = await outbox(db);
  assert(h.rec.calls.length === 3 && rows.every((r) => r.status === "SENT" && r.attempt_count === 1 && r.claimed_at === null && r.recipient_email === CRM), JSON.stringify(rows.map((r) => [r.status, r.attempt_count])));
  for (const f of NEW_MIGRATIONS) await runMigration(db, f); // idempotência da migration
  await h.run(plusMin(T0, 6));
  assert(h.rec.calls.length === 3 && (await count(db, "risk_alert_outbox")) === 3, "reaplicar e rodar de novo não duplica nada");
  await db.close();
});
await check("G3 a migration da auditoria só substitui a função (mesmo nome e assinatura) e não altera os gatilhos de sla_actions", async () => {
  const db = await newMigratedDb((f) => !NEW_MIGRATIONS.includes(f));
  const before = (await q(db, "select pg_get_functiondef('public.audit_sla_action_updated()'::regprocedure) d"))[0].d;
  const triggers = async () => (await q(db, "select tgname from pg_trigger where tgrelid = 'public.sla_actions'::regclass and not tgisinternal order by 1")).map((r) => r.tgname).join();
  const t0 = await triggers();
  for (const f of NEW_MIGRATIONS) await runMigration(db, f);
  const after = (await q(db, "select pg_get_functiondef('public.audit_sla_action_updated()'::regprocedure) d"))[0].d;
  assert(before !== after && /v_started_actor/.test(after) && !/v_started_actor/.test(before));
  assert((await triggers()) === t0, "os gatilhos de sla_actions não mudam");
  await db.close();
});

console.log("== F. Isolamento final");
await check("F1 nenhuma tentativa de rede em todo o teste; todos os envios do provider FAKE e só para crm@", () => {
  assert(networkAttempts.length === 0, networkAttempts.join(" | "));
  for (const h of [hB, hD]) for (const c of h.rec.calls) assert(c.result.provider === "FAKE" && c.guarded.to === CRM);
});
await dbB.close();
await dbD.close();

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
