// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// Monta o link absoluto para abrir uma Ação/Escalonamento no ACC
// (/[projectId]/acoes?actionId=...) — mesmo espírito de
// apps/web/lib/email/build-respond-to-acc-url.ts, mas apontando para a
// tela "Ações e Escalonamentos" em vez do Ledger.

export function buildSlaActionUrl(baseUrl: string, projectId: string, actionId: string): string {
  const url = new URL(`/${projectId}/acoes`, baseUrl);
  url.searchParams.set("actionId", actionId);
  url.hash = `acao-${actionId}`;
  return url.toString();
}

// Link "RESPONDER AO ACC" para uma ação — mesma metadata/âncora usada
// para eventos, mas com actionId em vez de eventId.
export function buildSlaActionRespondUrl(baseUrl: string, projectId: string, actionId: string): string {
  const url = new URL(`/${projectId}/acoes`, baseUrl);
  url.searchParams.set("actionId", actionId);
  url.searchParams.set("respond", "acc");
  url.hash = "responder-ao-acc";
  return url.toString();
}
