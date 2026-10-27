// Lógica da fila offline dos registros de campo SSMA (queue-core.ts) com armazenamento em memória
// e transporte FALSO. Nenhuma rede, nenhum banco. IndexedDB real é testado à parte, em Chrome:
// scripts/test-ssma-offline-browser.mjs.
//
// Uso: node scripts/test-ssma-offline-queue.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);
const { createFieldQueue, TransportError } = await import("../apps/web/lib/ssma/field-records/queue-core.ts");
const { validateFieldRecordDraft, QUEUE_STATUS_LABELS } = await import("../apps/web/lib/ssma/field-records/types.ts");

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

const ANA = "u-ana";
const BRUNO = "u-bruno";
const P1 = "p-1";
const P2 = "p-2";

function memoryStore() {
  const records = new Map();
  const blobs = new Map();
  return {
    records,
    blobs,
    put: async (item) => void records.set(item.clientId, structuredClone(item)),
    get: async (id) => (records.has(id) ? structuredClone(records.get(id)) : null),
    list: async () => [...records.values()].map((item) => structuredClone(item)),
    delete: async (id) => void records.delete(id),
    putBlob: async (key, blob) => void blobs.set(key, blob),
    getBlob: async (key) => blobs.get(key) ?? null,
    deleteBlob: async (key) => void blobs.delete(key),
  };
}

/** Servidor falso, idempotente como as RPCs: o que já existe não é duplicado. */
function fakeServer() {
  const s = {
    sessionUser: ANA,
    online: true,
    records: new Map(),
    photos: new Map(),
    objects: new Set(),
    calls: { submit: 0, upload: 0, register: 0 },
    failNext: null, // { step, error }
    denyProjects: new Set(),
  };
  const guard = (step) => {
    if (!s.online) throw new TransportError("NETWORK", "offline");
    if (s.failNext && s.failNext.step === step) {
      const failure = s.failNext;
      if (!failure.keep) s.failNext = null;
      throw failure.error;
    }
  };
  s.transport = {
    currentUserId: async () => {
      if (!s.online) throw new TransportError("NETWORK", "offline");
      return s.sessionUser;
    },
    submitRecord: async (item) => {
      s.calls.submit += 1;
      guard("submit");
      if (item.userId !== s.sessionUser) throw new TransportError("SERVER", "x", "USER_MISMATCH");
      if (s.denyProjects.has(item.projectId)) throw new TransportError("SERVER", "x", "PROJECT_ACCESS_DENIED");
      if (!s.records.has(item.clientId)) s.records.set(item.clientId, { ...item.draft, createdAt: item.clientCreatedAt, by: s.sessionUser });
    },
    uploadPhoto: async (item, photo) => {
      s.calls.upload += 1;
      guard("upload");
      s.objects.add(`${item.clientId}/${photo.id}`);
    },
    registerPhoto: async (item, photo) => {
      s.calls.register += 1;
      guard("register");
      s.photos.set(photo.id, item.clientId);
    },
  };
  return s;
}

const hashBlob = async (blob) => createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
let idSeq = 0;
function setup(serverOverrides = {}, depsOverrides = {}) {
  const store = memoryStore();
  const server = Object.assign(fakeServer(), serverOverrides);
  let clock = new Date("2026-10-27T08:00:00Z");
  const queue = createFieldQueue({
    store,
    transport: server.transport,
    hashBlob,
    now: () => clock,
    newId: () => `id-${++idSeq}`,
    ...depsOverrides,
  });
  return { store, server, queue, setClock: (d) => (clock = d) };
}

const draft = (over = {}) => ({
  kind: "OCORRENCIA", category: "Condição insegura", description: "Fio exposto", location: "Pav. 2",
  occurredAt: "2026-10-27T07:30:00Z", risk: "ALTA", responsibleUserId: "u-bruno", dueDate: "2026-11-05", ...over,
});
const photo = (text, name = "foto.jpg", type = "image/jpeg") => ({ name, mimeType: type, blob: new Blob([text], { type }) });

console.log("\n======================================\nSSMA — FILA OFFLINE (módulo puro)\n======================================");

await check("validação do rascunho (campos, data futura, responsável/prazo)", async () => {
  const now = new Date("2026-10-27T12:00:00Z");
  assert.equal(validateFieldRecordDraft(draft(), now).ok, true);
  assert.equal(validateFieldRecordDraft(draft({ description: "ab" }), now).ok, false);
  assert.equal(validateFieldRecordDraft(draft({ location: " " }), now).ok, false);
  assert.equal(validateFieldRecordDraft(draft({ occurredAt: "2027-01-01T00:00:00Z" }), now).ok, false);
  assert.equal(validateFieldRecordDraft(draft({ dueDate: null }), now).ok, false);
  assert.equal(validateFieldRecordDraft(draft({ responsibleUserId: null, dueDate: "2026-11-05" }), now).ok, false);
  assert.equal(validateFieldRecordDraft(draft({ responsibleUserId: null, dueDate: null }), now).ok, true);
});

await check("registro sem sinal fica 'Salvo no aparelho' com autoria e horário reais do aparelho", async () => {
  const { queue, server, setClock } = setup({ online: false });
  setClock(new Date("2026-10-27T08:15:00Z"));
  const item = await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] });
  assert.equal(item.status, "SAVED_ON_DEVICE");
  assert.equal(QUEUE_STATUS_LABELS[item.status], "Salvo no aparelho");
  assert.equal(item.userId, ANA);
  assert.equal(item.clientCreatedAt, "2026-10-27T08:15:00.000Z");
  const report = await queue.sync(ANA);
  assert.equal(report.outcome, "OFFLINE");
  assert.equal((await queue.listForUser(ANA))[0].status, "SAVED_ON_DEVICE", "offline não é falha");
  assert.equal(server.calls.submit, 0);
});

await check("reconexão: envia, marca 'Sincronizado', preserva horário real e libera os arquivos locais", async () => {
  const { queue, server, store, setClock } = setup({ online: false });
  setClock(new Date("2026-10-27T08:15:00Z"));
  const item = await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a"), photo("b")] });
  setClock(new Date("2026-10-27T18:00:00Z")); // reconecta horas depois
  server.online = true;
  const report = await queue.sync(ANA);
  assert.deepEqual([report.outcome, report.synced, report.failed, report.remaining], ["DONE", 1, 0, 0]);
  const after = (await queue.listForUser(ANA))[0];
  assert.equal(after.status, "SYNCED");
  assert.equal(after.syncedAt, "2026-10-27T18:00:00.000Z");
  assert.equal(server.records.get(item.clientId).createdAt, "2026-10-27T08:15:00.000Z", "horário real, não o da sincronização");
  assert.equal(server.photos.size, 2);
  assert.equal(store.blobs.size, 0, "fotos locais removidas após sincronizar");
});

await check("duplicidade: sincronizar de novo / repetir não duplica nada", async () => {
  const { queue, server } = setup();
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] });
  await queue.sync(ANA);
  const second = await queue.sync(ANA);
  assert.equal(second.synced, 0);
  assert.equal(server.records.size, 1);
  assert.equal(server.calls.submit, 1);
  assert.equal(server.calls.upload, 1);
});

await check("a mesma foto duas vezes no mesmo registro é guardada uma única vez", async () => {
  const { queue } = setup();
  const item = await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("igual"), photo("igual", "copia.jpg")] });
  assert.equal(item.photos.length, 1);
});

await check("queda no meio do envio retoma do ponto certo (sem reenviar o que já foi)", async () => {
  const { queue, server } = setup();
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a"), photo("b")] });
  // a rede cai ao registrar a 1ª foto
  server.failNext = { step: "register", error: new TransportError("NETWORK", "cai") };
  const first = await queue.sync(ANA);
  assert.equal(first.outcome, "OFFLINE");
  const mid = (await queue.listForUser(ANA))[0];
  assert.equal(mid.status, "SAVED_ON_DEVICE");
  assert.equal(mid.recordSubmitted, true);
  assert.equal(mid.photos[0].uploaded, true);
  assert.equal(mid.photos[0].registered, false);
  const second = await queue.sync(ANA);
  assert.equal(second.synced, 1);
  assert.equal(server.calls.submit, 1, "registro não reenviado");
  assert.equal(server.calls.upload, 2, "cada foto enviada uma vez");
  assert.equal(server.records.size, 1);
  assert.equal(server.photos.size, 2);
});

await check("falha do servidor fica visível, permite nova tentativa e não vira sincronizado", async () => {
  const { queue, server } = setup();
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [] });
  server.failNext = { step: "submit", error: new TransportError("SERVER", "x", "SOMETHING_ODD") };
  const first = await queue.sync(ANA);
  assert.equal(first.failed, 1);
  const failed = (await queue.listForUser(ANA))[0];
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.lastError && !/SOMETHING_ODD/.test(failed.lastError), "mensagem amigável, sem código cru");
  assert.equal(failed.permanentError, false);
  const retry = await queue.sync(ANA);
  assert.equal(retry.synced, 1);
  assert.equal((await queue.listForUser(ANA))[0].status, "SYNCED");
});

await check("erro permanente (sem acesso à obra) não é repetido sozinho; descarte e nova tentativa manual", async () => {
  const { queue, server } = setup();
  server.denyProjects.add(P2);
  const item = await queue.save({ userId: ANA, projectId: P2, draft: draft(), photos: [] });
  await queue.sync(ANA);
  const failed = (await queue.listForUser(ANA))[0];
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.permanentError, true);
  const callsBefore = server.calls.submit;
  await queue.sync(ANA);
  assert.equal(server.calls.submit, callsBefore, "não repete sozinho");
  await queue.sync(ANA, { retryPermanent: true });
  assert.equal(server.calls.submit, callsBefore + 1, "retry manual tenta de novo");
  assert.equal(await queue.discard(ANA, item.clientId), true);
  assert.equal((await queue.listForUser(ANA)).length, 0);
});

await check("troca de conta: sessão de outro usuário NÃO envia os registros da conta original", async () => {
  const { queue, server } = setup();
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] });
  server.sessionUser = BRUNO; // Bruno entrou no mesmo aparelho
  const asAna = await queue.sync(ANA);
  assert.equal(asAna.outcome, "BLOCKED_USER_MISMATCH");
  assert.equal(server.calls.submit, 0);
  const asBruno = await queue.sync(BRUNO);
  assert.equal(asBruno.outcome, "DONE");
  assert.equal(asBruno.synced, 0);
  assert.equal(server.calls.submit, 0, "nada de Ana vaza pela conta de Bruno");
});

await check("isolamento: Bruno não lista, descarta nem vê o conteúdo dos itens de Ana", async () => {
  const { queue } = setup({ sessionUser: BRUNO });
  const item = await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] });
  assert.equal((await queue.listForUser(BRUNO)).length, 0);
  assert.equal(await queue.foreignPendingCount(BRUNO), 1, "apenas a contagem é exposta");
  assert.equal(await queue.discard(BRUNO, item.clientId), false);
  assert.equal((await queue.listForUser(ANA)).length, 1);
});

await check("isolamento por obra: a lista filtra por obra e a fila de uma obra não mistura com a outra", async () => {
  const { queue } = setup();
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [] });
  await queue.save({ userId: ANA, projectId: P2, draft: draft({ description: "outro" }), photos: [] });
  assert.equal((await queue.listForUser(ANA, P1)).length, 1);
  assert.equal((await queue.listForUser(ANA, P2)).length, 1);
  assert.equal((await queue.listForUser(ANA)).length, 2);
});

await check("remover dados de outras contas é explícito e preserva os do usuário atual", async () => {
  const { queue, store } = setup();
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] });
  await queue.save({ userId: BRUNO, projectId: P1, draft: draft({ description: "do Bruno" }), photos: [photo("b")] });
  assert.equal(await queue.purgeForeign(BRUNO), 1);
  assert.equal((await queue.listForUser(BRUNO)).length, 1);
  assert.equal((await queue.listForUser(ANA)).length, 0);
  assert.equal(store.blobs.size, 1, "arquivos de Ana removidos, os de Bruno preservados");
});

await check("sem sessão: nada é enviado", async () => {
  const { queue, server } = setup({ sessionUser: null });
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [] });
  assert.equal((await queue.sync(ANA)).outcome, "BLOCKED_NO_SESSION");
  assert.equal(server.calls.submit, 0);
});

await check("execuções simultâneas de sincronização não duplicam o envio", async () => {
  const { queue, server } = setup();
  await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] });
  const [a, b] = await Promise.all([queue.sync(ANA), queue.sync(ANA)]);
  assert.ok([a.outcome, b.outcome].includes("BUSY"), "a segunda execução é recusada enquanto a primeira roda");
  assert.equal(server.calls.submit, 1);
  assert.equal(server.records.size, 1);
});

await check("item interrompido (aba fechada no envio) volta a 'Salvo no aparelho' e depois sincroniza", async () => {
  const { queue, store, server } = setup();
  const item = await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [] });
  const stuck = { ...(await store.get(item.clientId)), status: "WAITING_SEND" };
  await store.put(stuck);
  assert.equal(await queue.recoverInterrupted(ANA), 1);
  assert.equal((await queue.listForUser(ANA))[0].status, "SAVED_ON_DEVICE");
  await queue.sync(ANA);
  assert.equal(server.records.size, 1);
});

await check("validação na gravação: tipo de arquivo, tamanho, limite de fotos e rascunho inválido", async () => {
  const { queue } = setup();
  await assert.rejects(queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("x", "a.gif", "image/gif")] }), /Formato não permitido/);
  await assert.rejects(queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [{ name: "v.jpg", mimeType: "image/jpeg", blob: new Blob([]) }] }), /vazia/);
  await assert.rejects(queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: Array.from({ length: 21 }, (_, i) => photo(`f${i}`)) }), /no máximo 20/);
  await assert.rejects(queue.save({ userId: ANA, projectId: P1, draft: draft({ description: "" }), photos: [] }), /Descreva/);
});

await check("falha ao gravar no aparelho (sem espaço) não deixa item parcial nem arquivos órfãos", async () => {
  const { queue, store } = setup();
  const original = store.put;
  store.put = async () => { throw new Error("QuotaExceededError: quota"); };
  await assert.rejects(queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] }), /Sem espaço/);
  store.put = original;
  assert.equal(store.records.size, 0);
  assert.equal(store.blobs.size, 0, "blob revertido");
});

await check("arquivo local desaparecido: falha permanente com orientação, sem enviar registro incompleto como sincronizado", async () => {
  const { queue, store, server } = setup();
  const item = await queue.save({ userId: ANA, projectId: P1, draft: draft(), photos: [photo("a")] });
  store.blobs.clear();
  await queue.sync(ANA);
  const failed = (await queue.listForUser(ANA))[0];
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.permanentError, true);
  assert.equal(server.photos.size, 0);
  assert.ok(item.clientId);
});

console.log(`\n${passed} OK, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
