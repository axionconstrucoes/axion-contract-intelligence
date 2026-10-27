// Fila offline SSMA em um Chrome REAL: IndexedDB de verdade (persistência entre recarregamentos),
// Blob/crypto.subtle reais e rede realmente cortada (CDP Network.emulateNetworkConditions).
// O servidor é FALSO (um http local mínimo); nenhum Supabase, nenhum dado real.
//
// Limites: é Chrome headless no computador — NÃO prova o comportamento em iPhone/Safari nem em
// Android. Pula (exit 0) com aviso se o Chrome não for encontrado.
//
// Uso: node scripts/test-ssma-offline-browser.mjs   (CHROME_PATH opcional)

import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { withChrome } from "./lib/cdp-chrome.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require("typescript");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!existsSync(chromePath)) {
  console.log("PULADO: Chrome não encontrado (defina CHROME_PATH). Este teste exige um navegador real.");
  process.exit(0);
}

// 1) Transpila os módulos reais (TS → ESM) para um diretório temporário servido por http.
const out = mkdtempSync(path.join(tmpdir(), "ssma-browser-"));
const srcDir = path.join(here, "..", "apps", "web", "lib", "ssma", "field-records");
for (const file of ["types", "queue-core", "idb-store"]) {
  const source = readFileSync(path.join(srcDir, `${file}.ts`), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from "\.\/(types|queue-core)"/g, 'from "./$1.js"');
  writeFileSync(path.join(out, `${file}.js`), js);
}
mkdirSync(path.join(out, "x"), { recursive: true });
writeFileSync(path.join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>ssma offline test</title>
<script type="module">
import { createFieldQueue, TransportError } from "./queue-core.js";
import { createIdbStore, openOfflineDb } from "./idb-store.js";
const hashBlob = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
// Transporte de teste: fetch REAL para o servidor local falso. Sem rede, fetch lança TypeError → NETWORK.
let sessionUser = "u-ana";
async function call(pathname, body) {
  try {
    const r = await fetch(pathname, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) throw new TransportError("SERVER", "x", (await r.json()).code ?? null);
    return r.json();
  } catch (e) {
    if (e instanceof TransportError) throw e;
    throw new TransportError("NETWORK", "offline");
  }
}
const transport = {
  currentUserId: async () => (await call("/api/me", {})).userId ?? sessionUser,
  submitRecord: (item) => call("/api/submit", { id: item.clientId, user: sessionUser, createdAt: item.clientCreatedAt, itemUser: item.userId }),
  uploadPhoto: (item, photo, blob) => call("/api/upload", { id: photo.id, size: blob.size }),
  registerPhoto: (item, photo) => call("/api/register", { id: photo.id }),
};
const db = await openOfflineDb();
const store = createIdbStore(db);
const queue = createFieldQueue({ store, transport, hashBlob });
window.T = { queue, store, setUser: (u) => (sessionUser = u) };
window.READY = true;
</script>`);

// 2) Servidor FALSO, idempotente.
const server = { records: new Map(), photos: new Set(), uploads: new Set(), calls: [], user: "u-ana" };
const http = createServer((req, res) => {
  if (req.method === "GET") {
    const file = path.join(out, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    if (existsSync(file) && !file.endsWith(path.sep)) {
      res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
      return res.end(readFileSync(file));
    }
    res.writeHead(404);
    return res.end();
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const reply = (status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    server.calls.push(req.url);
    if (req.url === "/api/me") return reply(200, { userId: server.user });
    if (req.url === "/api/submit") {
      if (body.itemUser !== server.user) return reply(403, { code: "USER_MISMATCH" });
      if (!server.records.has(body.id)) server.records.set(body.id, body.createdAt);
      return reply(200, {});
    }
    if (req.url === "/api/upload") { server.uploads.add(body.id); return reply(200, {}); }
    if (req.url === "/api/register") { server.photos.add(body.id); return reply(200, {}); }
    return reply(404, {});
  });
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${http.address().port}`;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); passed += 1; }
  catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); failed += 1; }
}
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };

console.log("\n======================================\nSSMA — FILA OFFLINE em Chrome real (IndexedDB)\n======================================");
try {
  await withChrome(async (c) => {
    const load = async () => { await c.goto(`${origin}/`, 700); for (let i = 0; i < 40 && !(await c.eval("window.READY === true")); i += 1) await new Promise((r) => setTimeout(r, 100)); };
    await load();
    const draft = `{ kind: "OCORRENCIA", category: "Condição insegura", description: "Fio exposto", location: "Pav. 2", occurredAt: new Date(Date.now() - 3600e3).toISOString(), risk: "ALTA", responsibleUserId: null, dueDate: null }`;

    await check("sem rede (corte real): registra com fotos e fica 'Salvo no aparelho'", async () => {
      await c.setOffline(true);
      const result = await c.eval(`(async () => {
        const mk = (t) => new Blob([t.repeat(2000)], { type: "image/jpeg" });
        const item = await T.queue.save({ userId: "u-ana", projectId: "p-1", draft: ${draft}, photos: [{ name: "a.jpg", mimeType: "image/jpeg", blob: mk("a") }, { name: "b.jpg", mimeType: "image/jpeg", blob: mk("b") }] });
        const report = await T.queue.sync("u-ana");
        const listed = await T.queue.listForUser("u-ana");
        return { id: item.clientId, report: report.outcome, status: listed[0].status, photos: listed[0].photos.length };
      })()`);
      eq([result.report, result.status, result.photos], ["OFFLINE", "SAVED_ON_DEVICE", 2], "estado offline");
      eq(server.records.size, 0, "nada chegou ao servidor");
    });

    await check("persiste ao recarregar a página (IndexedDB real), com as fotos", async () => {
      await c.setOffline(false);
      await load();
      const state = await c.eval(`(async () => {
        const listed = await T.queue.listForUser("u-ana");
        const blob = await T.store.getBlob(listed[0].clientId + ":" + listed[0].photos[0].id);
        return { count: listed.length, status: listed[0].status, blobSize: blob ? blob.size : -1, createdAt: listed[0].clientCreatedAt };
      })()`);
      eq([state.count, state.status, state.blobSize], [1, "SAVED_ON_DEVICE", 2000], "após recarregar");
    });

    await check("isolamento no IndexedDB: outra conta não lista nem vê o conteúdo", async () => {
      const state = await c.eval(`(async () => ({ others: (await T.queue.listForUser("u-bruno")).length, foreign: await T.queue.foreignPendingCount("u-bruno") }))()`);
      eq([state.others, state.foreign], [0, 1], "isolamento");
    });

    await check("troca de conta: sessão de outro usuário não envia o registro de Ana", async () => {
      server.user = "u-bruno";
      const r = await c.eval(`T.queue.sync("u-ana").then((x) => x.outcome)`);
      eq(r, "BLOCKED_USER_MISMATCH", "bloqueio");
      eq(server.records.size, 0, "servidor não recebeu nada");
      server.user = "u-ana";
    });

    await check("reconexão: sincroniza uma vez, horário real preservado, arquivos locais liberados", async () => {
      const before = await c.eval(`T.queue.listForUser("u-ana").then((l) => ({ id: l[0].clientId, createdAt: l[0].clientCreatedAt }))`);
      const report = await c.eval(`T.queue.sync("u-ana")`);
      eq([report.outcome, report.synced, report.failed], ["DONE", 1, 0], "sync");
      const after = await c.eval(`(async () => { const l = await T.queue.listForUser("u-ana"); const k = l[0].clientId + ":" + l[0].photos[0].id; return { status: l[0].status, blob: await T.store.getBlob(k) }; })()`);
      eq(after.status, "SYNCED", "status");
      eq(after.blob, null, "blob removido");
      eq(server.records.get(before.id), before.createdAt, "horário real preservado");
      eq([server.uploads.size, server.photos.size], [2, 2], "fotos no servidor");
    });

    await check("reenvio não duplica (servidor idempotente + fila não reenvia sincronizados)", async () => {
      await c.eval(`T.queue.sync("u-ana")`);
      eq([server.records.size, server.uploads.size], [1, 2], "sem duplicar");
    });

    await check("descartar remove registro e arquivos do aparelho", async () => {
      const gone = await c.eval(`(async () => { const l = await T.queue.listForUser("u-ana"); const ok = await T.queue.discard("u-ana", l[0].clientId); return { ok, left: (await T.queue.listForUser("u-ana")).length }; })()`);
      eq([gone.ok, gone.left], [true, 0], "descarte");
    });
  });
} finally {
  http.close();
}
console.log(`\n${passed} OK, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
