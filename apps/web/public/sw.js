/* ACC SSMA/ESG — service worker.
 *
 * O QUE ELE GUARDA (e só isto):
 *   - a "casca" offline do app de campo (/ssma/offline): uma página que NÃO contém dados de obra —
 *     ela lê tudo do IndexedDB do próprio aparelho, por usuário;
 *   - arquivos estáticos versionados (/_next/static/*, ícones/logo): públicos, sem dados de ninguém.
 * O QUE ELE NUNCA GUARDA: páginas autenticadas com dados (obra, contrato, registros), respostas de
 * API/RPC, Storage, cookies ou tokens. Qualquer outra requisição passa direto pela rede.
 *
 * Fora de linha: uma NAVEGAÇÃO para /ssma* que falhar na rede recebe a casca offline. Dados e fotos
 * criados offline ficam na fila do IndexedDB (ver lib/ssma/field-records) e são enviados depois.
 *
 * Atualização: mude VERSION para invalidar caches antigos (activate remove os de outras versões).
 */
const VERSION = "acc-ssma-v2";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_URL = "/ssma/offline";
const STATIC_PRECACHE = ["/branding/acc-logo.png", "/branding/acc-icon-192.png", "/branding/acc-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(STATIC_PRECACHE.map((url) => cache.add(url)));
      try {
        // A casca exige sessão (como qualquer página do ACC). Se o usuário ainda não entrou, o
        // pré-cache dela é ignorado e refeito na próxima visita ao app de campo.
        const response = await fetch(SHELL_URL, { credentials: "same-origin", redirect: "manual" });
        if (response.ok && response.type !== "opaqueredirect") {
          const html = await response.clone().text();
          await cache.put(SHELL_URL, response);
          const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+\.(?:js|css|woff2?)/g) ?? []);
          await Promise.allSettled([...assets].map((url) => cache.add(url)));
        }
      } catch {
        /* sem rede na instalação: a casca será guardada numa próxima instalação */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("acc-ssma-") && key !== STATIC_CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Arquivos estáticos versionados: cache primeiro (o nome muda a cada build).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) void cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Navegação dentro do app de campo: rede primeiro; sem rede, a casca offline (sem dados).
  if (request.mode === "navigate" && (url.pathname === "/ssma" || url.pathname.startsWith("/ssma/"))) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(SHELL_URL)) ?? new Response("Sem conexão e o app ainda não foi preparado para uso offline. Abra o app de campo uma vez com internet.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      })
    );
  }
  // Todo o resto: sem respondWith — o navegador segue o caminho normal (nada é guardado).
});
