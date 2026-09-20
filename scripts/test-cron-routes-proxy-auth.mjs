// Rotas técnicas de cron × proxy de autenticação — 24 itens.
// O proxy (apps/web/proxy.ts) deixa chegar ao handler, sem sessão, SÓ os
// caminhos exatos de lib/cron/public-cron-routes.ts; cada handler
// autentica por Authorization: Bearer (lib/cron/cron-request-auth.ts) —
// CRON_SECRET nos crons Vercel, ACC_RISK_ALERTS_CRON_SECRET (dedicado)
// em risk-alerts — e falha fechado sem segredo configurado.
// Executa as funções REAIS (puras); handlers validados por leitura
// estática (importam módulos server-only). Nenhuma chamada de rede,
// e-mail ou workflow.
//
// Uso:
//   node scripts/test-cron-routes-proxy-auth.mjs

import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { isPublicCronRoute, PUBLIC_CRON_ROUTES } = await import("../apps/web/lib/cron/public-cron-routes");
const { isCronRequestAuthorized, RISK_ALERTS_CRON_SECRET_ENV } = await import("../apps/web/lib/cron/cron-request-auth");

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
  assert(src.includes("if (!isCronRequestAuthorized(request, process.env[RISK_ALERTS_CRON_SECRET_ENV])) {") && src.includes('{ status: 401 }'));
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
check("11. risk-alerts com segredo dedicado ausente/vazio => 401 mesmo com header 'correto'", () => {
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
  assert(workflow.includes('-H "Authorization: Bearer ${ACC_RISK_ALERTS_CRON_SECRET}"') && !/api\/cron\/risk-alerts[^"\n]*(secret|token|CRON)/i.test(workflow));
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
  assert(!process.env.CRON_SECRET && !process.env.ACC_RISK_ALERTS_CRON_SECRET && !process.env.GITHUB_ACTIONS && process.env.ACC_WEEKLY_REPORTS_ENABLED !== "true");
  assert(!/fetch\(|https?:\/\//.test(cronAuth + readSource("apps/web/lib/cron/public-cron-routes.ts")), "módulos puros sem rede");
});

// ------------------------------------------------------------------
// Auditoria SYSTEM nos três fluxos cron: a constraint viva de
// audit_log_entries (20260819195713, nunca alterada depois) exige, para
// actor_type = 'SYSTEM', actor_user_id IS NULL e actor_label IS NULL.
// ------------------------------------------------------------------
const CRON_AUDIT_WRITERS = [
  ROUTES.health,
  ROUTES.digest,
  ROUTES.risk,
  "apps/web/lib/email/send-system-health-alert-email.ts",
  "apps/web/lib/email/run-weekly-alert-digests.ts",
  "apps/web/lib/email/send-weekly-alert-digest-email.ts",
  "apps/web/lib/risk-alerts/run-risk-alert-cycle.ts",
  "apps/web/lib/risk-alerts/supabase-store.ts",
];
// Blocos de INSERT em audit_log_entries: do "audit_log_entries" até o fechamento do objeto.
function auditInsertBlocks(source) {
  const blocks = [];
  const re = /from\("audit_log_entries"\)\s*\.insert\(/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      if (source[i] === ")") depth -= 1;
      if (depth === 0) break;
    }
    blocks.push(source.slice(m.index, i + 1));
  }
  return blocks;
}
check("17. Constraint vigente: SYSTEM => actor_user_id IS NULL e actor_label IS NULL (não relaxada por migration posterior)", () => {
  const foundation = readSource("supabase/migrations/20260819195713_audit_foundation.sql");
  assert(/actor_type = 'SYSTEM'\s*\n\s*and actor_user_id is null\s*\n\s*and actor_label is null/.test(foundation));
  const later = readdirSync(path.join(repoRoot, "supabase/migrations")).filter((f) => f > "20260819195713" && f.endsWith(".sql"));
  for (const f of later) {
    const src = readSource(`supabase/migrations/${f}`);
    assert(!/alter table public\.audit_log_entries\s+drop constraint/i.test(src), `${f} não pode relaxar a constraint`);
  }
});
check("18. system-health grava auditoria SYSTEM com actor_user_id null e actor_label null (correção); demais campos preservados", () => {
  const src = readSource(ROUTES.health);
  const blocks = auditInsertBlocks(src);
  assert(blocks.length === 1, `esperado 1 insert de auditoria, obtidos ${blocks.length}`);
  const b = blocks[0];
  assert(b.includes('actor_type: "SYSTEM"') && b.includes("actor_user_id: null") && b.includes("actor_label: null"));
  assert(!/actor_label:\s*["'`]/.test(b), "label textual removido");
  assert(b.includes('entity_type: "PROJECT_INTEGRATION"') && b.includes("SYSTEM_HEALTH_ALERT_SENT") && b.includes("SYSTEM_HEALTH_ALERT_FAILED") && b.includes("project_id: row.project_id"), "event/entity/projeto intocados");
  assert(src.includes("fingerprint") && src.includes("ADMIN_RECIPIENTS") && src.includes("acc_system_health_incidents"), "lógica do health check intocada");
});
check("19. Nenhuma gravação SYSTEM dos três fluxos cron (handlers + serviços diretos) usa actor_label não nulo; RPCs da migration idem", () => {
  let systemInserts = 0;
  for (const file of CRON_AUDIT_WRITERS) {
    for (const block of auditInsertBlocks(readSource(file))) {
      if (!block.includes('actor_type: "SYSTEM"')) continue;
      systemInserts += 1;
      assert(block.includes("actor_label: null"), `${file}: actor_label deve ser null em SYSTEM`);
      assert(block.includes("actor_user_id: null"), `${file}: actor_user_id deve ser null em SYSTEM`);
    }
  }
  assert(systemInserts >= 3, `inserts SYSTEM auditados: ${systemInserts}`);
  const migration = readSource("supabase/migrations/20260921090000_pilot_risk_alert_delivery.sql");
  assert(migration.includes("v_action.project_id, 'SYSTEM', null, null,"), "RPC de escalonamento: SYSTEM sem label");
  assert(migration.includes("case when v_actor is null then 'SYSTEM' else 'USER' end, v_actor, null,"), "RPC de ação: label sempre null");
  // Proxy e Bearer inalterados por esta correção.
  assert(proxy.includes("isPublicCronRoute(request.nextUrl.pathname)") && readSource(ROUTES.health).includes("if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {"));
});

// ------------------------------------------------------------------
// Segredo DEDICADO do piloto: risk-alerts aceita exclusivamente
// ACC_RISK_ALERTS_CRON_SECRET; digest e system-health seguem com CRON_SECRET.
// ------------------------------------------------------------------
const DEDICATED = "segredo-dedicado-de-teste-nao-real-9876543210";
const SHARED = "cron-secret-de-teste-nao-real-0011223344";
const riskRoute = readSource(ROUTES.risk);
// Simula o que o handler faz: lê SOMENTE process.env[RISK_ALERTS_CRON_SECRET_ENV].
const riskAuth = (request, env) => isCronRequestAuthorized(request, env[RISK_ALERTS_CRON_SECRET_ENV]);
check("20. Segredo dedicado correto alcança o handler (autorização passa; próximo passo é a flag)", () => {
  assert(RISK_ALERTS_CRON_SECRET_ENV === "ACC_RISK_ALERTS_CRON_SECRET");
  assert(riskAuth(req({ authorization: `Bearer ${DEDICATED}` }), { ACC_RISK_ALERTS_CRON_SECRET: DEDICATED, CRON_SECRET: SHARED }) === true);
  assert(riskRoute.includes("process.env[RISK_ALERTS_CRON_SECRET_ENV]") && !riskRoute.includes("process.env.CRON_SECRET"), "handler lê só o segredo dedicado");
  assert(riskRoute.indexOf("isCronRequestAuthorized(") < riskRoute.indexOf("if (!isWeeklyReportsEnabled()) {"));
});
check("21. CRON_SECRET correto, sem o dedicado, retorna 401 (sem fallback)", () => {
  assert(riskAuth(req({ authorization: `Bearer ${SHARED}` }), { CRON_SECRET: SHARED }) === false, "dedicado ausente => 401 mesmo com CRON_SECRET válido");
  assert(riskAuth(req({ authorization: `Bearer ${SHARED}` }), { CRON_SECRET: SHARED, ACC_RISK_ALERTS_CRON_SECRET: DEDICATED }) === false, "CRON_SECRET nunca autentica risk-alerts");
  assert(!/CRON_SECRET\s*\?\?|\?\?\s*process\.env\.CRON_SECRET|\|\|\s*process\.env\.CRON_SECRET/.test(riskRoute), "sem fallback no código");
});
check("22. Segredo dedicado ausente/vazio/incorreto retorna 401", () => {
  assert(riskAuth(req({ authorization: `Bearer ${DEDICATED}` }), {}) === false);
  assert(riskAuth(req({ authorization: `Bearer ${DEDICATED}` }), { ACC_RISK_ALERTS_CRON_SECRET: "" }) === false);
  assert(riskAuth(req({ authorization: `Bearer ${DEDICATED}` }), { ACC_RISK_ALERTS_CRON_SECRET: "   " }) === false);
  assert(riskAuth(req({ authorization: `Bearer ${DEDICATED}x` }), { ACC_RISK_ALERTS_CRON_SECRET: DEDICATED }) === false);
  assert(riskAuth(req(), { ACC_RISK_ALERTS_CRON_SECRET: DEDICATED }) === false);
});
check("23. Query string com o segredo dedicado retorna 401; segredo não aparece em URL/log/erro", () => {
  assert(riskAuth(req({}, `https://acc.example.test/api/cron/risk-alerts?ACC_RISK_ALERTS_CRON_SECRET=${DEDICATED}&secret=${DEDICATED}`), { ACC_RISK_ALERTS_CRON_SECRET: DEDICATED }) === false);
  assert(!/console\./.test(riskRoute) && riskRoute.includes('error: "Não autorizado."'));
  const step = readSource(".github/workflows/weekly-schedule-email-ingestion.yml").split("  risk-alerts:")[1];
  assert(step.includes("ACC_RISK_ALERTS_CRON_SECRET: ${{ secrets.ACC_RISK_ALERTS_CRON_SECRET }}") && step.includes('-H "Authorization: Bearer ${ACC_RISK_ALERTS_CRON_SECRET}"'));
  assert(!step.includes("secrets.CRON_SECRET") && !/echo[^\n]*\$\{?ACC_RISK_ALERTS_CRON_SECRET/.test(step) && !/api\/cron\/risk-alerts[^"\n]*(secret|token|CRON)/i.test(step));
});
check("24. Feature desligada + segredo dedicado correto => 204 antes do banco; digest e system-health continuam com CRON_SECRET", () => {
  assert(riskRoute.includes("return new Response(null, { status: 204 });") && riskRoute.indexOf("if (!isWeeklyReportsEnabled()) {") < riskRoute.indexOf("runRiskAlertCycle("));
  assert(readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts").includes("if (!featureEnabled) return result; // nenhuma consulta ao banco"));
  for (const file of [ROUTES.digest, ROUTES.health]) {
    const src = readSource(file);
    assert(src.includes("if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {") && !src.includes("ACC_RISK_ALERTS_CRON_SECRET"), `${file} mantém CRON_SECRET`);
  }
  assert(isCronRequestAuthorized(req({ authorization: `Bearer ${SHARED}` }), SHARED) === true && isCronRequestAuthorized(req({ authorization: `Bearer ${DEDICATED}` }), SHARED) === false);
  assert(!/process\.env\.\w*CRON_SECRET|ACC_RISK_ALERTS_CRON_SECRET/.test(proxy), "proxy inalterado (não lê segredo algum)");
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
