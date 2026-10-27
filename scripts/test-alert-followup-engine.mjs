// Motor de acompanhamento recorrente de alertas (lembretes "Repete: …"): relógio simulado,
// armazenamento em memória com a mesma semântica das funções SQL e transporte de e-mail
// simulado. Nada acessa banco, rede ou provedor real.
//
// Uso: node scripts/test-alert-followup-engine.mjs

import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const E = await import("../apps/web/lib/alerts/followup-engine.ts");
const P = await import("../apps/web/lib/alerts/repeat-policy.ts");

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

const H = 3600 * 1000;
const T0 = new Date("2026-11-02T12:00:00Z");
const at = (hours) => new Date(T0.getTime() + hours * H);

// ---------- armazenamento em memória (mesma semântica de alert_followup_* em SQL) ----------
class MemoryStore {
  constructor() {
    this.rows = new Map();
    this.tokenSeq = 0;
    this.releasedAfterFailure = 0;
  }
  add(f) { this.rows.set(f.id, f); return f; }
  get(id) { return this.rows.get(id); }
  async claimDue(limit, now) {
    const due = [...this.rows.values()]
      .filter((f) => E.isReminderDue(f, now))
      .sort((a, b) => a.nextReminderAt - b.nextReminderAt)
      .slice(0, limit);
    return due.map((f) => {
      const token = `claim-${++this.tokenSeq}`;
      const claimed = { ...f, claimToken: token, claimedUntil: new Date(now.getTime() + E.CLAIM_LEASE_MS) };
      this.rows.set(f.id, claimed);
      return { followup: claimed, claimToken: token, slot: f.nextReminderAt };
    });
  }
  async load(id) { const f = this.rows.get(id); return f ? { ...f } : null; }
  async markSent(id, token, slot, now) {
    const f = this.rows.get(id);
    if (!f || f.claimToken !== token || f.status !== "OPEN") throw new Error("claim inválido");
    this.rows.set(id, {
      ...f,
      lastSentSlot: slot,
      lastReminderAt: now,
      nextReminderAt: E.advanceSlot(slot, now, f.severity),
      claimToken: null,
      claimedUntil: null,
      failureCount: 0,
      history: [...f.history, { kind: "REMINDER_SENT", at: now, actorUserId: null, toUserId: f.responsibleUserId }],
    });
  }
  async markFailed(id, token, reason, now) {
    const f = this.rows.get(id);
    if (!f || f.claimToken !== token) return;
    this.rows.set(id, {
      ...f,
      claimToken: null,
      claimedUntil: null,
      failureCount: f.failureCount + 1,
      history: [...f.history, { kind: "REMINDER_FAILED", at: now, actorUserId: null, detail: reason }],
    });
  }
  async release(id, token) {
    const f = this.rows.get(id);
    if (f && f.claimToken === token) this.rows.set(id, { ...f, claimToken: null, claimedUntil: null });
  }
}

// Transporte simulado: idempotente por chave (como o envio real deve ser) e com falhas programáveis.
class FakeMailer {
  constructor() { this.sent = []; this.keys = new Set(); this.failFor = new Set(); this.failAll = false; }
  async send(message) {
    if (this.failAll || this.failFor.has(message.followup.id)) {
      const e = new Error("falha simulada"); e.name = "SMTP_INDISPONIVEL"; throw e;
    }
    if (this.keys.has(message.idempotencyKey)) return;
    this.keys.add(message.idempotencyKey);
    this.sent.push({ to: message.recipientUserId, key: message.idempotencyKey, followupId: message.followup.id });
  }
}

const mk = (id, severity, extra = {}) =>
  E.openFollowup({ id, projectId: "p1", sourceType: "CONTRACT_EVENT", sourceId: `ev-${id}`, severity, responsibleUserId: "u-ana", sentAt: T0, ...extra });

console.log("");
console.log("======================================");
console.log("ACOMPANHAMENTO RECORRENTE — MOTOR");
console.log("======================================");
console.log("");

await check("quatro intervalos: 1º lembrete em 24/48/96/168 h e recorrência na grade, até a conclusão", async () => {
  for (const [sev, hours] of [["CRITICA", 24], ["ALTA", 48], ["MEDIA", 96], ["BAIXA", 168]]) {
    const store = new MemoryStore(); const mailer = new FakeMailer();
    const f = store.add(mk(sev, sev));
    assert.equal(f.nextReminderAt.getTime(), at(hours).getTime(), `${sev} primeiro slot`);
    const times = [];
    for (const h of [hours - 1, hours, hours + 1, 2 * hours, 3 * hours + 5]) {
      const r = await E.runReminderCycle({ store, mailer, now: at(h) });
      times.push(r.sent);
    }
    assert.deepEqual(times, [0, 1, 0, 1, 1], `${sev}: ${times}`);
    assert.equal(store.get(sev).nextReminderAt.getTime(), at(4 * hours).getTime(), `${sev} próximo na grade`);
  }
});

await check("os intervalos vêm da política única (dias corridos): 1/2/4/7 dias = 24/48/96/168 h", () => {
  for (const s of ["CRITICA", "ALTA", "MEDIA", "BAIXA"]) assert.equal(P.REPEAT_INTERVAL_HOURS[s], P.REPEAT_INTERVAL_DAYS[s] * 24);
});

await check("confirmação repetida de EM ANDAMENTO NÃO posterga o lembrete já previsto", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  let f = store.add(mk("a", "ALTA"));
  const previsto = f.nextReminderAt.getTime();
  f = E.confirmInProgress(f, "u-ana", at(1)); store.rows.set("a", f);
  f = E.confirmInProgress(f, "u-ana", at(47)); store.rows.set("a", f); // pouco antes do lembrete
  f = E.confirmInProgress(f, "u-ana", at(47.9)); store.rows.set("a", f);
  assert.equal(f.nextReminderAt.getTime(), previsto);
  assert.equal(f.inProgress, true);
  assert.equal(f.status, "OPEN", "continua aberto");
  const r = await E.runReminderCycle({ store, mailer, now: at(48) });
  assert.equal(r.sent, 1, "lembrete previsto sai no horário mesmo após as confirmações");
  assert.equal(f.history.filter((h) => h.kind === "IN_PROGRESS_CONFIRMED").length, 3, "histórico registra cada confirmação");
});

await check("ENVIADO P/: novo responsável recebe os próximos lembretes; anterior não; prazo não reinicia; não conclui", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  let f = store.add(mk("b", "CRITICA"));
  const previsto = f.nextReminderAt.getTime();
  f = E.forwardFollowup(f, "u-ana", "u-bruno", at(10), new Set(["u-ana", "u-bruno"]));
  store.rows.set("b", f);
  assert.equal(f.status, "OPEN");
  assert.equal(f.nextReminderAt.getTime(), previsto, "não reinicia nem adia");
  const last = f.history.at(-1);
  assert.deepEqual([last.kind, last.actorUserId, last.fromUserId, last.toUserId, last.at.getTime()], ["FORWARDED", "u-ana", "u-ana", "u-bruno", at(10).getTime()]);
  await E.runReminderCycle({ store, mailer, now: at(24) });
  await E.runReminderCycle({ store, mailer, now: at(48) });
  assert.deepEqual(mailer.sent.map((m) => m.to), ["u-bruno", "u-bruno"]);
  assert.ok(!mailer.sent.some((m) => m.to === "u-ana"), "responsável anterior não recebe mais");
});

await check("ENVIADO P/ exige colaborador ATIVO da obra e diferente do atual", () => {
  const f = mk("c", "MEDIA");
  assert.throws(() => E.forwardFollowup(f, "u-ana", "u-outra-obra", at(1), new Set(["u-ana", "u-bruno"])), /ativo vinculado à obra/);
  assert.throws(() => E.forwardFollowup(f, "u-ana", "u-ana", at(1), new Set(["u-ana"])), /já está com este responsável/);
});

await check("RESOLVIDO registra quem/quando e interrompe os lembretes futuros", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  let f = store.add(mk("d", "CRITICA"));
  await E.runReminderCycle({ store, mailer, now: at(24) });
  f = E.resolveFollowup(store.get("d"), "u-ana", at(30)); store.rows.set("d", f);
  assert.equal(f.status, "RESOLVED");
  assert.equal(f.resolvedByUserId, "u-ana");
  assert.equal(f.resolvedAt.getTime(), at(30).getTime());
  assert.equal(f.nextReminderAt, null);
  const r = await E.runReminderCycle({ store, mailer, now: at(24 * 10) });
  assert.equal(r.claimed, 0);
  assert.equal(mailer.sent.length, 1);
  assert.throws(() => E.confirmInProgress(f, "u-ana", at(31)), /já foi concluído/);
});

await check("duplicidade/concorrência: dois ciclos simultâneos nunca enviam o mesmo slot", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  store.add(mk("e", "CRITICA")); store.add(mk("e2", "CRITICA"));
  const [r1, r2] = await Promise.all([
    E.runReminderCycle({ store, mailer, now: at(24) }),
    E.runReminderCycle({ store, mailer, now: at(24) }),
  ]);
  assert.equal(r1.sent + r2.sent, 2, "cada acompanhamento sai exatamente uma vez");
  assert.equal(new Set(mailer.sent.map((m) => m.key)).size, 2);
});

await check("claim vigente impede reenvio; claim expirado permite nova tentativa sem duplicar (mailer idempotente)", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  store.add(mk("f", "CRITICA"));
  const claimed = await store.claimDue(10, at(24)); // outro executor reivindicou e "morreu"
  assert.equal(claimed.length, 1);
  const during = await E.runReminderCycle({ store, mailer, now: at(24.05) });
  assert.equal(during.claimed, 0, "claim ainda vigente");
  const after = await E.runReminderCycle({ store, mailer, now: new Date(at(24).getTime() + E.CLAIM_LEASE_MS + 1000) });
  assert.equal(after.sent, 1);
});

await check("falha de envio: NÃO marca como enviado, continua devido e é reenviado na próxima execução", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  store.add(mk("g", "ALTA"));
  mailer.failAll = true;
  const r1 = await E.runReminderCycle({ store, mailer, now: at(48) });
  assert.deepEqual([r1.sent, r1.failed], [0, 1]);
  let f = store.get("g");
  assert.equal(f.lastReminderAt, null);
  assert.equal(f.lastSentSlot, null);
  assert.equal(f.nextReminderAt.getTime(), at(48).getTime(), "slot continua devido");
  assert.equal(f.failureCount, 1);
  assert.equal(f.history.at(-1).kind, "REMINDER_FAILED");
  assert.deepEqual(r1.failures, [{ followupId: "g", reason: "SMTP_INDISPONIVEL" }]);
  mailer.failAll = false;
  const r2 = await E.runReminderCycle({ store, mailer, now: at(52) });
  assert.equal(r2.sent, 1);
  f = store.get("g");
  assert.equal(f.failureCount, 0);
  assert.equal(f.lastSentSlot.getTime(), at(48).getTime());
  assert.equal(mailer.sent.length, 1, "um único envio efetivo");
});

await check("interrupção do agendamento: 10 dias parados geram UM lembrete e o próximo cai no futuro (sem acúmulo)", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  store.add(mk("h", "CRITICA"));
  const r = await E.runReminderCycle({ store, mailer, now: at(24 * 10 + 3) });
  assert.equal(r.sent, 1);
  const f = store.get("h");
  assert.ok(f.nextReminderAt.getTime() > at(24 * 10 + 3).getTime());
  assert.ok(f.nextReminderAt.getTime() - at(24 * 10 + 3).getTime() <= 24 * H, "próximo slot dentro de 1 intervalo");
  assert.equal((f.nextReminderAt.getTime() - T0.getTime()) % (24 * H), 0, "continua ancorado na grade (sem deriva)");
  const r2 = await E.runReminderCycle({ store, mailer, now: at(24 * 10 + 4) });
  assert.equal(r2.sent, 0);
});

await check("um acompanhamento com falha não impede os demais", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  store.add(mk("x1", "CRITICA")); store.add(mk("x2", "CRITICA")); store.add(mk("x3", "CRITICA"));
  mailer.failFor.add("x2");
  const r = await E.runReminderCycle({ store, mailer, now: at(24) });
  assert.deepEqual([r.sent, r.failed], [2, 1]);
  assert.deepEqual(mailer.sent.map((m) => m.followupId).sort(), ["x1", "x3"]);
});

await check("estado reverificado antes de enviar: concluído entre a reivindicação e o envio não envia nada", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  store.add(mk("y", "CRITICA"));
  const originalLoad = store.load.bind(store);
  store.load = async (id) => {
    store.rows.set(id, E.resolveFollowup(store.rows.get(id), "u-ana", at(24.01))); // alguém conclui agora
    return originalLoad(id);
  };
  const r = await E.runReminderCycle({ store, mailer, now: at(24) });
  assert.deepEqual([r.sent, r.skipped], [0, 1]);
  assert.equal(mailer.sent.length, 0);
});

await check("slot já enviado (falha ao gravar após o envio) não é reenviado: só avança", async () => {
  const store = new MemoryStore(); const mailer = new FakeMailer();
  store.add(mk("z", "CRITICA"));
  const realMarkSent = store.markSent.bind(store);
  let fail = true;
  store.markSent = async (...a) => { if (fail) { fail = false; throw new Error("db"); } return realMarkSent(...a); };
  const r1 = await E.runReminderCycle({ store, mailer, now: at(24) });
  assert.equal(r1.sent, 1);
  assert.deepEqual(r1.failures, [{ followupId: "z", reason: "MARK_SENT_FALHOU" }]);
  const r2 = await E.runReminderCycle({ store, mailer, now: new Date(at(24).getTime() + E.CLAIM_LEASE_MS + 1000) });
  assert.equal(mailer.sent.length, 1, "mailer idempotente: nenhum segundo e-mail");
  assert.ok(r2.claimed >= 1);
});

await check("permissões e isolamento: só o responsável atual ou admin DA MESMA obra age", () => {
  const f = mk("p", "MEDIA");
  assert.equal(E.canActOnFollowup(f, { userId: "u-ana", projectId: "p1", isProjectAdmin: false }), true);
  assert.equal(E.canActOnFollowup(f, { userId: "u-adm", projectId: "p1", isProjectAdmin: true }), true);
  assert.equal(E.canActOnFollowup(f, { userId: "u-bruno", projectId: "p1", isProjectAdmin: false }), false);
  assert.equal(E.canActOnFollowup(f, { userId: "u-adm-outra", projectId: "p2", isProjectAdmin: true }), false);
  assert.equal(E.canActOnFollowup(f, { userId: "u-ana", projectId: "p2", isProjectAdmin: false }), false);
});

await check("advanceSlot é monotônico, ancorado na grade e nunca retorna o passado", () => {
  for (const sev of ["CRITICA", "ALTA", "MEDIA", "BAIXA"]) {
    const step = P.repeatIntervalMs(sev);
    for (const k of [0, 1, 2, 7, 50]) {
      const now = new Date(T0.getTime() + k * step + 123456);
      const next = E.advanceSlot(T0, now, sev);
      assert.ok(next.getTime() > now.getTime());
      assert.equal((next.getTime() - T0.getTime()) % step, 0);
      assert.ok(next.getTime() - now.getTime() <= step);
    }
  }
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
