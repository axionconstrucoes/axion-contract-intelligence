// Loader server-only do dashboard FINANCEIRO. Fonte ÚNICA: relatório
// semanal válido → weekly_report_workbooks → weekly_report_sheets
// (category = FINANCEIRO), sempre pelo client de SESSÃO (RLS: membros do
// projeto E regra financeira). Cruzamentos usam a aba CURVA_S do MESMO
// workbook e a comparação MPP já computada — nunca PDF nem valores
// paralelos. Nenhuma tabela nova; nenhum snapshot duplicado.

import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import type { ScheduleComparisonMetrics } from "../schedule/weekly-ingestion/compare-schedule-versions";
import type { SCurveMetrics } from "../schedule/s-curve/types";
import type { FinancialSheetData } from "../schedule/weekly-report/types";
import { getProjectFinancialAccess } from "./access-server";
import {
  buildFinancialCards,
  buildFinancialCharts,
  buildFinancialTable,
  compareFinancialSheets,
  crossCheckFinancial,
  deviationSeriesOf,
  rankFinancialVersions,
  selectFinancialVersion,
  selectPreviousValidVersion,
  type FinancialSheetSnapshot,
} from "./build-financial-dashboard";

export interface FinancialDashboardParams {
  workbookId: string | null;
  workWeekNumber: number | null;
  from: string | null;
  to: string | null;
  query: string;
  sort: "period_asc" | "period_desc" | "deviation_desc";
  page: number;
  series: string | null;
}

export function parseFinancialDashboardParams(params: Record<string, string | string[] | undefined>): FinancialDashboardParams {
  const pick = (key: string) => {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    return text?.trim() ? text.trim() : null;
  };
  const week = pick("semana");
  const sort = pick("ordem");
  return {
    workbookId: pick("versao"),
    workWeekNumber: week && /^\d{1,3}$/.test(week) ? Number(week) : null,
    from: pick("de"),
    to: pick("ate"),
    query: pick("q") ?? "",
    sort: sort === "period_desc" || sort === "deviation_desc" ? sort : "period_asc",
    page: Math.max(1, Number(pick("pagina") ?? "1") || 1),
    series: pick("serie"),
  };
}

type SheetRow = Record<string, unknown> & {
  weekly_report_workbooks: Record<string, unknown> | null;
};

async function loadSnapshots(projectId: string): Promise<FinancialSheetSnapshot[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("weekly_report_sheets")
    .select(
      "id,workbook_id,project_id,status,original_sheet_name,sheet_index,source_locator,extraction_method,confidence,data,cutoff_date,metrics,alerts,expert_id,mapped_at,weekly_report_workbooks!inner(id,email_id,email_attachment_id,intake_id,schedule_version_id,work_week_number,work_week_label,file_name,file_sha256,status,extracted_at)"
    )
    .eq("project_id", projectId)
    .eq("category", "FINANCEIRO")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    // Migration ainda não aplicada => sem dados (nunca erro de página).
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(`Falha ao carregar aba Financeiro: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as SheetRow[];
  const emailIds = [...new Set(rows.map((row) => row.weekly_report_workbooks?.email_id as string | null).filter((id): id is string => Boolean(id)))];
  const { data: emails } = emailIds.length ? await supabase.from("emails").select("id,provider_message_id,sent_at").in("id", emailIds) : { data: [] };
  const emailById = new Map((emails ?? []).map((email) => [email.id as string, email]));

  return rows.map((row) => {
    // PostgREST devolve o join como objeto (inner, FK única) — normaliza caso venha em array.
    const joined = row.weekly_report_workbooks as Record<string, unknown> | Record<string, unknown>[] | null;
    const wb: Record<string, unknown> = Array.isArray(joined) ? (joined[0] ?? {}) : (joined ?? {});
    const email = wb.email_id ? emailById.get(wb.email_id as string) : undefined;
    const dataValue = (row.data as Record<string, unknown>) ?? {};
    return {
      sheetId: row.id as string,
      workbookId: wb.id as string,
      projectId: row.project_id as string,
      emailId: (wb.email_id as string | null) ?? null,
      emailAttachmentId: wb.email_attachment_id as string,
      messageId: (email?.provider_message_id as string | null) ?? null,
      emailSentAt: (email?.sent_at as string | null) ?? null,
      fileName: wb.file_name as string,
      fileSha256: wb.file_sha256 as string,
      workWeekNumber: (wb.work_week_number as number | null) ?? null,
      workWeekLabel: (wb.work_week_label as string | null) ?? null,
      cutoffDate: (row.cutoff_date as string | null) ?? null,
      sheetStatus: row.status as string,
      workbookStatus: wb.status as string,
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      originalSheetName: (row.original_sheet_name as string | null) ?? null,
      sheetIndex: (row.sheet_index as number | null) ?? null,
      locator: (row.source_locator as Record<string, unknown>) ?? {},
      extractionMethod: row.extraction_method as string,
      extractedAt: (wb.extracted_at as string | null) ?? null,
      data: (Array.isArray((dataValue as unknown as FinancialSheetData).rows) ? dataValue : {}) as unknown as FinancialSheetData | Record<string, never>,
      metrics: (row.metrics as Record<string, unknown> | null) ?? null,
      alerts: (row.alerts as FinancialSheetSnapshot["alerts"]) ?? [],
      expertId: row.expert_id as string,
      humanCorrected: Boolean(dataValue.humanCorrected),
      validatedAt: (row.mapped_at as string | null) ?? null,
    };
  });
}

export type FinancialDashboardModel =
  | { access: false }
  | {
      access: true;
      snapshots: FinancialSheetSnapshot[];
      versions: ReturnType<typeof rankFinancialVersions>;
      selected: FinancialSheetSnapshot | null;
      previous: FinancialSheetSnapshot | null;
      cards: ReturnType<typeof buildFinancialCards>;
      charts: ReturnType<typeof buildFinancialCharts>;
      table: ReturnType<typeof buildFinancialTable>;
      changes: ReturnType<typeof compareFinancialSheets>;
      crossChecks: ReturnType<typeof crossCheckFinancial>;
      curvaS: SCurveMetrics | null;
      mpp: ScheduleComparisonMetrics | null;
      workbookSheetsSummary: Array<{ category: string; status: string }>;
      params: FinancialDashboardParams;
      /** Regra única de correção (lib/financial/access.ts = SQL can_edit_project_financial_data). */
      canEdit: boolean;
    };

export async function loadFinancialDashboard(projectId: string, params: FinancialDashboardParams): Promise<FinancialDashboardModel> {
  const financialAccess = await getProjectFinancialAccess({ projectId });
  if (!financialAccess.canView) return { access: false };

  const snapshots = await loadSnapshots(projectId);
  const versions = rankFinancialVersions(snapshots);
  const selected = selectFinancialVersion(snapshots, { workbookId: params.workbookId, workWeekNumber: params.workWeekNumber });
  const previous = selected ? selectPreviousValidVersion(snapshots, selected) : null;

  let curvaS: SCurveMetrics | null = null;
  let mpp: ScheduleComparisonMetrics | null = null;
  let mppStatusDate: string | null = null;
  let workbookSheetsSummary: Array<{ category: string; status: string }> = [];
  if (selected) {
    const supabase = await createSupabaseServerClient();
    const [{ data: sheets }, { data: workbook }] = await Promise.all([
      supabase.from("weekly_report_sheets").select("category,status,metrics").eq("workbook_id", selected.workbookId),
      supabase.from("weekly_report_workbooks").select("schedule_version_id").eq("id", selected.workbookId).maybeSingle(),
    ]);
    workbookSheetsSummary = (sheets ?? []).map((sheet) => ({ category: sheet.category as string, status: sheet.status as string }));
    const curva = (sheets ?? []).find((sheet) => sheet.category === "CURVA_S");
    curvaS = (curva?.metrics as SCurveMetrics | null) ?? null;
    const scheduleVersionId = (workbook?.schedule_version_id as string | null) ?? null;
    if (scheduleVersionId) {
      const [{ data: comparison }, { data: sv }] = await Promise.all([
        supabase.from("schedule_version_comparisons").select("metrics").eq("current_schedule_version_id", scheduleVersionId).eq("comparison_type", "PREVIOUS_WEEKLY").eq("status", "COMPUTED").maybeSingle(),
        supabase.from("schedule_versions").select("status_date").eq("id", scheduleVersionId).maybeSingle(),
      ]);
      mpp = (comparison?.metrics as ScheduleComparisonMetrics | null) ?? null;
      mppStatusDate = (sv?.status_date as string | null) ?? null;
    }
  }

  return {
    access: true,
    snapshots,
    versions,
    selected,
    previous,
    cards: selected ? buildFinancialCards(selected) : [],
    charts: selected ? buildFinancialCharts(selected, { previousDeviationSeries: deviationSeriesOf(previous, `Desvio — ${previous?.workWeekLabel ?? "relatório anterior"}`) }) : [],
    table: selected ? buildFinancialTable(selected, { query: params.query, from: params.from, to: params.to, sort: params.sort, page: params.page, pageSize: 25 }) : { columns: [], rows: [], total: 0, page: 1, pageSize: 25 },
    changes: selected ? compareFinancialSheets(selected, previous) : [],
    crossChecks: selected ? crossCheckFinancial(selected, { curvaS, mpp, mppStatusDate }) : [],
    curvaS,
    mpp,
    workbookSheetsSummary,
    params,
    canEdit: financialAccess.canEdit,
  };
}
