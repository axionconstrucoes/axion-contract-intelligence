import type { Metadata } from "next";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  HardHat,
  MailCheck,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { createSupabaseServerClient } from "@axion/db/server";
import { getDashboardVisualData } from "@/lib/dashboard-visual/get-dashboard-visual-data";
import { getEvents } from "@/lib/data";
import { formatCurrency, formatDateTime } from "@/lib/labels";

export const metadata: Metadata = { title: "Dashboard" };

type MetricValue = number | string | null;

function ExecutiveKpi({
  label,
  value,
  subtitle,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex min-h-[118px] flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.055] px-4 py-4 text-center shadow-lg shadow-black/10">
      <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold uppercase tracking-[0.16em] text-[#d8b9bd]">
        <Icon className="size-4" />
        {label}
      </div>

      <div className="flex min-h-10 items-center justify-center text-center text-3xl font-bold leading-none text-white">
        {compactStatus(value)}
      </div>

      {subtitle ? (
        <div className="mt-2 text-[15px] leading-tight text-[#bfa1a6]">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-white/10 bg-white/[0.045] shadow-lg shadow-black/10 ${className}`}
    >
      <div className="border-b border-white/10 px-4 py-2">
        <h2 className="text-[17px] font-semibold uppercase tracking-[0.12em] text-white">
          {title}
        </h2>
      </div>

      <div className="p-3">{children}</div>
    </section>
  );
}

function StatusLine({
  label,
  value,
  status = "ok",
}: {
  label: string;
  value: React.ReactNode;
  status?: "ok" | "warning" | "error" | "neutral";
}) {
  const dot =
    status === "ok"
      ? "bg-emerald-400"
      : status === "warning"
        ? "bg-amber-400"
        : status === "error"
          ? "bg-red-400"
          : "bg-slate-400";

  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/7 py-1.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`size-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate text-[17px] font-medium leading-5 text-[#e6d4d6]">{label}</span>
      </div>

      <span className="shrink-0 text-right text-base font-semibold text-white">
        {compactStatus(value)}
      </span>
    </div>
  );
}

function compactStatus(value: React.ReactNode): React.ReactNode {
  if (
    typeof value === "string" &&
    (value === "EXTRACTED" || value === "PROCESSED")
  ) {
    return (
      <span className="inline-flex rounded-md bg-emerald-600 px-2.5 py-1 text-[15px] font-semibold leading-none text-white">
        OK
      </span>
    );
  }

  return value;
}

function formatDashboardCurrency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "Não disponível";
  }

  return Math.round(value / 1000).toLocaleString("en-US");
}
function numericMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function latestIndicatorValue(
  indicators: unknown[],
  pattern: RegExp
): { label: string; value: number; period: string | null } | null {
  for (const raw of indicators) {
    const item = asObject(raw);
    if (!item) continue;

    const key = String(item.key ?? "");
    const label = String(item.label ?? key);

    if (!pattern.test(`${key} ${label}`)) continue;

    const value = numericMetric(item.latest);
    if (value === null) continue;

    return {
      label,
      value,
      period: typeof item.latestPeriod === "string" ? item.latestPeriod : null,
    };
  }

  return null;
}


function formatDashboardDate(value: string | null): string {
  if (!value) return "Não disponível";

  const [year, month, day] = value.split("-");

  if (!year || !month || !day) return "Não disponível";

  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
}

function inclusiveDaysBetween(
  startDate: string | null,
  endDate: string | null
): number | null {
  if (!startDate || !endDate) return null;

  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return Math.floor((end - start) / 86400000) + 1;
}

function isImpraticavel(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase() === "impraticavel"
  );
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [data, events] = await Promise.all([
    getDashboardVisualData(projectId, { range: "PROJECT" }),
    getEvents(projectId),
  ]);

  const supabase = await createSupabaseServerClient();

  /*
   * Leitura do pacote semanal diretamente das tabelas persistidas.
   * Não cria dado novo e não presume recebimento.
   */
  const { data: recentEmails } = await supabase
    .from("emails")
    .select(
      "id,subject,from_address,sent_at,document_classification,classification_status,work_week_label"
    )
    .eq("project_id", projectId)
    .order("sent_at", { ascending: false })
    .limit(100);

  const emailIds = (recentEmails ?? []).map((email) => email.id);

  const { data: recentAttachments } =
    emailIds.length > 0
      ? await supabase
          .from("email_attachments")
          .select(
            "id,email_id,original_file_name,confirmed_classification,suggested_classification,processing_status"
          )
          .in("email_id", emailIds)
      : { data: [] };

  const emailById = new Map(
    (recentEmails ?? []).map((email) => [email.id, email])
  );

  const scheduleAttachment = (recentAttachments ?? [])
    .filter(
      (attachment) =>
        attachment.confirmed_classification === "CRONOGRAMA_MPP" ||
        attachment.suggested_classification === "CRONOGRAMA_MPP"
    )
    .sort((a, b) => {
      const aDate = emailById.get(a.email_id)?.sent_at ?? "";
      const bDate = emailById.get(b.email_id)?.sent_at ?? "";
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    })[0];

  const weeklyAttachment = (recentAttachments ?? [])
    .filter(
      (attachment) =>
        attachment.confirmed_classification ===
          "RELATORIO_SEMANAL_PLANEJAMENTO" ||
        attachment.suggested_classification ===
          "RELATORIO_SEMANAL_PLANEJAMENTO"
    )
    .sort((a, b) => {
      const aDate = emailById.get(a.email_id)?.sent_at ?? "";
      const bDate = emailById.get(b.email_id)?.sent_at ?? "";
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    })[0];

  const weeklyWorkbookAttachmentIds = weeklyAttachment
    ? [weeklyAttachment.id]
    : [];

  const { data: workbookRows } =
    weeklyWorkbookAttachmentIds.length > 0
      ? await supabase
          .from("weekly_report_workbooks")
          .select("id,email_attachment_id,status,extracted_at,schedule_version_id")
          .in("email_attachment_id", weeklyWorkbookAttachmentIds)
          .order("extracted_at", { ascending: false })
          .limit(1)
      : { data: [] };

  const latestWorkbook = workbookRows?.[0] ?? null;

  const { data: weeklySheets } = latestWorkbook
    ? await supabase
        .from("weekly_report_sheets")
        .select(
          "category,status,metrics,data,risk_classification,mapped_at,original_sheet_name"
        )
        .eq("workbook_id", latestWorkbook.id)
    : { data: [] };

  const sheetByCategory = new Map(
    (weeklySheets ?? []).map((sheet) => [sheet.category, sheet])
  );

  const physicalMetrics = asObject(sheetByCategory.get("CURVA_S")?.metrics);
  const financialMetrics = asObject(
    sheetByCategory.get("FINANCEIRO")?.metrics
  );
  const ssmaMetrics = asObject(sheetByCategory.get("SSMA")?.metrics);

  const physicalActual =
    numericMetric(physicalMetrics?.actualAtCutoff) ??
    numericMetric(physicalMetrics?.actualPercent) ??
    numericMetric(physicalMetrics?.actualCumulative) ??
    null;

  const financialActual =
    numericMetric(financialMetrics?.actualTotal) ??
    numericMetric(financialMetrics?.realizedTotal) ??
    null;

  const financialPlanned =
    numericMetric(financialMetrics?.plannedTotal) ?? null;

  const financialProgressPercent =
    financialActual !== null &&
    financialPlanned !== null &&
    financialPlanned > 0
      ? Math.max(0, Math.min(100, (financialActual / financialPlanned) * 100))
      : null;

  const financialAxion =
    numericMetric(financialMetrics?.faturado) ?? null;

  const financialDirect =
    financialActual !== null && financialAxion !== null
      ? financialActual - financialAxion
      : null;

  const financialBalance =
    financialPlanned !== null && financialActual !== null
      ? financialPlanned - financialActual
      : null;

  const formatFinancialMil = (value: number | null): string =>
    value === null
      ? "Não disponível"
      : `R$ ${Math.round(value / 1000).toLocaleString("pt-BR")}`;


  /*
   * PRAZO OPERACIONAL
   * Fonte: MPP vinculado ao último relatório semanal.
   * Dias não trabalhados: RDO / Diário de Obra.
   * 1 turno impraticável = 0,5 dia equivalente.
   * 2 turnos impraticáveis = 1,0 dia equivalente.
   */
  const scheduleVersionId =
    typeof latestWorkbook?.schedule_version_id === "string"
      ? latestWorkbook.schedule_version_id
      : null;

  const { data: scheduleActivities } = scheduleVersionId
    ? await supabase
        .from("schedule_activities")
        .select("planned_start,planned_end")
        .eq("schedule_version_id", scheduleVersionId)
    : { data: [] };

  const plannedStarts = (scheduleActivities ?? [])
    .map((item) => item.planned_start)
    .filter((value): value is string => typeof value === "string")
    .sort();

  const plannedEnds = (scheduleActivities ?? [])
    .map((item) => item.planned_end)
    .filter((value): value is string => typeof value === "string")
    .sort();

  const mppStartDate = plannedStarts[0] ?? null;
  const mppEndDate = plannedEnds.at(-1) ?? null;

  const contractStartDate = data.project?.startDate ?? null;
  const contractEndDate = data.project?.baselineEndDate ?? null;

  const dashboardContractEndDate =
    [contractEndDate, mppEndDate]
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

  const { data: rdoRows } = mppStartDate
    ? await supabase
        .from("diario_de_obra_reports")
        .select("reference_date,weather")
        .eq("project_id", projectId)
        .gte("reference_date", mppStartDate)
        .lte("reference_date", mppEndDate ?? "9999-12-31")
        .order("reference_date", { ascending: true })
    : { data: [] };

  const latestRdoDate =
    (rdoRows ?? [])
      .map((row) => row.reference_date)
      .filter((value): value is string => typeof value === "string")
      .at(-1) ?? null;

  const elapsedDays = inclusiveDaysBetween(mppStartDate, latestRdoDate);

  const equivalentNonWorkedDays = (rdoRows ?? []).reduce((total, row) => {
    const weather = asObject(row.weather);
    const morning = asObject(weather?.manha);
    const afternoon = asObject(weather?.tarde);

    let equivalent = 0;

    if (morning?.ativo !== false && isImpraticavel(morning?.condicao)) {
      equivalent += 0.5;
    }

    if (afternoon?.ativo !== false && isImpraticavel(afternoon?.condicao)) {
      equivalent += 0.5;
    }

    return total + equivalent;
  }, 0);

  const climateImpactPercent =
    elapsedDays && elapsedDays > 0
      ? (equivalentNonWorkedDays / elapsedDays) * 100
      : null;

  const indicators = Array.isArray(ssmaMetrics?.indicators)
    ? ssmaMetrics.indicators
    : [];

  const accidents = latestIndicatorValue(
    indicators,
    /\bacidentes?\b/i
  );

  const accidentsWithLeave = latestIndicatorValue(
    indicators,
    /acidente.*afastamento|afastamento.*acidente/i
  );

  const incidents = latestIndicatorValue(
    indicators,
    /\bincidentes?\b/i
  );

  const dds = latestIndicatorValue(indicators, /\bdds\b/i);
  const dda = latestIndicatorValue(indicators, /\bdda\b/i);

  const scheduleEmail = scheduleAttachment
    ? emailById.get(scheduleAttachment.email_id)
    : null;

  const weeklyEmail = weeklyAttachment
    ? emailById.get(weeklyAttachment.email_id)
    : null;


  // ==========================================================
  // Dashboard executivo — valores derivados de fontes reais
  // ==========================================================

  const formalizedVariation = data.contractValueTable.totalAditivosChange;

  const formatDashboardMil = (value: number | null): string =>
    value === null
      ? "Não disponível"
      : `R$ ${Math.round(value / 1000).toLocaleString("pt-BR")}`;

  // O total previsto do Financeiro W39 já representa
  // contrato vigente incluindo o Aditivo 01.
  const dashboardContractTotal = financialPlanned;

  // Valor original do contrato-base WEG:
  // Cláusula 5.1 = R$ 33.450.000,00.
  //
  // A fonte estruturada de aditivos ainda pode retornar zero.
  // Enquanto isso, usamos a diferença comprovável entre o
  // valor vigente do relatório e o contrato-base.
  const dashboardBaseContractValue = 33_450_000;

  const dashboardAdditives =
    dashboardContractTotal !== null
      ? Math.max(0, dashboardContractTotal - dashboardBaseContractValue)
      : formalizedVariation !== 0
        ? formalizedVariation
        : null;

  const dashboardFinancialRealized = financialActual;

  const dashboardFinancialBalance =
    dashboardContractTotal !== null &&
    dashboardFinancialRealized !== null
      ? dashboardContractTotal - dashboardFinancialRealized
      : null;


  // ----------------------------------------------------------
  // HISTOGRAMA — efetivo atual
  //
  // NÃO usar actualTotal, pois ele é a soma das semanas.
  // Usar o último registro disponível em data.rows.
  // ----------------------------------------------------------

  const histogramData = asObject(
    sheetByCategory.get("HISTOGRAMA")?.data
  );

  const histogramRows = Array.isArray(histogramData?.rows)
    ? histogramData.rows
    : [];

  const latestWorkforceRow =
    [...histogramRows]
      .reverse()
      .map((row) => asObject(row))
      .find(
        (row) =>
          row !== null &&
          (
            numericMetric(row.actual) !== null ||
            numericMetric(row.quantity) !== null
          )
      ) ?? null;

  const dashboardCurrentWorkforce =
    latestWorkforceRow !== null
      ? (
          numericMetric(latestWorkforceRow.actual) ??
          numericMetric(latestWorkforceRow.quantity)
        )
      : null;

  const dashboardCurrentWorkforcePeriod =
    latestWorkforceRow !== null &&
    typeof latestWorkforceRow.period === "string"
      ? latestWorkforceRow.period
      : null;


  // ----------------------------------------------------------
  // SSMA — fonte oficial: formulários SSMA
  // ----------------------------------------------------------

  const { data: dashboardSsmaForms } = await supabase
    .from("ssma_form_submissions")
    .select(
      "id,checklist_slug,checklist_title,occurred_at,field_values,checklist_values,risk_level,status"
    )
    .eq("project_id", projectId)
    .eq("status", "SUBMITTED")
    .order("occurred_at", { ascending: false });

  const submittedSsmaForms = dashboardSsmaForms ?? [];

  const ssmaFormText = (
    row: (typeof submittedSsmaForms)[number]
  ): string =>
    [
      row.checklist_slug,
      row.checklist_title,
      JSON.stringify(row.field_values ?? {}),
      JSON.stringify(row.checklist_values ?? {}),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("pt-BR");

  const accidentWithLeaveRows = submittedSsmaForms.filter((row) => {
    const text = ssmaFormText(row);

    return (
      /acidente/.test(text) &&
      !/quase[\s-]*acidente/.test(text) &&
      /com[\s-]*afastamento|afastamento[\s-]*sim/.test(text)
    );
  });

  const accidentWithoutLeaveRows = submittedSsmaForms.filter((row) => {
    const text = ssmaFormText(row);

    return (
      /acidente/.test(text) &&
      !/quase[\s-]*acidente/.test(text) &&
      /sem[\s-]*afastamento|afastamento[\s-]*(não|nao)/.test(text)
    );
  });

  const safetyOccurrenceRows = submittedSsmaForms.filter((row) => {
    const text = ssmaFormText(row);

    return (
      /ocorr[eê]ncia/.test(text) ||
      /incidente/.test(text) ||
      /quase[\s-]*acidente/.test(text) ||
      /desvio[\s-]*(de[\s-]*)?seguran/.test(text)
    );
  });

  const accidentRows = submittedSsmaForms.filter((row) => {
    const text = ssmaFormText(row);

    return (
      /acidente/.test(text) &&
      !/quase[\s-]*acidente/.test(text)
    );
  });

  const dashboardAccidentsWithLeave =
    accidentWithLeaveRows.length > 0
      ? accidentWithLeaveRows.length
      : null;

  const dashboardAccidentsWithoutLeave =
    accidentWithoutLeaveRows.length > 0
      ? accidentWithoutLeaveRows.length
      : null;

  const dashboardSafetyOccurrences =
    safetyOccurrenceRows.length > 0
      ? safetyOccurrenceRows.length
      : null;

  const latestAccidentTimestamp =
    accidentRows
      .map((row) => row.occurred_at)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0] ?? null;

  const dashboardDaysWithoutAccident =
    latestAccidentTimestamp !== null
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - latestAccidentTimestamp) /
              (1000 * 60 * 60 * 24)
          )
        )
      : null;

  const activeIntegrations =
    data.integrationStatusGroups.find(
      (group) => group.status === "CONECTADO"
    )?.count ?? 0;

  const totalIntegrations = data.integrationStatusGroups.reduce(
    (sum, group) => sum + group.count,
    0
  );

  const highestRisk =
    data.generalSituation === "SEM_RISCO_ATIVO"
      ? "SEM RISCO"
      : data.generalSituation === "CRITICA"
        ? "CRÍTICO"
        : data.generalSituation === "ALTA"
          ? "ALTO"
          : data.generalSituation === "MEDIA"
            ? "MÉDIO"
            : "BAIXO";


  const systemOperational =
    data.integrationStatusGroups.length > 0 &&
    data.integrationStatusGroups.every(
      (group) => group.status === "CONECTADO" || group.count === 0
    );

  return (
    <div className="-m-6 min-h-full bg-[#260611] p-2 text-white xl:h-[calc(100dvh-4rem)] xl:overflow-hidden xl:p-2">
      <div className="mx-auto flex h-full w-full max-w-[1920px] flex-col gap-2">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-1">
          <div>
            <p className="text-[15px] font-semibold uppercase tracking-[0.22em] text-[#cfaeb3]">
              AXION CONTROLE DE CONTRATOS
            </p>

            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              Dashboard Executivo
            </h1>

            <p className="mt-1 text-[17px] text-[#c9aeb2]">
              {data.project?.name ?? "Projeto não disponível"}
              {" · "}
              {data.project?.code ?? "Código não disponível"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`grid h-12 w-[270px] place-items-center rounded-xl px-4 text-center shadow-lg ${
                systemOperational
                  ? "bg-emerald-600 text-white ring-2 ring-emerald-400/40"
                  : "bg-red-600 text-white ring-2 ring-red-400/40"
              }`}
            >
              <span className="block w-full whitespace-nowrap text-center text-[17px] font-extrabold uppercase tracking-wide leading-none">
                {systemOperational ? "SISTEMA OPERACIONAL" : "SISTEMA NÃO OPERACIONAL"}
              </span>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-right">
              <p className="text-[15px] uppercase tracking-wider text-[#b8949a]">
                Atualização operacional
              </p>
              <p className="mt-1 text-[17px] font-semibold text-white">
                Dados persistidos no ACC
              </p>
            </div>
          </div>
        </header>

        {/* KPIs — números centralizados */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <ExecutiveKpi
            label="Alertas ativos"
            value={data.activeFindingsSummary.totalActive}
            subtitle="Achados ainda ativos"
            icon={AlertTriangle}
          />

          <ExecutiveKpi
            label="Eventos Ledger"
            value={events.length}
            subtitle="Eventos registrados"
            icon={Activity}
          />

          <ExecutiveKpi
            label="Risco atual"
            value={
              <span
                className={
                  highestRisk === "CRÍTICO"
                    ? "text-red-400"
                    : highestRisk === "ALTO"
                      ? "text-orange-400"
                      : highestRisk === "MÉDIO"
                        ? "text-amber-300"
                        : "text-emerald-400"
                }
              >
                {highestRisk}
              </span>
            }
            subtitle="Situação consolidada"
            icon={TriangleAlert}
          />

          <ExecutiveKpi
            label="Integrações"
            value={`${activeIntegrations}/${totalIntegrations}`}
            subtitle="Fontes conectadas"
            icon={CheckCircle2}
          />

          <ExecutiveKpi
            label="Aditivos"
            value={data.aditivosSummary.quantity}
            subtitle={
              formalizedVariation !== 0
                ? formatDashboardCurrency(formalizedVariation)
                : "Nenhum valor formalizado"
            }
            icon={CircleDollarSign}
          />

          <ExecutiveKpi
            label="Avanço físico"
            value={
              physicalActual !== null
                ? `${physicalActual.toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}%`
                : "—"
            }
            subtitle={
              physicalActual === null
                ? "Aguardando Curva S"
                : "Último relatório semanal"
            }
            icon={CalendarClock}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-2">
          {/* COLUNA PRINCIPAL */}
          <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-2">

            <Panel title="Situação contratual">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-black/15 p-2 text-center">
                  <p className="text-[17px] font-medium leading-5 text-[#d8c0c4]">
                    Alertas ativos
                  </p>
                  <p className="mt-2 text-4xl font-bold">
                    {data.activeFindingsSummary.totalActive}
                  </p>
                </div>

                <div className="rounded-lg bg-black/15 p-2 text-center">
                  <p className="text-[17px] font-medium leading-5 text-[#d8c0c4]">
                    Ações pendentes
                  </p>
                  <p className="mt-2 text-4xl font-bold">
                    {data.slaSummary.pending}
                  </p>
                </div>

                <StatusLine
                  label="Ações vencidas"
                  value={data.slaSummary.overdue}
                  status={data.slaSummary.overdue > 0 ? "error" : "ok"}
                />

                <StatusLine
                  label="Escalonamentos"
                  value={data.slaSummary.escalated}
                  status={data.slaSummary.escalated > 0 ? "warning" : "ok"}
                />

                <div className="col-span-2">
                  <StatusLine
                    label="Data de início"
                    value={formatDashboardDate(contractStartDate)}
                    status={contractStartDate ? "ok" : "neutral"}
                  />

                  <StatusLine
                    label="Data de término"
                    value={formatDashboardDate(dashboardContractEndDate)}
                    status={dashboardContractEndDate ? "ok" : "neutral"}
                  />
                </div>
              </div>
            </Panel>

            <Panel title="Financeiro resumido — R$ mil">
              <div className="space-y-0">
                <StatusLine
                  label="Contrato + aditivos"
                  value={formatDashboardMil(dashboardContractTotal)}
                  status={
                    dashboardContractTotal !== null ? "ok" : "neutral"
                  }
                />

                <StatusLine
                  label="Aditivos"
                  value={formatDashboardMil(dashboardAdditives)}
                  status={
                    dashboardAdditives !== null ? "ok" : "neutral"
                  }
                />

                <StatusLine
                  label="Realizado total"
                  value={formatDashboardMil(dashboardFinancialRealized)}
                  status={
                    dashboardFinancialRealized !== null
                      ? "ok"
                      : "neutral"
                  }
                />

                <StatusLine
                  label="Saldo"
                  value={formatDashboardMil(dashboardFinancialBalance)}
                  status={
                    dashboardFinancialBalance !== null
                      ? "ok"
                      : "neutral"
                  }
                />
              </div>

              <p className="mt-2 text-[15px] leading-tight text-[#a98288]">
                Valores em R$ mil · realizado inclui faturamento AXION +
                faturamento direto WEG.
              </p>
            </Panel>

            <Panel title="SSMA — Segurança">
              <div className="space-y-0">
                <StatusLine
                  label="Acidentes com afastamento"
                  value={
                    dashboardAccidentsWithLeave !== null
                      ? dashboardAccidentsWithLeave
                      : "—"
                  }
                  status={
                    dashboardAccidentsWithLeave !== null
                      ? dashboardAccidentsWithLeave > 0
                        ? "error"
                        : "ok"
                      : "neutral"
                  }
                />

                <StatusLine
                  label="Acidentes sem afastamento"
                  value={
                    dashboardAccidentsWithoutLeave !== null
                      ? dashboardAccidentsWithoutLeave
                      : "—"
                  }
                  status={
                    dashboardAccidentsWithoutLeave !== null
                      ? dashboardAccidentsWithoutLeave > 0
                        ? "warning"
                        : "ok"
                      : "neutral"
                  }
                />

                <StatusLine
                  label="Ocorrências de segurança"
                  value={
                    dashboardSafetyOccurrences !== null
                      ? dashboardSafetyOccurrences
                      : "—"
                  }
                  status={
                    dashboardSafetyOccurrences !== null
                      ? dashboardSafetyOccurrences > 0
                        ? "warning"
                        : "ok"
                      : "neutral"
                  }
                />

                <StatusLine
                  label="Dias sem acidente"
                  value={
                    dashboardDaysWithoutAccident !== null
                      ? dashboardDaysWithoutAccident
                      : "—"
                  }
                  status={
                    dashboardDaysWithoutAccident !== null
                      ? "ok"
                      : "neutral"
                  }
                />
              </div>

              <p className="mt-2 text-[15px] leading-tight text-[#a98288]">
                Fonte: formulários SSMA registrados no ACC.
              </p>
            </Panel>

            <div className="flex min-h-0 flex-col gap-3">
              <Panel title="Avanço físico do contrato">
              <div className="flex h-full flex-col items-center justify-center gap-4 py-2">
                <div
                  className="relative flex h-32 w-32 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(
                      #22c55e 0deg,
                      #22c55e ${Math.max(0, Math.min(100, Number(physicalActual ?? 0))) * 3.6}deg,
                      rgba(255,255,255,0.08) ${Math.max(0, Math.min(100, Number(physicalActual ?? 0))) * 3.6}deg,
                      rgba(255,255,255,0.08) 360deg
                    )`,
                  }}
                >
                  <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-[#3a0c16]">
                    <span className="text-[15px] font-medium uppercase tracking-[0.14em] text-[#d8c0c4]">
                      Realizado
                    </span>
                    <span className="mt-1 text-4xl font-extrabold text-white">
                      {physicalActual !== null
                        ? `${physicalActual.toLocaleString("pt-BR", {
                            maximumFractionDigits: 1,
                          })}%`
                        : "—"}
                    </span>
                  </div>
                </div>

                <div className="w-full space-y-2">
                  <StatusLine
                    label="Avanço físico atual"
                    value={
                      physicalActual !== null
                        ? `${physicalActual.toLocaleString("pt-BR", {
                            maximumFractionDigits: 1,
                          })}%`
                        : "Não disponível"
                    }
                    status={physicalActual !== null ? "ok" : "neutral"}
                  />

                  <p className="text-center text-[15px] leading-relaxed text-[#caa8ae]">
                    {physicalActual !== null
                      ? "Percentual acumulado apurado pela Curva S."
                      : "Aguardando processamento da Curva S."}
                  </p>
                </div>
              </div>
            </Panel>

              <Panel title="Avanço financeiro do contrato">
              <div className="flex h-full flex-col items-center justify-center gap-4 py-2">
                <div
                  className="relative flex h-32 w-32 items-center justify-center rounded-full"
                  style={{
                    background:
                      financialProgressPercent !== null
                        ? `conic-gradient(
                            #22c55e 0deg,
                            #22c55e ${financialProgressPercent * 3.6}deg,
                            rgba(255,255,255,0.08) ${financialProgressPercent * 3.6}deg,
                            rgba(255,255,255,0.08) 360deg
                          )`
                        : "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-[#3a0c16]">
                    <span className="text-[15px] font-medium uppercase tracking-[0.14em] text-[#d8c0c4]">
                      Realizado
                    </span>

                    <span className="mt-1 text-4xl font-extrabold text-white">
                      {financialProgressPercent !== null
                        ? `${financialProgressPercent.toLocaleString("pt-BR", {
                            maximumFractionDigits: 1,
                          })}%`
                        : "—"}
                    </span>
                  </div>
                </div>

                <div className="w-full space-y-1">
                  <StatusLine
                    label="Avanço financeiro"
                    value={
                      financialProgressPercent !== null
                        ? `${financialProgressPercent.toLocaleString("pt-BR", {
                            maximumFractionDigits: 1,
                          })}%`
                        : "Não disponível"
                    }
                    status={financialProgressPercent !== null ? "ok" : "neutral"}
                  />

                  <StatusLine
                    label="Faturamento AXION"
                    value={formatFinancialMil(financialAxion)}
                    status={financialAxion !== null ? "ok" : "neutral"}
                  />

                  <StatusLine
                    label="Faturamento Direto WEG"
                    value={formatFinancialMil(financialDirect)}
                    status={financialDirect !== null ? "ok" : "neutral"}
                  />

                  <StatusLine
                    label="Realizado total"
                    value={formatFinancialMil(financialActual)}
                    status={financialActual !== null ? "ok" : "neutral"}
                  />

                  <StatusLine
                    label="Base contratual"
                    value={formatFinancialMil(financialPlanned)}
                    status={financialPlanned !== null ? "ok" : "neutral"}
                  />

                  <StatusLine
                    label="Saldo"
                    value={formatFinancialMil(financialBalance)}
                    status={financialBalance !== null ? "ok" : "neutral"}
                  />
                </div>
              </div>
            </Panel>
            </div>



            

            

          </div>

          {/* COLUNA DIREITA */}
          <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-2">

            <Panel title="Planejamento — recebimento por e-mail">
              <div className="space-y-1">
                <StatusLine
                  label="Cronograma atualizado"
                  value={
                    scheduleAttachment
                      ? scheduleAttachment.processing_status
                      : "Não recebido"
                  }
                  status={scheduleAttachment ? "ok" : "warning"}
                />

                {scheduleEmail ? (
                  <div className="pb-1 pl-5 text-[15px] leading-snug text-[#b9999e]">
                    {scheduleAttachment?.original_file_name}
                    <br />
                    {scheduleEmail.from_address}
                    <br />
                    {formatDateTime(scheduleEmail.sent_at)}
                  </div>
                ) : null}

                <StatusLine
                  label="Relatório semanal"
                  value={
                    latestWorkbook?.status ??
                    weeklyAttachment?.processing_status ??
                    "Não recebido"
                  }
                  status={weeklyAttachment ? "ok" : "warning"}
                />

                {weeklyEmail ? (
                  <div className="pb-1 pl-5 text-[15px] leading-snug text-[#b9999e]">
                    {weeklyAttachment?.original_file_name}
                    <br />
                    {weeklyEmail.work_week_label ?? weeklyEmail.subject}
                    <br />
                    {weeklyEmail.from_address}
                    <br />
                    {formatDateTime(weeklyEmail.sent_at)}
                  </div>
                ) : null}

                <div className="mt-2 border-t border-white/10 pt-2">
                  <StatusLine
                    label="Dias decorridos"
                    value={elapsedDays ?? "Não disponível"}
                    status={elapsedDays !== null ? "ok" : "neutral"}
                  />

                  <StatusLine
                    label="Dias não trabalhados"
                    value={equivalentNonWorkedDays.toLocaleString("pt-BR", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    status={equivalentNonWorkedDays > 0 ? "warning" : "ok"}
                  />

                  <StatusLine
                    label="Impacto climático"
                    value={
                      climateImpactPercent !== null
                        ? `${climateImpactPercent.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}%`
                        : "Não disponível"
                    }
                    status={
                      climateImpactPercent !== null && climateImpactPercent > 0
                        ? "warning"
                        : "ok"
                    }
                  />
                </div>
              </div>
                          <div className="mt-1 border-t border-white/10 pt-1">
                <StatusLine
                  label="Efetivo atual"
                  value={
                    dashboardCurrentWorkforce !== null
                      ? `${dashboardCurrentWorkforce.toLocaleString("pt-BR")} pessoas`
                      : "Não disponível"
                  }
                  status={
                    dashboardCurrentWorkforce !== null
                      ? "ok"
                      : "neutral"
                  }
                />

                {dashboardCurrentWorkforcePeriod ? (
                  <p className="mt-1 text-right text-[15px] text-[#a98288]">
                    Histograma {dashboardCurrentWorkforcePeriod}
                  </p>
                ) : null}
              </div>

</Panel>

            <Panel title="Status das integrações">
              <div className="space-y-0">
                {data.integrationStatusGroups.flatMap((group) =>
                  group.labels.map((label) => (
                    <div
                      key={`${group.status}-${label}`}
                      className="flex items-center justify-between gap-3 border-b border-white/10 py-1.5 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`size-2.5 shrink-0 rounded-full ${
                            group.status === "CONECTADO"
                              ? "bg-emerald-400"
                              : group.status === "ATENCAO"
                                ? "bg-amber-400"
                                : group.status === "ERRO"
                                  ? "bg-red-400"
                                  : "bg-slate-400"
                          }`}
                        />

                        <span className="truncate text-[15px] font-medium text-[#e6d4d6]">
                          {label}
                        </span>
                      </div>

                      <span
                        className={`shrink-0 rounded-md px-2 py-1 text-[15px] font-bold uppercase ${
                          group.status === "CONECTADO"
                            ? "bg-emerald-600 text-white"
                            : group.status === "ATENCAO"
                              ? "bg-amber-400 text-black"
                              : group.status === "ERRO"
                                ? "bg-red-600 text-white"
                                : "bg-slate-500 text-white"
                        }`}
                      >
                        {group.status === "CONECTADO"
                          ? "ATIVO"
                          : group.status === "ATENCAO"
                            ? "ATENÇÃO"
                            : group.status === "ERRO"
                              ? "ERRO"
                              : "PENDENTE"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel title="Distribuição dos alertas">
              <div className="grid grid-cols-4 gap-3">
                {[
                  ["Baixo", data.activeFindingsSummary.countsBySeverity.BAIXA, "bg-emerald-500", "text-white"],
                  ["Médio", data.activeFindingsSummary.countsBySeverity.MEDIA, "bg-yellow-400", "text-black"],
                  ["Alto", data.activeFindingsSummary.countsBySeverity.ALTA, "bg-orange-500", "text-white"],
                  ["Crítico", data.activeFindingsSummary.countsBySeverity.CRITICA, "bg-red-500", "text-white"],
                ].map(([label, value, color, textColor]) => (
                  <div
                    key={String(label)}
                    className={`aspect-square flex flex-col items-center justify-center rounded-xl ${color} ${textColor}`}
                  >
                    <span className="text-[17px] font-normal">{label}</span>
                    <span className="mt-1 text-3xl font-bold">
                      {Number(value)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            

            <Panel title="Relatório semanal processado">
              <StatusLine
                label="Curva S"
                value={sheetByCategory.get("CURVA_S")?.status ?? "Ausente"}
                status={sheetByCategory.get("CURVA_S") ? "ok" : "neutral"}
              />

              <StatusLine
                label="Linha de Base"
                value={sheetByCategory.get("LINHA_BASE")?.status ?? "Ausente"}
                status={sheetByCategory.get("LINHA_BASE") ? "ok" : "neutral"}
              />

              <StatusLine
                label="Financeiro"
                value={sheetByCategory.get("FINANCEIRO")?.status ?? "Ausente"}
                status={sheetByCategory.get("FINANCEIRO") ? "ok" : "neutral"}
              />

              <StatusLine
                label="SSMA"
                value={sheetByCategory.get("SSMA")?.status ?? "Ausente"}
                status={sheetByCategory.get("SSMA") ? "ok" : "neutral"}
              />
            </Panel>

            <div className="rounded-xl border border-[#9c3b49]/40 bg-[#57101c] p-2">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#e6bec4]" />

                <div>
                  <p className="text-[17px] font-semibold text-white">
                    Atualização automática
                  </p>

                  <p className="mt-1 text-[15px] leading-relaxed text-[#d2b4b8]">
                    Cronograma, relatório semanal, financeiro e SSMA são
                    exibidos somente após o respectivo e-mail/anexo ter sido
                    persistido e processado pelo ACC.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-1 text-[15px] text-[#a98288]">
          <span>ACC · Dashboard executivo</span>
          <span>
            Nenhum indicador financeiro ou SSMA é estimado quando a fonte não
            está disponível.
          </span>
        </footer>
      </div>
    </div>
  );
}
