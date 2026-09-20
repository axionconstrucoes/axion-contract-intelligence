// Rotas técnicas de cron × proxy de autenticação — 16 itens.
// O proxy (apps/web/proxy.ts) deixa chegar ao handler, sem sessão, SÓ os
// caminhos exatos de lib/cron/public-cron-routes.ts; cada handler
// autentica por Authorization: Bearer CRON_SECRET (lib/cron/
// cron-request-auth.ts) e falha fechado sem segredo configurado.
// Executa as funções REAIS (puras); handlers validados por leitura
// estática (importam módulos server-only). Nenhuma chamada de rede,
// e-mail ou workflow.
//
// Uso:
//   node scripts/test-cron-routes-proxy-auth.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { isPublicCronRoute, PUBLIC_CRON_ROUTES } = await import("../apps/web/lib/cron/public-cron-routes");
const { isCronRequestAuthorized } = await import("../apps/web/lib/cron/cron-request-auth");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n?/g, "\n");

const ROUTES = {
  digest: "apps/web/app/api/cron/weekly-alert-digest/route.ts",
  health: "apps/web/app/api/cron/system-health/route.ts",
  risk: "apps/web/app/api/cron/risk-alerts/route.ts",
};
const proxy = readSource("apps/web/proxy.ts");
const cronAuth = readSource("apps/web/lib/cron/cron-request-auth.ts");
const SECRET = "segredo-de-teste-nao-real-0123456789";
const req = (headers = {}, url = "https://acc.example.test/api/cron/risk-alerts") => new Request(url, { headers });

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}
function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

console.log("");
console.log("ROTAS DE CRON × PROXY — TESTES");
console.log("==============================");
console.log("");

check("1. /api/cron/weekly-alert-digest é rota técnica pública no proxy", () => {
  assert(isPublicCronRoute("/api/cron/weekly-alert-digest") === true);
  assert(proxy.includes("isPublicCronRoute(request.nextUrl.pathname)"), "proxy usa a allowlist");
});
check("2. /api/cron/system-health é rota técnica pública no proxy", () => {
  assert(isPublicCronRoute("/api/cron/system-health") === true);
});
check("3. /api/cron/risk-alerts é rota técnica pública no proxy", () => {
  assert(isPublicCronRoute("/api/cron/risk-alerts") === true);
  assert(PUBLIC_CRON_ROUTES.size === 3, "exatamente as três rotas");
});
check("4. /api/cron/risk-alerts/x não é pública (nem variações de barra/case/query)", () => {
  for (const p of ["/api/cron/risk-alerts/x", "/api/cron/risk-alerts/", "/API/cron/risk-alerts", "/api/cron/risk-alerts?secret=x", "/api/cron/risk-alertsx", "/x/api/cron/risk-alerts"]) {
    assert(isPublicCronRoute(p) === false, p);
  }
});
check("5. /api/cron/system-health/x não é pública", () => {
  assert(isPublicCronRoute("/api/cron/system-health/x") === false && isPublicCronRoute("/api/cron/system-health/") === false);
});
check("6. /api/cron/outro não é pública; proxy não libera o prefixo /api/cron", () => {
  assert(isPublicCronRoute("/api/cron/outro") === false && isPublicCronRoute("/api/cron") === false && isPublicCronRoute("/api/cron/") === false);
  assert(!/startsWith\(\s*["']\/api\/cron/.test(proxy) && !/["']\/api\/cron["']|["']\/api\/cron\/["']/.test(proxy), "sem prefixo no proxy");
  const allow = readSource("apps/web/lib/cron/public-cron-routes.ts");
  assert(!/startsWith|includes\(|RegExp|match\(/.test(allow.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")) && allow.includes("PUBLIC_CRON_ROUTES.has(pathname)"), "comparação exata por Set");
});
check("7. Rota comum sem sessão continua redirecionando para /login com ?next= preservado", () => {
  assert(proxy.includes('request.nextUrl.pathname === "/login"') && proxy.includes('request.nextUrl.pathname === "/auth/callback"'));
  assert(proxy.includes("if (!isPublicRoute && !data?.claims) {") && proxy.includes('redirectUrl.pathname = "/login";') && proxy.includes('redirectUrl.searchParams.set("next", originalPath)'));
  assert(!proxy.includes("email-actions") && !proxy.includes('"/projetos"'), "demais rotas continuam protegidas");
  assert(!isPublicCronRoute("/projetos") && !isPublicCronRoute("/") && !isPublicCronRoute("/email-actions/abc"));
});
check("8. risk-alerts sem Authorization => 401", () => {
  assert(isCronRequestAuthorized(req(), SECRET) === false);
  const src = readSource(ROUTES.risk);
  assert(src.includes("if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {") && src.includes('{ status: 401 }'));
});
check("9. risk-alerts com Bearer incorreto => 401 (inclui prefixo correto com sufixo, esquema errado e espaços)", () => {
  assert(isCronRequestAuthorized(req({ authorization: "Bearer errado" }), SECRET) === false);
  assert(isCronRequestAuthorized(req({ authorization: `Bearer ${SECRET}x` }), SECRET) === false);
  assert(isCronRequestAuthorized(req({ authorization: `Basic ${SECRET}` }), SECRET) === false);
  assert(isCronRequestAuthorized(req({ authorization: `Bearer  ${SECRET}` }), SECRET) === false);
  assert(isCronRequestAuthorized(req({ authorization: `Bearer ${SECRET}` }), SECRET) === true, "controle positivo");
});
check("10. risk-alerts com segredo somente na query string => 401", () => {
  assert(isCronRequestAuthorized(req({}, `https://acc.example.test/api/cron/risk-alerts?secret=${SECRET}&token=${SECRET}&authorization=Bearer%20${SECRET}`), SECRET) === false);
  assert(!/searchParams|nextUrl|URL\(/.test(cronAuth), "helper nem lê a URL");
  assert(!/searchParams\.get\(["'](secret|token|key|authorization)["']\)/.test(readSource(ROUTES.risk) + readSource(ROUTES.health) + readSource(ROUTES.digest)));
});
check("11. risk-alerts com CRON_SECRET ausente/vazio => 401 mesmo com header 'correto'", () => {
  assert(isCronRequestAuthorized(req({ authorization: "Bearer " }), undefined) === false);
  assert(isCronRequestAuthorized(req({ authorization: "Bearer " }), "") === false);
  assert(isCronRequestAuthorized(req({ authorization: "Bearer    " }), "   ") === false);
  assert(isCronRequestAuthorized(req({ authorization: "Bearer undefined" }), undefined) === false);
  assert(cronAuth.includes("if (!expectedSecret) return false;"));
});
check("12. system-health: mesmos requisitos fail-closed (helper compartilhado; só GET; nada antes da autenticação)", () => {
  const src = readSource(ROUTES.health);
  assert(src.includes("if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {"));
  assert(src.indexOf("isCronRequestAuthorized(") < src.indexOf("createSupabaseAdminClient()"), "autenticação antes de qualquer acesso");
  assert(!/export async function (POST|PUT|PATCH|DELETE)/.test(src), "só GET");
  assert(!/console\./.test(src), "não registra header/segredo");
});
check("13. weekly-alert-digest continua fail-closed (helper compartilhado; só GET; nada antes da autenticação)", () => {
  const src = readSource(ROUTES.digest);
  assert(src.includes("if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {"));
  assert(src.indexOf("isCronRequestAuthorized(") < src.indexOf("runWeeklyAlertDigests()"));
  assert(!/export async function (POST|PUT|PATCH|DELETE)/.test(src) && !/console\./.test(src));
});
check("14. Segredos não aparecem em logs, URL, saída ou mensagens de erro", () => {
  for (const [name, file] of Object.entries(ROUTES)) {
    const src = readSource(file);
    assert(!/console\.(log|warn|error|info)\([^\n]*(authorization|CRON_SECRET|secret)/i.test(src), `${name}: sem log de header/segredo`);
    assert(!/error:\s*[`"'][^`"'\n]*\$\{[^}]*(secret|authorization)/i.test(src), `${name}: mensagem de erro sem segredo`);
    assert(src.includes('error: "Não autorizado."'), `${name}: 401 genérico`);
  }
  assert(!/console\./.test(cronAuth) && !/throw new Error\([^)]*(presented|expected|secret)/.test(cronAuth));
  const workflow = readSource(".github/workflows/weekly-schedule-email-ingestion.yml");
  assert(workflow.includes('-H "Authorization: Bearer ${CRON_SECRET}"') && !/api\/cron\/risk-alerts[^"\n]*(secret|token|CRON)/i.test(workflow));
});
check("15. risk-alerts com feature desligada => 204 antes do banco, mas só depois da autenticação válida", () => {
  const src = readSource(ROUTES.risk);
  const auth = src.indexOf("isCronRequestAuthorized(");
  const flag = src.indexOf("if (!isWeeklyReportsEnabled()) {");
  const run = src.indexOf("runRiskAlertCycle(");
  assert(auth > 0 && auth < flag && flag < run && src.includes("return new Response(null, { status: 204 });"));
  assert(readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts").includes("if (!featureEnabled) return result; // nenhuma consulta ao banco"));
});
check("16. Nenhuma chamada real, e-mail ou workflow executado por este teste", () => {
  assert(!process.env.CRON_SECRET && !process.env.GITHUB_ACTIONS && process.env.ACC_WEEKLY_REPORTS_ENABLED !== "true");
  assert(!/fetch\(|https?:\/\//.test(cronAuth + readSource("apps/web/lib/cron/public-cron-routes.ts")), "módulos puros sem rede");
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
