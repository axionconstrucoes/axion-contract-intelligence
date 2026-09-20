// Dashboard FINANCEIRO — 32 itens obrigatórios + paridade TS × SQL da regra
// de acesso (3b/3c). Executa as funções REAIS
// (acesso, seleção de versão, cards, gráficos, tabela, comparação semanal,
// cruzamento Curva S × MPP, parser BR) sobre dados no formato persistido
// em weekly_report_sheets (category FINANCEIRO) e valida por leitura
// estática a rota, o menu, a RLS/RPC e a ausência de hardcode.
//
// Uso:
//   node scripts/test-financial-dashboard.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

register("./ts-module-resolver.mjs", import.meta.url);

const { evaluateFinancialDashboardAccess, evaluateFinancialEditAccess, FINANCIAL_DASHBOARD_ROLES, FINANCIAL_DASHBOARD_AREAS } = await import("../apps/web/lib/financial/access");
const { normalizeProjectPermission, hasProjectEditPermission, PROJECT_EDIT_ROLES } = await import("../apps/web/lib/users/project-permission");
const {
  rankFinancialVersions,
  selectFinancialVersion,
  selectPreviousValidVersion,
  buildFinancialCards,
  buildFinancialCharts,
  buildFinancialTable,
  compareFinancialSheets,
  crossCheckFinancial,
  deviationSeriesOf,
} = await import("../apps/web/lib/financial/build-financial-dashboard");
const { formatAmount, formatPercentBR, formatDateBR, detectCurrencySymbol, NOT_AVAILABLE } = await import("../apps/web/lib/financial/format-br");
const { toNumericValue } = await import("../apps/web/lib/schedule/s-curve/detect-s-curve");
const { readWorkbookSafely } = await import("../apps/web/lib/schedule/weekly-report/read-workbook");
const { processWorkbookGrids } = await import("../apps/web/lib/schedule/weekly-report/process-workbook");
const { routeSheetToExpert } = await import("../apps/web/lib/schedule/weekly-report/analyze-sheets");
const { NAV_ITEMS } = await import("../apps/web/lib/ui/nav-items");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");
const MIGRATION = "supabase/migrations/20260920120000_weekly_schedule_email_ingestion_foundation.sql";

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

const PROJECT = "11111111-1111-4111-8111-111111111111";

function snapshot(overrides = {}) {
  return {
    sheetId: "sheet-37",
    workbookId: "wb-37",
    projectId: PROJECT,
    emailId: "email-37",
    emailAttachmentId: "att-37",
    messageId: "gmail-37",
    emailSentAt: "2026-09-16T14:00:00Z",
    fileName: "RS_W37.xlsx",
    fileSha256: "a".repeat(64),
    workWeekNumber: 37,
    workWeekLabel: "W37",
    cutoffDate: "2026-09-17",
    sheetStatus: "EXTRACTED",
    workbookStatus: "EXTRACTED",
    confidence: 0.9,
    originalSheetName: "Financeiro",
    sheetIndex: 2,
    locator: { file: "RS_W37.xlsx", sheet: "Financeiro", sheetIndex: 2, headerRow: 1, range: "A1:F4", columns: { previsto: "B", realizado: "C" } },
    extractionMethod: "xlsx-stored-values-v1",
    extractedAt: "2026-09-16T15:00:00Z",
    data: {
      unit: "CURRENCY",
      columns: { previsto: "Previsto (R$)", realizado: "Realizado (R$)", acumulado_previsto: "Acumulado previsto (R$)", acumulado_realizado: "Acumulado realizado (R$)", faturado: "Faturado (R$)", recebido: "Recebido (R$)" },
      headers: ["Período", "Previsto (R$)", "Realizado (R$)", "Acumulado previsto (R$)", "Acumulado realizado (R$)", "Faturado (R$)", "Recebido (R$)"],
      rows: [
        { period: "2026-09-04", date: "2026-09-04", values: { previsto: 100000, realizado: 90000, acumulado_previsto: 1200000, acumulado_realizado: 1100000, faturado: 95000, recebido: 90000 } },
        { period: "2026-09-11", date: "2026-09-11", values: { previsto: 100000, realizado: 95000, acumulado_previsto: 1300000, acumulado_realizado: 1195000, faturado: 90000, recebido: 40000 } },
        { period: "2026-09-17", date: "2026-09-17", values: { previsto: 100000, realizado: 80000, acumulado_previsto: 1400000, acumulado_realizado: 1275000, faturado: 85000, recebido: null } },
      ],
    },
    metrics: { trend: "WORSENING", plannedTotal: 1400000, actualTotal: 1275000 },
    alerts: [],
    expertId: "commercial-director",
    humanCorrected: false,
    validatedAt: null,
    ...overrides,
  };
}
const previousSnapshot = snapshot({
  sheetId: "sheet-36",
  workbookId: "wb-36",
  emailId: "email-36",
  emailAttachmentId: "att-36",
  emailSentAt: "2026-09-09T14:00:00Z",
  fileName: "RS_W36.xlsx",
  fileSha256: "b".repeat(64),
  workWeekNumber: 36,
  workWeekLabel: "W36",
  cutoffDate: "2026-09-11",
  data: {
    unit: "CURRENCY",
    columns: { previsto: "Previsto (R$)", realizado: "Realizado (R$)", acumulado_previsto: "Acumulado previsto (R$)", acumulado_realizado: "Acumulado realizado (R$)" },
    headers: ["Período", "Previsto (R$)", "Realizado (R$)"],
    rows: [
      { period: "2026-09-04", date: "2026-09-04", values: { previsto: 100000, realizado: 92000, acumulado_previsto: 1200000, acumulado_realizado: 1102000 } },
      { period: "2026-09-11", date: "2026-09-11", values: { previsto: 100000, realizado: 95000, acumulado_previsto: 1300000, acumulado_realizado: 1197000 } },
    ],
  },
});
const resend37 = snapshot({ sheetId: "sheet-37b", workbookId: "wb-37b", emailId: "email-37b", emailAttachmentId: "att-37b", emailSentAt: "2026-09-16T10:00:00Z", fileSha256: "c".repeat(64) });

// ------------------------------------------------------------------
// ACESSO (1–3)
// ------------------------------------------------------------------
await check("1. Item FINANCEIRO aparece para autorizado (ADMINISTRADOR/GERENTE ou áreas DIRETORIA/FINANCEIRO)", () => {
  assert(evaluateFinancialDashboardAccess({ permission: "ADMINISTRADOR", status: "ACTIVE", area: "ENGENHARIA" }).allowed);
  assert(evaluateFinancialDashboardAccess({ permission: "GERENTE", status: "ACTIVE", area: null }).allowed);
  assert(evaluateFinancialDashboardAccess({ permission: "LEITURA", status: "ACTIVE", area: "FINANCEIRO" }).allowed);
  assert(evaluateFinancialDashboardAccess({ permission: "COLABORADOR", status: "ACTIVE", area: "DIRETORIA" }).allowed);
  const item = NAV_ITEMS.find((entry) => entry.href === "financeiro");
  assert(item && item.label === "Financeiro" && item.restrictedTo === "financial" && item.icon === "Wallet" && item.helpId === "financeiro");
  const layout = readSource("apps/web/app/[projectId]/layout.tsx");
  assert(layout.includes("canViewProjectFinancialDashboard") && layout.includes("hiddenHrefs"), "layout decide visibilidade server-side");
});

await check("2. Não aparece para não autorizado (COLABORADOR/LEITURA de outras áreas — inclusive COMERCIAL —, INACTIVE, sem membership)", () => {
  assert(!evaluateFinancialDashboardAccess({ permission: "COLABORADOR", status: "ACTIVE", area: "ENGENHARIA" }).allowed);
  assert(!evaluateFinancialDashboardAccess({ permission: "LEITURA", status: "ACTIVE", area: "PLANEJAMENTO" }).allowed);
  assert(!evaluateFinancialDashboardAccess({ permission: "COLABORADOR", status: "ACTIVE", area: "COMERCIAL" }).allowed, "COMERCIAL não dá acesso financeiro");
  assert(!evaluateFinancialDashboardAccess({ permission: "LEITURA", status: "ACTIVE", area: "COMERCIAL" }).allowed);
  assert(!evaluateFinancialDashboardAccess({ permission: "GERENTE", status: "INACTIVE", area: "FINANCEIRO" }).allowed);
  assert(!evaluateFinancialDashboardAccess({ permission: "EDITOR", status: "ACTIVE", area: "FINANCEIRO" }).allowed, "papel fora do modelo nunca é aceito");
  assert(!evaluateFinancialDashboardAccess({ permission: "ADMINISTRADOR", status: "INACTIVE", area: "FINANCEIRO" }).allowed);
  assert(!evaluateFinancialDashboardAccess({ permission: null, status: null, area: null }).allowed);
  const sidebar = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(sidebar.includes("hiddenHrefs.includes(item.href)") && sidebar.includes("visibleItems.map"), "sidebar filtra pela lista do layout");
});

await check("3. Rota bloqueia acesso direto não autorizado (página, loader, action, RLS e RPC)", () => {
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes("if (!model.access)") && page.includes("financial-access-denied"));
  const loader = readSource("apps/web/lib/financial/financial-dashboard-data.ts");
  assert(loader.includes("getProjectFinancialAccess") && loader.includes("if (!financialAccess.canView) return { access: false }"));
  const actions = readSource("apps/web/app/[projectId]/financeiro/actions.ts");
  assert(actions.includes("getProjectFinancialAccess") && actions.includes("if (!financialAccess.canEdit)") && actions.includes("createSupabaseServerClient") && !actions.includes("createSupabaseAdminClient"));
  const sql = readSource(MIGRATION);
  assert(sql.includes("create or replace function public.can_view_project_financial_dashboard") && sql.includes("(category <> 'FINANCEIRO' or public.can_view_project_financial_dashboard(project_id))"), "RLS restringe a aba FINANCEIRO");
  assert(sql.includes("create or replace function public.can_edit_project_financial_data"), "função SQL de correção existe");
  assert(sql.includes("if v_row.category = 'FINANCEIRO' and not public.can_edit_project_financial_data(v_row.project_id)"), "RPC de validação exige permissão de correção financeira");
  assert(!/'EDITOR'/.test(sql), "migration não usa papel EDITOR (fora do modelo)");
  assert(!/has_project_permission\([^)]*,\s*'(GESTOR|GERENTE|COLABORADOR|LEITURA)'\)/.test(sql), "RPCs usam can_manage_project_documents, não níveis mínimos ambíguos");
  assert(JSON.stringify(FINANCIAL_DASHBOARD_ROLES) === JSON.stringify(["ADMINISTRADOR", "GERENTE"]) && JSON.stringify(FINANCIAL_DASHBOARD_AREAS) === JSON.stringify(["DIRETORIA", "FINANCEIRO"]));
});

// Paridade TS × SQL: a expressão SQL é lida da migration e avaliada em JS
// sobre a MESMA tabela-verdade (papel × área × status) usada pela função TS.
const ROLES = ["ADMINISTRADOR", "GERENTE", "GESTOR", "COLABORADOR", "LEITURA", null];
const AREAS = ["DIRETORIA", "FINANCEIRO", "COMERCIAL", "PLANEJAMENTO", "ENGENHARIA", "SUPRIMENTOS", null];
const STATUSES = ["ACTIVE", "INACTIVE"];
function parseSqlList(text) {
  return [...text.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}
function sqlViewRule(sql) {
  const fn = sql.slice(sql.indexOf("create or replace function public.can_view_project_financial_dashboard"), sql.indexOf("create or replace function public.can_edit_project_financial_data"));
  const roles = parseSqlList(fn.match(/pm\.permission in \(([^)]*)\)/)[1]);
  const areas = parseSqlList(fn.match(/pm\.area in \(([^)]*)\)/)[1]);
  assert(fn.includes("pm.status = 'ACTIVE'") && fn.includes("pm.user_id = auth.uid()"), "SQL exige ACTIVE e o próprio usuário");
  return (m) => m.status === "ACTIVE" && m.permission !== null && (roles.includes(m.permission) || (m.area !== null && areas.includes(m.area)));
}
function sqlManageRule() {
  const compat = readSource("supabase/migrations/20260829200000_project_permission_gerente_compat.sql");
  const fn = compat.slice(compat.indexOf("create or replace function public.can_manage_project_documents"));
  const roles = parseSqlList(fn.match(/pm\.permission in \(([^)]*)\)/)[1]);
  assert(fn.slice(0, 800).includes("pm.status = 'ACTIVE'"));
  return (m) => m.status === "ACTIVE" && roles.includes(m.permission);
}
await check("3b. Paridade TS × SQL — VISUALIZAR (tabela-verdade completa papel × área × status)", () => {
  const sql = readSource(MIGRATION);
  const sqlView = sqlViewRule(sql);
  let cases = 0;
  for (const permission of ROLES) for (const area of AREAS) for (const status of STATUSES) {
    const m = { permission, area, status };
    const ts = evaluateFinancialDashboardAccess(m).allowed;
    assert(ts === sqlView(m), `divergência VIEW em ${JSON.stringify(m)}: TS=${ts} SQL=${sqlView(m)}`);
    cases += 1;
  }
  assert(cases === ROLES.length * AREAS.length * STATUSES.length);
  // Valor legado: GESTOR se comporta exatamente como GERENTE nos dois lados.
  assert(normalizeProjectPermission("GESTOR") === "GERENTE" && normalizeProjectPermission("GERENTE") === "GERENTE" && normalizeProjectPermission("EDITOR") === null);
  assert(evaluateFinancialDashboardAccess({ permission: "GESTOR", status: "ACTIVE", area: "ENGENHARIA" }).allowed === sqlView({ permission: "GESTOR", status: "ACTIVE", area: "ENGENHARIA" }));
  // GESTOR não é oferecido na UI (só via helper único de compatibilidade).
  const access = readSource("apps/web/lib/financial/access.ts");
  assert(!/"GESTOR"/.test(access), "access.ts não conhece o valor legado");
  const files = ["apps/web/app/[projectId]/financeiro/page.tsx", "apps/web/app/[projectId]/financeiro/actions.ts", "apps/web/lib/financial/financial-dashboard-data.ts", "apps/web/lib/financial/access-server.ts", "apps/web/components/financial/financial-correction-form.tsx"];
  for (const file of files) assert(!/GESTOR|EDITOR/.test(readSource(file)), `${file} não deve citar GESTOR/EDITOR`);
});
await check("3c. Paridade TS × SQL — CORRIGIR (visualizar E can_manage_project_documents; LEITURA/COLABORADOR nunca)", () => {
  const sql = readSource(MIGRATION);
  const sqlView = sqlViewRule(sql);
  const sqlManage = sqlManageRule();
  const editFn = sql.slice(sql.indexOf("create or replace function public.can_edit_project_financial_data"));
  assert(editFn.slice(0, 600).includes("public.can_view_project_financial_dashboard(p_project_id)") && editFn.slice(0, 600).includes("and public.can_manage_project_documents(p_project_id)"), "SQL: editar = visualizar AND permissão de edição existente");
  const sqlEdit = (m) => sqlView(m) && sqlManage(m);
  for (const permission of ROLES) for (const area of AREAS) for (const status of STATUSES) {
    const m = { permission, area, status };
    const ts = evaluateFinancialEditAccess(m).allowed;
    assert(ts === sqlEdit(m), `divergência EDIT em ${JSON.stringify(m)}: TS=${ts} SQL=${sqlEdit(m)}`);
    if (ts) assert(evaluateFinancialDashboardAccess(m).allowed, "quem edita sempre visualiza");
    if (permission === "LEITURA" || permission === "COLABORADOR") assert(!ts, `${permission} nunca corrige`);
  }
  assert(JSON.stringify(PROJECT_EDIT_ROLES) === JSON.stringify(["ADMINISTRADOR", "GERENTE"]));
  assert(hasProjectEditPermission("GESTOR") && hasProjectEditPermission("GERENTE") && !hasProjectEditPermission("COLABORADOR") && !hasProjectEditPermission("LEITURA") && !hasProjectEditPermission(null));
  // Loader entrega canEdit e a página não recalcula papel por conta própria.
  const loader = readSource("apps/web/lib/financial/financial-dashboard-data.ts");
  assert(loader.includes("canEdit: financialAccess.canEdit"), "loader expõe canEdit da regra única");
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes("canEdit } = model") && !page.includes('permission === "'), "página usa canEdit do loader");
  const detail = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/page.tsx");
  assert(detail.includes("hasProjectEditPermission(permission)"), "detalhe do e-mail usa o helper único de edição");
});

// ------------------------------------------------------------------
// FONTE / SELEÇÃO (4–9)
// ------------------------------------------------------------------
await check("4. Loader respeita project_id (filtro explícito) e usa client de sessão", () => {
  const loader = readSource("apps/web/lib/financial/financial-dashboard-data.ts");
  assert(loader.includes('.eq("project_id", projectId)') && loader.includes('from("weekly_report_sheets")'));
});
await check("5. Usa somente category FINANCEIRO (nunca PDF, nunca outra aba como financeira)", () => {
  const loader = readSource("apps/web/lib/financial/financial-dashboard-data.ts");
  assert(loader.includes('.eq("category", "FINANCEIRO")'));
  assert(!/pdf|document_extractions/i.test(loader.replace(/\/\/.*$/gm, "")), "sem PDF/texto extraído como fonte");
  assert(loader.includes('sheet.category === "CURVA_S"'), "Curva S só para cruzamento (do mesmo workbook)");
});
await check("6. Seleciona a versão válida mais recente (semana maior; dentro da semana, e-mail mais recente)", () => {
  const all = [previousSnapshot, resend37, snapshot()];
  const selected = selectFinancialVersion(all, {});
  assert(selected.workbookId === "wb-37", selected.workbookId);
  const pending = snapshot({ workbookId: "wb-38", sheetId: "s38", workWeekNumber: 38, workWeekLabel: "W38", sheetStatus: "PENDING_HUMAN_REVIEW", emailSentAt: "2026-09-23T14:00:00Z" });
  assert(selectFinancialVersion([...all, pending], {}).workbookId === "wb-37", "versão pendente não é 'válida'");
});
await check("7. Permite selecionar semana anterior e versão específica", () => {
  const all = [previousSnapshot, resend37, snapshot()];
  assert(selectFinancialVersion(all, { workWeekNumber: 36 }).workbookId === "wb-36");
  assert(selectFinancialVersion(all, { workbookId: "wb-37b" }).workbookId === "wb-37b");
  assert(selectPreviousValidVersion(all, snapshot()).workbookId === "wb-36", "anterior = semana anterior válida");
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes('name="semana"') && page.includes('name="versao"') && page.includes('name="de"') && page.includes('name="serie"'));
});
await check("8. Não soma acumulados entre semanas (acumulado vem da coluna da própria aba)", () => {
  const cards = buildFinancialCards(snapshot());
  const acum = cards.find((card) => card.key === "realizado_acumulado");
  assert(acum.value === 1275000 && acum.scope === "CUMULATIVE", JSON.stringify(acum));
  const builder = readSource("apps/web/lib/financial/build-financial-dashboard.ts");
  assert(!/previous[\s\S]{0,80}\+\s*current|acumulado_realizado\)\s*\+/.test(builder), "nunca soma acumulado do anterior");
});
await check("9. Não duplica versões da mesma semana (só a mais recente é válida; a outra é 'substituída')", () => {
  const ranked = rankFinancialVersions([previousSnapshot, resend37, snapshot()]);
  const week37 = ranked.filter((v) => v.workWeekLabel === "W37");
  assert(week37.length === 2 && week37.filter((v) => v.isLatestOfWeek).length === 1 && week37.find((v) => v.workbookId === "wb-37b").superseded === true);
  assert(selectPreviousValidVersion([previousSnapshot, resend37, snapshot()], snapshot()).workbookId !== "wb-37b", "reenvio da mesma semana nunca é 'anterior'");
});

// ------------------------------------------------------------------
// CARDS (10–16)
// ------------------------------------------------------------------
const cards = buildFinancialCards(snapshot());
const card = (key) => cards.find((item) => item.key === key);
await check("10. Card mostra previsto correto (período de corte: 100.000; acumulado 1.400.000)", () => {
  assert(card("previsto_periodo").value === 100000 && card("previsto_periodo").scope === "PERIOD");
  assert(card("previsto_acumulado").value === 1400000);
});
await check("11. Card mostra realizado correto (80.000 no período; 1.275.000 acumulado)", () => {
  assert(card("realizado_periodo").value === 80000 && card("realizado_acumulado").value === 1275000);
});
await check("12. Desvio absoluto correto (período −20.000; acumulado −125.000)", () => {
  assert(card("desvio_periodo").value === -20000 && card("desvio_acumulado").value === -125000);
});
await check("13. Desvio percentual / cumprimento correto (1.275.000 ÷ 1.400.000 = 91,07%)", () => {
  assert(card("cumprimento").value === 91.07 && card("cumprimento").unit === "PERCENT");
  const table = buildFinancialTable(snapshot());
  const last = table.rows[2];
  assert(last.deviationAbsolute === -20000 && last.deviationPercent === -20, JSON.stringify(last));
});
await check("14. Percentual não é moeda (unidades distintas por card; formatação separada)", () => {
  assert(card("previsto_periodo").unit === "CURRENCY" && card("cumprimento").unit === "PERCENT");
  assert(formatAmount(1234567.89, "R$") === "R$ 1.234.567,89" && formatPercentBR(12.5) === "12,50%");
  const percentSheet = snapshot({ data: { ...snapshot().data, unit: "PERCENT" } });
  assert(buildFinancialCards(percentSheet).every((item) => item.key === "cumprimento" || item.key === "margem" || item.unit === "PERCENT"));
});
await check("15. Ausência não vira zero (sem coluna => sem card; formatação => 'Dado não disponível')", () => {
  assert(!card("custo") && !card("receita") && !card("medido") && !card("resultado") && !card("margem"));
  assert(formatAmount(null, "R$") === NOT_AVAILABLE && formatPercentBR(undefined) === NOT_AVAILABLE && formatDateBR(null) === NOT_AVAILABLE);
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes("NOT_AVAILABLE") && !page.includes("?? 0"), "página nunca substitui ausência por 0");
  const empty = buildFinancialCards(snapshot({ data: {} }));
  assert(empty.length === 0);
});
await check("16. Margem/resultado só com custo e receita compatíveis (mesma aba e moeda)", () => {
  const withCosts = snapshot({
    data: { unit: "CURRENCY", columns: { custo: "Custo (R$)", receita: "Receita (R$)" }, headers: ["Período", "Custo (R$)", "Receita (R$)"], rows: [{ period: "W36", date: null, values: { custo: 80000, receita: 100000 } }, { period: "W37", date: null, values: { custo: 90000, receita: 120000 } }] },
  });
  const c = buildFinancialCards(withCosts);
  assert(c.find((i) => i.key === "resultado").value === 50000 && c.find((i) => i.key === "margem").value === 22.73, JSON.stringify(c));
  const onlyCost = buildFinancialCards(snapshot({ data: { ...withCosts.data, columns: { custo: "Custo" }, rows: withCosts.data.rows.map((row) => ({ ...row, values: { custo: row.values.custo } })) } }));
  assert(!onlyCost.find((i) => i.key === "resultado") && !onlyCost.find((i) => i.key === "margem"));
  const percentUnit = buildFinancialCards(snapshot({ data: { ...withCosts.data, unit: "PERCENT" } }));
  assert(!percentUnit.find((i) => i.key === "resultado"), "sem moeda compatível não calcula resultado");
});

// ------------------------------------------------------------------
// GRÁFICOS / FORMATOS (17–20)
// ------------------------------------------------------------------
await check("17. Gráfico não mistura unidades e não liga pontos desconhecidos como zero", () => {
  const charts = buildFinancialCharts(snapshot(), { previousDeviationSeries: deviationSeriesOf(previousSnapshot, "W36") });
  const keys = charts.map((chart) => chart.key);
  assert(keys.includes("previsto_realizado") && keys.includes("acumulados") && keys.includes("medido_faturado_recebido") && keys.includes("desvio_periodo") && keys.includes("evolucao_desvio") && !keys.includes("receita_custo"), keys.join(","));
  assert(charts.every((chart) => chart.unit === "CURRENCY"), "todas as séries da aba em moeda");
  const mfr = charts.find((chart) => chart.key === "medido_faturado_recebido");
  const recebido = mfr.series.find((series) => series.key === "recebido");
  assert(recebido.points[2].value === null, "ponto ausente permanece null");
  const component = readSource("apps/web/components/financial/financial-series-chart.tsx");
  assert(component.includes("point.value === null") && component.includes("segments") && component.includes("<title>") && component.includes("aria-label") && component.includes("Fonte:"), "gaps, tooltip, acessibilidade e fonte");
  assert(!component.includes("recharts") && !readSource("apps/web/package.json").includes("recharts"), "sem biblioteca nova");
});
await check("18. Valores brasileiros são interpretados corretamente", () => {
  assert(toNumericValue("R$ 1.234.567,89") === 1234567.89 && toNumericValue("1.234.567,89") === 1234567.89 && toNumericValue("12,50%") === 12.5 && toNumericValue("1.234") === 1234 && toNumericValue("0,42") === 0.42);
  assert(toNumericValue("1,234,567.89") === 1234567.89, "formato internacional também");
  assert(formatDateBR("2026-09-17") === "17/09/2026");
  assert(toNumericValue("") === null && toNumericValue("abc") === null);
});
await check("19. Negativos entre parênteses e com sinal são interpretados", () => {
  assert(toNumericValue("(1.234,56)") === -1234.56 && toNumericValue("-1.234,56") === -1234.56 && toNumericValue("(R$ 500,00)") === -500);
});
await check("20. Fórmula sem cached gera revisão (não disponível, nunca zero)", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Financeiro");
  sheet.addRow(["Período", "Previsto (R$)", "Realizado (R$)"]);
  sheet.addRow(["2026-09-04", 100000, 90000]);
  sheet.addRow(["2026-09-11", 100000, { formula: "C2+5000" }]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const reading = await readWorkbookSafely({ buffer, fileName: "f.xlsx", mimeType: "application/vnd.ms-excel" });
  const result = processWorkbookGrids(reading, { fileName: "f.xlsx", workWeekLabel: "W37", thresholds: [], mppFacts: null, officialBaseline: null, previousDeviationPp: null, previousBaselineSheet: null, criticalActivityCount: null, humanDecisions: {} });
  const fin = result.sheets.find((item) => item.category === "FINANCEIRO");
  assert(fin.data.rows[1].values.realizado === null, "célula com fórmula sem cached => null");
  assert(fin.alerts.some((alert) => /sem valor armazenado/.test(alert.detail)) && reading.safety.formulasWithoutCachedValue === 1);
  assert(fin.riskClassification === "REVIEW_REQUIRED", "sem limites => REVIEW_REQUIRED");
  const table = buildFinancialTable({ ...snapshot(), data: fin.data });
  assert(table.rows[1].deviationAbsolute === null, "desvio não calculado com valor indisponível");
});

// ------------------------------------------------------------------
// COMPARAÇÃO / CRUZAMENTO (21–23)
// ------------------------------------------------------------------
await check("21. Comparação semanal detecta alteração retroativa, redução de realizado, novo período e mudança de acumulado", () => {
  const changes = compareFinancialSheets(snapshot(), previousSnapshot);
  const codes = changes.map((change) => change.code);
  assert(codes.includes("ACTUAL_REDUCED"), `realizado de 2026-09-04 caiu de 92.000 para 90.000: ${codes}`);
  assert(codes.includes("RETROACTIVE_CHANGE") || codes.includes("CUMULATIVE_CHANGED"), "acumulado de período anterior ao corte anterior alterado");
  assert(codes.includes("NEW_PERIOD"), "2026-09-17 é novo");
  const reduced = changes.find((change) => change.code === "ACTUAL_REDUCED");
  assert(reduced.previousValue === 92000 && reduced.currentValue === 90000 && reduced.difference === -2000 && reduced.classification === "REVIEW_REQUIRED" && reduced.previousSource.includes("W36") && reduced.currentSource.includes("W37"));
  assert(compareFinancialSheets(snapshot(), null).length === 0);
  const unitChanged = compareFinancialSheets(snapshot({ data: { ...snapshot().data, unit: "PERCENT" } }), previousSnapshot);
  assert(unitChanged.some((change) => change.code === "UNIT_CHANGED"));
});
await check("22. Financeiro × Curva S mantém físico e financeiro separados (cumprimento financeiro × cumprimento físico, em p.p.)", () => {
  const findings = crossCheckFinancial(snapshot(), { curvaS: { fulfillmentPercent: 87.5, trend: "AGGRAVATION", deviationPp: -6, actualWeekProgress: 4 }, mpp: null, mppStatusDate: null });
  const aligned = findings.find((finding) => finding.code === "FINANCIAL_PHYSICAL_ALIGNED");
  assert(aligned && aligned.fact.includes("aba Financeiro") && aligned.fact.includes("aba Curva S") && aligned.difference === "+3.57 p.p.", JSON.stringify(aligned));
  const ahead = crossCheckFinancial(snapshot(), { curvaS: { fulfillmentPercent: 60, trend: "STABLE", deviationPp: -20, actualWeekProgress: 1 }, mpp: null, mppStatusDate: null });
  assert(ahead.some((finding) => finding.code === "FINANCIAL_AHEAD_OF_PHYSICAL" && finding.humanReviewRequired));
  assert(findings.some((finding) => finding.code === "INVOICED_WITHOUT_RECEIPT"), "faturado 270.000 × recebido 130.000");
  const builder = readSource("apps/web/lib/financial/build-financial-dashboard.ts");
  assert(!/actualCumulative\s*[+\-*]\s*(plannedTotal|actualTotal)/.test(builder), "nunca soma físico com financeiro");
});
await check("23. Financeiro × MPP preserva fatos e inferências (fato / diferença / interpretação / revisão humana)", () => {
  const mpp = { finalDate: { slipDays: 10 }, overdue: { currentCount: 4 }, criticalPath: { enteredCount: 1, leftCount: 0 }, progress: { currentPercent: 42 } };
  const findings = crossCheckFinancial(snapshot(), { curvaS: null, mpp, mppStatusDate: "2026-09-10" });
  const critical = findings.find((finding) => finding.code === "CRITICAL_PATH_AND_FINANCIAL_DETERIORATION");
  assert(critical && critical.fact && critical.interpretation && critical.humanReviewRequired === true && critical.severity === "CRITICAL", JSON.stringify(findings));
  assert(findings.some((finding) => finding.code === "CUTOFF_MISMATCH"));
  assert(findings.every((finding) => "fact" in finding && "interpretation" in finding && "humanReviewRequired" in finding));
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes("sem conclusão automática de causalidade") && page.includes("Possível interpretação"));
});

// ------------------------------------------------------------------
// RASTREABILIDADE / VALIDAÇÃO (24–28)
// ------------------------------------------------------------------
await check("24. Botão abre relatório de origem (e-mail do pacote semanal)", () => {
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes("ABRIR RELATÓRIO DE ORIGEM") && page.includes("/documentos/emails/${selected.emailId}"));
});
await check("25. Evidência aponta aba e células (locator: aba, índice, cabeçalho, faixa, colunas)", () => {
  const charts = buildFinancialCharts(snapshot());
  assert(charts[0].source.includes('aba "Financeiro"') && charts[0].source.includes("A1:F4"));
  const table = buildFinancialTable(snapshot());
  assert(table.rows[0].source === "Financeiro!A1:F4");
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes("selected.locator.range") && page.includes("originalSheetName") && page.includes("fileSha256"));
});
await check("26. Correção humana preserva valor original (RPC: previous_value + data.original; action: corrections[])", () => {
  const sql = readSource(MIGRATION);
  assert(sql.includes("p_data := p_data || jsonb_build_object('original', v_row.data, 'humanCorrected', true)"), "original preservado na RPC");
  assert(sql.includes("'VALIDATE_VALUES', 'data'") && sql.includes("jsonb_build_object('data', v_row.data, 'cutoff_date', v_row.cutoff_date)"));
  const actions = readSource("apps/web/app/[projectId]/financeiro/actions.ts");
  assert(actions.includes("previousValue: data.rows[rowIndex].values[column]") && actions.includes("validate_weekly_report_sheet_values") && !actions.includes("create or replace"), "reutiliza a RPC genérica, sem duplicar");
  assert(!/from\("weekly_report_sheets"\)\s*\.(update|upsert|insert)/.test(actions), "action nunca escreve direto na tabela");
});
await check("27. Correção humana é auditada (evento de revisão + audit_log; usuário/data/justificativa)", () => {
  const sql = readSource(MIGRATION);
  const fn = sql.slice(sql.indexOf("create or replace function public.validate_weekly_report_sheet_values"));
  assert(fn.slice(0, 4000).includes("insert into public.email_document_review_events") && fn.slice(0, 4000).includes("insert into public.audit_log_entries") && fn.slice(0, 4000).includes("decided_by_user_id"));
  assert(fn.slice(0, 4000).includes("raise exception 'Justificativa é obrigatória.'"));
  const form = readSource("apps/web/components/financial/financial-correction-form.tsx");
  assert(form.includes('name="justification"') && form.includes("required"));
});
await check("28. Reprocessamento é idempotente (worker recalcula HUMAN_VALIDATED sem duplicar; UNIQUE por anexo/categoria)", () => {
  const store = readSource("apps/web/lib/schedule/weekly-ingestion/supabase-store.ts");
  assert(store.includes("WORKBOOK_SHEET_HUMAN_STATUSES") && store.includes('.is("metrics", null)'), "abas validadas sem métricas voltam à fila");
  const processor = readSource("apps/web/lib/schedule/weekly-report/process-workbook.ts");
  assert(processor.includes('human?.status === "HUMAN_VALIDATED"') && processor.includes("raw[category] = { sheet, data: human.data }"), "dados validados preservados, métricas recalculadas");
  const sql = readSource(MIGRATION);
  assert(sql.includes("unique (workbook_id, category)") && sql.includes("unique (email_attachment_id)"));
});

// ------------------------------------------------------------------
// ESTADOS / NAVEGAÇÃO / EXPERT / HARDCODE (29–32)
// ------------------------------------------------------------------
await check("29. Estado sem dados funciona (sem relatório, aba ausente/ambígua/pendente, versão substituída, semana sem valores)", () => {
  assert(selectFinancialVersion([], {}) === null && buildFinancialCards(snapshot({ data: {} })).length === 0 && buildFinancialCharts(snapshot({ data: {} })).length === 0);
  assert(buildFinancialTable(snapshot({ data: {} })).total === 0 && compareFinancialSheets(snapshot({ data: {} }), previousSnapshot).length === 0);
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  for (const text of ["Nenhum relatório semanal com aba Financeiro", "Aba Financeiro ausente", "Aba ambígua", "Extração pendente", "versão substituída", "Semana sem valores financeiros", "Falha na extração", "Dados validados/corrigidos por humano"]) assert(page.includes(text), text);
  const missing = snapshot({ sheetStatus: "MISSING_SHEET", data: {} });
  assert(rankFinancialVersions([missing]).every((v) => v.isLatestOfWeek === false), "aba ausente não é versão válida");
});
await check("30. Mobile/sidebar/recolhido funcionam (lista única filtrada; ícone; tooltip; item ativo; sem grupos vazios)", () => {
  const sidebar = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(sidebar.includes("Wallet") && sidebar.includes("visibleItems.map") && !/Separator|navGroups/.test(sidebar) && sidebar.includes("title={itemTitle}") && sidebar.includes("pathname?.startsWith(href)"));
  assert(NAV_ITEMS.length === 14 && !NAV_ITEMS.some((item) => item.label === "Análise Contratual" || item.label === "Análise de Cláusulas") && NAV_ITEMS.some((item) => item.href === "juridico"));
  const financeiroIndex = NAV_ITEMS.findIndex((item) => item.href === "financeiro");
  const documentosIndex = NAV_ITEMS.findIndex((item) => item.href === "documentos");
  assert(financeiroIndex === documentosIndex + 1, "ordem coerente: logo após Documentos");
  assert(readSource("apps/web/lib/ui/feature-help.ts").includes('id: "financeiro"'));
});
await check("31. Expert commercial-director permanece roteado (e consolidação CEO)", () => {
  assert(routeSheetToExpert("FINANCEIRO") === "commercial-director");
  assert(snapshot().expertId === "commercial-director");
  const page = readSource("apps/web/app/[projectId]/financeiro/page.tsx");
  assert(page.includes("commercial-director") && page.includes("CEO IA"));
  const sql = readSource(MIGRATION);
  assert(!sql.includes("financial-director"), "nenhum Expert novo");
});
await check("32. Nenhum hardcode de WEG, pessoa ou moeda fixa", () => {
  for (const file of [
    "apps/web/lib/financial/access.ts",
    "apps/web/lib/financial/access-server.ts",
    "apps/web/lib/financial/build-financial-dashboard.ts",
    "apps/web/lib/financial/format-br.ts",
    "apps/web/lib/financial/financial-dashboard-data.ts",
    "apps/web/app/[projectId]/financeiro/page.tsx",
    "apps/web/app/[projectId]/financeiro/actions.ts",
    "apps/web/components/financial/financial-series-chart.tsx",
    "apps/web/components/financial/financial-correction-form.tsx",
  ]) {
    const source = readSource(file);
    assert(!/weg\.net|ricardo|martins|\bWEG\b/i.test(source), `${file} contém WEG/pessoa`);
    assert(!/@axion\.com\.br|@gmail/i.test(source), `${file} contém e-mail hardcoded`);
  }
  const builder = readSource("apps/web/lib/financial/build-financial-dashboard.ts");
  assert(!/"R\$"|'R\$'|BRL/.test(builder), "moeda não fixa no builder");
  assert(detectCurrencySymbol(["Previsto (US$)"]) === "US$" && detectCurrencySymbol(["Previsto"]) === null, "símbolo vem dos cabeçalhos");
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
