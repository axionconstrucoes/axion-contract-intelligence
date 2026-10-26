// public/sw.js REAL em um Chrome real, contra um servidor FALSO (nada do ACC/Supabase):
//  - a casca /ssma/offline e seus arquivos estáticos são guardados;
//  - páginas com dados e respostas de API NUNCA são guardadas;
//  - sem rede, uma navegação para /ssma/... recebe a casca; outras páginas falham normalmente.
//
// Limites: Chrome headless no computador; NÃO valida Safari/iOS nem Android. Não prova que a casca
// real do Next (hidratação, chunks) abre offline — isso exige o app autenticado em ambiente de teste.
// Uso: node scripts/test-ssma-service-worker.mjs   (CHROME_PATH opcional)

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withChrome } from "./lib/cdp-chrome.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(path.join(here, "..", "apps", "web", "public", "sw.js"), "utf8");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!existsSync(chromePath)) {
  console.log("PULADO: Chrome não encontrado (defina CHROME_PATH).");
  process.exit(0);
}

const hits = [];
const html = (body) => `<!doctype html><meta charset="utf-8"><title>t</title>${body}`;
const http = createServer((req, res) => {
  hits.push(req.url);
  const send = (type, body, status = 200) => { res.writeHead(status, { "content-type": type }); res.end(body); };
  if (req.url === "/sw.js") return send("text/javascript", swSource);
  if (req.url === "/ssma/offline") return send("text/html", html('<h1 id="shell">CASCA OFFLINE</h1><script src="/_next/static/chunks/shell.js"></script>'));
  if (req.url === "/_next/static/chunks/shell.js") return send("text/javascript", "window.SHELL_JS=1;");
  if (req.url === "/_next/static/chunks/other.js") return send("text/javascript", "window.OTHER_JS=1;");
  if (req.url === "/branding/acc-logo.png" || req.url.startsWith("/branding/acc-icon")) return send("image/png", "png");
  if (req.url.startsWith("/ssma/p1")) return send("text/html", html('<h1 id="secret">DADOS DA OBRA p1</h1><script>navigator.serviceWorker.register("/sw.js")</script>'));
  if (req.url === "/api/dados") return send("application/json", '{"segredo":"x"}');
  if (req.url === "/start") return send("text/html", html('<h1>start</h1><script>navigator.serviceWorker.register("/sw.js")</script>'));
  return send("text/plain", "nf", 404);
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

console.log("\n======================================\nSSMA — SERVICE WORKER em Chrome real\n======================================");
try {
  await withChrome(async (c) => {
    await c.goto(`${origin}/start`, 1500);
    await c.eval(`navigator.serviceWorker.ready.then(() => true)`);
    await new Promise((r) => setTimeout(r, 1200));
    const cached = () => c.eval(`(async () => { const out = []; for (const key of await caches.keys()) { const cache = await caches.open(key); for (const req of await cache.keys()) out.push(new URL(req.url).pathname); } return out.sort(); })()`);

    await check("instalação guarda a casca offline e seus arquivos estáticos (e nada mais)", async () => {
      const list = await cached();
      ok(list.includes("/ssma/offline"), "casca");
      ok(list.includes("/_next/static/chunks/shell.js"), "arquivo estático da casca");
      ok(list.every((u) => u === "/ssma/offline" || u.startsWith("/_next/static/") || u.startsWith("/branding/")), `só casca/estáticos: ${list.join(", ")}`);
    });

    await check("página com dados e API passam pela rede e NÃO entram no cache", async () => {
      await c.goto(`${origin}/ssma/p1`, 1200);
      await c.eval(`fetch("/api/dados").then((r) => r.text())`);
      const list = await cached();
      ok(!list.includes("/ssma/p1"), "página com dados guardada!");
      ok(!list.includes("/api/dados"), "API guardada!");
    });

    await check("arquivo estático novo é guardado ao ser buscado (cache primeiro depois)", async () => {
      await c.eval(`fetch("/_next/static/chunks/other.js").then((r) => r.text())`);
      await new Promise((r) => setTimeout(r, 300));
      ok((await cached()).includes("/_next/static/chunks/other.js"), "estático não guardado");
    });

    await check("sem rede: navegação para /ssma/... recebe a casca; página com dados não é servida do cache", async () => {
      // O CDP não corta a rede do service worker (alvo separado); por isso o "sem rede" aqui é o
      // servidor realmente fora do ar — o fetch do worker falha de verdade.
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
      await c.goto(`${origin}/ssma/p1`, 1500);
      eq(await c.eval(`document.getElementById("shell") ? "shell" : document.getElementById("secret") ? "DADOS" : document.body.innerText.slice(0, 60)`), "shell", "conteúdo offline");
      eq(await c.eval(`window.SHELL_JS === 1`), true, "script da casca servido do cache");
    });

    await check("sem rede: rota fora de /ssma não é interceptada e falha normalmente", async () => {
      const result = await c.eval(`fetch("/api/dados").then(() => "respondeu").catch(() => "falhou")`);
      eq(result, "falhou", "API offline");
    });
  });
} finally {
  if (http.listening) http.close();
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
console.log(`\n${passed} OK, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
