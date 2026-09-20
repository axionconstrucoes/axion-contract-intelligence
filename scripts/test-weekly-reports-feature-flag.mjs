// Feature flag ACC_WEEKLY_REPORTS_ENABLED — trava de deployment das
// funcionalidades de relatórios semanais. Executa a função REAL da flag
// (ausente / "false" / "true" / valores inválidos), executa os scripts de
// produção com a flag desligada (precisam encerrar sem tocar em nada) e
// valida por leitura estática que TODOS os pontos de entrada novos
// (menu, aba, rotas, loaders, actions, scripts, workflow) passam pela
// mesma decisão e que as páginas antigas não dependem dela.
//
// Uso:
//   node scripts/test-weekly-reports-feature-flag.mjs

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { isWeeklyReportsEnabled, assertWeeklyReportsEnabled, WEEKLY_REPORTS_FLAG_NAME, WEEKLY_REPORTS_DISABLED_MESSAGE } = await import("../apps/web/lib/feature-flags/weekly-reports");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}
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

// Ambiente sem a flag (o runner pode tê-la definida).
const savedEnv = process.env[WEEKLY_REPORTS_FLAG_NAME];
delete process.env[WEEKLY_REPORTS_FLAG_NAME];

// ------------------------------------------------------------------
// 1. Função da flag (fail-closed)
// ------------------------------------------------------------------
await check("1. Flag ausente => desligada (default false)", () => {
  assert(WEEKLY_REPORTS_FLAG_NAME === "ACC_WEEKLY_REPORTS_ENABLED");
  assert(process.env[WEEKLY_REPORTS_FLAG_NAME] === undefined);
  assert(isWeeklyReportsEnabled() === false, "sem variável => false");
  assert(isWeeklyReportsEnabled(undefined) === false);
  let threw = null;
  try {
    assertWeeklyReportsEnabled();
  } catch (error) {
    threw = error;
  }
  assert(threw && threw.message === WEEKLY_REPORTS_DISABLED_MESSAGE, "assert lança a mensagem controlada");
});
await check('2. Flag "false" e valores inválidos => desligada ("", "1", "TRUE", "yes", " true ")', () => {
  for (const value of ["false", "", "1", "TRUE", "True", "yes", "on", " true ", "true\n", "enabled"]) {
    assert(isWeeklyReportsEnabled(value) === false, `valor ${JSON.stringify(value)} deve desligar`);
  }
  process.env[WEEKLY_REPORTS_FLAG_NAME] = "false";
  assert(isWeeklyReportsEnabled() === false);
  process.env[WEEKLY_REPORTS_FLAG_NAME] = "TRUE";
  assert(isWeeklyReportsEnabled() === false, "comparação é exata, sem normalização");
  delete process.env[WEEKLY_REPORTS_FLAG_NAME];
});
await check('3. Flag "true" (exata) => ligada; assert não lança', () => {
  assert(isWeeklyReportsEnabled("true") === true);
  process.env[WEEKLY_REPORTS_FLAG_NAME] = "true";
  assert(isWeeklyReportsEnabled() === true);
  assertWeeklyReportsEnabled();
  delete process.env[WEEKLY_REPORTS_FLAG_NAME];
  assert(isWeeklyReportsEnabled() === false, "voltou a desligar ao remover");
});
await check("4. Flag é server-only (nunca NEXT_PUBLIC_*) e não vaza para componentes client", () => {
  const flag = readSource("apps/web/lib/feature-flags/weekly-reports.ts");
  assert(!WEEKLY_REPORTS_FLAG_NAME.startsWith("NEXT_PUBLIC_") && !/process\.env\.NEXT_PUBLIC|"NEXT_PUBLIC_[A-Z_]+"/.test(flag), "nome não pode ser NEXT_PUBLIC_*");
  assert(!flag.includes('"use client"'));
  const clientFiles = [
    "apps/web/components/documents/email-registry/email-registry-panel.tsx",
    "apps/web/components/documents/email-registry/email-registry-review-forms.tsx",
    "apps/web/components/documents/email-registry/weekly-report-workbook-section.tsx",
    "apps/web/components/financial/financial-correction-form.tsx",
    "apps/web/components/financial/financial-series-chart.tsx",
    "apps/web/components/layout/app-sidebar.tsx",
  ];
  for (const file of clientFiles) assert(!readSource(file).includes("feature-flags/weekly-reports"), `${file} não deve ler a flag (decisão é do servidor)`);
});

// ------------------------------------------------------------------
// 2. Gating dos pontos de entrada (mesma decisão em todos)
// ------------------------------------------------------------------
await check("5. Menu: item Financeiro escondido sem a flag (layout não consulta acesso financeiro)", () => {
  const layout = readSource("apps/web/app/[projectId]/layout.tsx");
  assert(layout.includes("isWeeklyReportsEnabled() ? await canViewProjectFinancialDashboard({ projectId }) : false"), "layout curto-circuita a consulta");
  assert(layout.includes("hiddenHrefs"));
});
await check("6. Documentos: aba 'Registro por e-mail' e busca só com a flag; abas antigas intactas", () => {
  const page = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  assert(page.includes("const weeklyReportsEnabled = isWeeklyReportsEnabled();"));
  assert(/if \(weeklyReportsEnabled\) \{\s*try \{\s*registryPage = await searchEmailDocumentRegistry/.test(page), "busca SQL só dentro do if");
  assert(page.includes('{weeklyReportsEnabled ? (\n            <span className="inline-flex items-center gap-1">\n              <TabsTrigger value="registro-email">'), "trigger da aba condicionado");
  assert(page.includes('{weeklyReportsEnabled ? (\n          <TabsContent value="registro-email">'), "conteúdo da aba condicionado");
  assert(page.includes('...(weeklyReportsEnabled ? ["registro-email"] : [])'), "tab por URL cai em 'documentos' sem a flag");
  for (const tab of ["documentos", "clausulas", "cronograma", "anexos-email"]) {
    assert(page.includes(`<TabsTrigger value="${tab}">`), `aba ${tab} continua incondicional`);
  }
});
await check("7. Rotas novas: detalhe do e-mail e visualizador de anexo => 404; Financeiro => estado controlado", () => {
  const detail = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/page.tsx");
  assert(/const \{ projectId, emailId \} = await params;\s*if \(!isWeeklyReportsEnabled\(\)\) notFound\(\);/.test(detail), "detalhe: notFound antes de qualquer consulta");
  const viewer = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/anexos/[attachmentId]/page.tsx");
  assert(/await params;\s*if \(!isWeeklyReportsEnabled\(\)\) notFound\(\);\s*const supabase = await createSupabaseServerClient\(\);/.test(viewer), "viewer: notFound antes do client");
  const financeiro = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  const guard = financeiro.indexOf("if (!isWeeklyReportsEnabled())");
  const load = financeiro.indexOf("loadFinancialDashboard(projectId, query)");
  assert(guard > 0 && load > guard, "financeiro: guarda antes do loader");
  assert(financeiro.includes('data-testid="financial-feature-disabled"') && financeiro.includes("Funcionalidade indisponível neste ambiente."));
});
await check("8. Loaders recusam sem a flag (defesa em profundidade — nenhuma tabela nova consultada)", () => {
  const registry = readSource("apps/web/lib/email/registry/email-document-registry-data.ts");
  assert(/searchEmailDocumentRegistry\([^)]*\)[^{]*\{\s*assertWeeklyReportsEnabled\(\);/.test(registry), "search: assert primeiro");
  assert(/getEmailDocumentDetail\([^)]*\)[^{]*\{\s*if \(!isWeeklyReportsEnabled\(\)\) return null;/.test(registry), "detail: null primeiro");
  const financial = readSource("apps/web/lib/financial/financial-dashboard-data.ts");
  assert(/loadFinancialDashboard\([^)]*\)[^{]*\{\s*assertWeeklyReportsEnabled\(\);/.test(financial), "financeiro: assert primeiro");
});
await check("9. Server actions recusam sem a flag (registro/revisão/baseline/abas e correção financeira)", () => {
  const registryActions = readSource("apps/web/app/[projectId]/documentos/emails/actions.ts");
  assert(/async function requireUser\([^)]*\) \{\s*assertWeeklyReportsEnabled\(\);/.test(registryActions), "requireUser (comum às 5 actions) assert primeiro");
  const exported = [...registryActions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert(exported.length === 5, `5 actions exportadas (${exported.length})`);
  for (const name of exported) {
    const body = registryActions.slice(registryActions.indexOf(`export async function ${name}`));
    assert(body.slice(0, 600).includes("await requireUser(supabase);"), `${name} passa por requireUser`);
  }
  const financialActions = readSource("apps/web/app/[projectId]/financeiro/actions.ts");
  assert(/try \{\s*assertWeeklyReportsEnabled\(\);/.test(financialActions), "correção financeira assert primeiro");
});
await check("10. Usuários: nota do escalão de Planejamento só com a flag; matriz em si inalterada", () => {
  const page = readSource("apps/web/app/[projectId]/usuarios/page.tsx");
  assert(page.includes("{isWeeklyReportsEnabled() ? (() => {") && page.includes("})() : null}"));
  assert(page.includes("weekly-schedule-planning-tiers"));
  assert(page.includes("getSlaAreaResponsibles"), "matriz continua carregada normalmente");
});

// ------------------------------------------------------------------
// 3. Worker / scripts / workflow
// ------------------------------------------------------------------
function runScript(relative, args, env) {
  return spawnSync(process.execPath, [path.join(repoRoot, relative), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}
await check("11. Worker encerra (código 0) sem a flag e sem tocar no banco — sem credenciais Supabase", () => {
  const env = { [WEEKLY_REPORTS_FLAG_NAME]: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" };
  const absent = runScript("scripts/weekly-schedule-email-ingest.mjs", ["--apply"], env);
  assert(absent.status === 0, `exit ${absent.status}: ${absent.stderr}`);
  assert(absent.stdout.includes("funcionalidade desativada"), absent.stdout);
  const off = runScript("scripts/weekly-schedule-email-ingest.mjs", ["--apply"], { ...env, [WEEKLY_REPORTS_FLAG_NAME]: "false" });
  assert(off.status === 0 && off.stdout.includes("funcionalidade desativada"));
  const source = readSource("scripts/weekly-schedule-email-ingest.mjs");
  const guard = source.indexOf("if (!isWeeklyReportsEnabled())");
  const firstStoreImport = source.indexOf("ingest-weekly-schedule-email");
  const createClient = source.indexOf("createClient(");
  assert(guard > 0 && guard < firstStoreImport && guard < createClient, "guarda antes dos imports de negócio e do client");
});
await check("12. Script de configuração encerra (código 0) sem a flag — sem gravar", () => {
  const env = { [WEEKLY_REPORTS_FLAG_NAME]: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" };
  const result = runScript("scripts/configure-weekly-schedule-ingestion.mjs", ["00000000-0000-4000-8000-000000000000", "--client-domains=example.test", "--apply"], env);
  assert(result.status === 0, `exit ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("nada gravado"));
});
await check('13. Com a flag "true" o worker segue adiante (falha só por falta de credenciais, não pela flag)', () => {
  const result = runScript("scripts/weekly-schedule-email-ingest.mjs", ["--apply"], { [WEEKLY_REPORTS_FLAG_NAME]: "true", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" });
  assert(!result.stdout.includes("funcionalidade desativada"), "não pode parar pela flag");
  assert(result.status !== 0 && /Missing environment variable|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SECRET_KEY|supabaseUrl/i.test(`${result.stderr}${result.stdout}`), `esperava falha por credenciais: ${result.stderr.slice(0, 300)}`);
});
await check("14. Workflow: job condicionado à variável de repositório e a repassa ao script", () => {
  const workflow = readSource(".github/workflows/weekly-schedule-email-ingestion.yml");
  assert(workflow.includes("if: ${{ vars.ACC_WEEKLY_REPORTS_ENABLED == 'true' }}"), "job com if");
  assert(workflow.includes("ACC_WEEKLY_REPORTS_ENABLED: ${{ vars.ACC_WEEKLY_REPORTS_ENABLED }}"), "env repassada");
  assert(!workflow.includes("secrets.ACC_WEEKLY_REPORTS_ENABLED"), "flag é variável, não segredo");
});

// ------------------------------------------------------------------
// 4. Configuração / documentação / páginas antigas
// ------------------------------------------------------------------
await check("15. Chave documentada em .env.example (server-only, fail-closed) e na documentação", () => {
  const example = readSource("apps/web/.env.example");
  assert(example.includes("# ACC_WEEKLY_REPORTS_ENABLED=false") && example.includes("somente o valor EXATO \"true\" habilita"));
  assert(!/^ACC_WEEKLY_REPORTS_ENABLED=/m.test(example), "exemplo fica comentado (nunca ligado por padrão)");
  const docs = readSource("docs/weekly-schedule-email-ingestion.md");
  assert(docs.includes("## 0. Feature flag `ACC_WEEKLY_REPORTS_ENABLED`") && docs.includes("Fail-closed"));
});
await check("16. Páginas antigas não dependem da flag (Documentos/Cronograma/Experts/Jurídico/SLA continuam iguais)", () => {
  const untouched = [
    "apps/web/app/[projectId]/cronograma/page.tsx",
    "apps/web/app/[projectId]/juridico/page.tsx",
    "apps/web/app/[projectId]/experts/page.tsx",
    "apps/web/app/[projectId]/page.tsx",
    "apps/web/app/[projectId]/ledger/page.tsx",
  ];
  for (const file of untouched) {
    let source;
    try {
      source = readSource(file);
    } catch {
      continue; // rota inexistente neste layout — nada a verificar
    }
    assert(!source.includes("feature-flags/weekly-reports"), `${file} não deve depender da flag`);
    assert(!/weekly_report_|weekly_schedule_|email_document_review/.test(source), `${file} não consulta tabelas novas`);
  }
  const nav = readSource("apps/web/lib/ui/nav-items.ts");
  assert(!nav.includes("feature-flags"), "NAV_ITEMS continua estático; o layout decide a visibilidade");
});

if (savedEnv !== undefined) process.env[WEEKLY_REPORTS_FLAG_NAME] = savedEnv;

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
