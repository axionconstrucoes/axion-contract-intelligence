/* ACC SSMA/ESG — service worker mínimo para instalação.
 * Dados autenticados e formulários NÃO são armazenados em cache neste
 * estágio, evitando persistir informações contratuais/SSMA no cache do
 * navegador antes da política offline ser aprovada. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
