// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone
// (mesmo padrão de apps/web/lib/sla/build-action-url.ts e
// apps/web/lib/email/build-respond-to-acc-url.ts).
//
// Único ponto que sabe montar a URL de uma ação de e-mail — os três
// fluxos existentes (contract-alert-template.ts, sla-escalation-template.ts,
// action-request-notification) chamam esta função, nunca constroem a URL
// inline. baseUrl vem sempre de getAppBaseUrl() (apps/web/lib/app-base-url.ts,
// já existente) — nunca inventado aqui.
export function buildEmailActionUrl(baseUrl: string, rawToken: string): string {
  const url = new URL(`/email-actions/${encodeURIComponent(rawToken)}`, baseUrl);
  return url.toString();
}
