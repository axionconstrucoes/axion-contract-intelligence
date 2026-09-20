// Rotas TÉCNICAS que o proxy de autenticação (apps/web/proxy.ts) deixa
// chegar ao próprio handler sem sessão de usuário — chamadas sem cookie
// pelo agendador da Vercel ou pelo workflow GitHub. Caminhos EXATOS,
// nunca prefixo: /api/cron/<outra-coisa> e subcaminhos continuam exigindo
// sessão. Cada handler listado aqui autentica sozinho por
// `Authorization: Bearer CRON_SECRET` (lib/cron/cron-request-auth.ts) e
// falha fechado quando o segredo não está configurado. Puro, sem
// "server-only", para ser testável por script Node.

export const PUBLIC_CRON_ROUTES: ReadonlySet<string> = new Set([
  "/api/cron/weekly-alert-digest",
  "/api/cron/system-health",
  "/api/cron/risk-alerts",
]);

/** true somente para um caminho exatamente igual a uma rota técnica listada (sem normalização de barras/case). */
export function isPublicCronRoute(pathname: string): boolean {
  return PUBLIC_CRON_ROUTES.has(pathname);
}
