// Construção PURA do dashboard FINANCEIRO a partir dos dados JÁ extraídos
// da aba FINANCEIRO da planilha do relatório semanal (weekly_report_sheets
// category = FINANCEIRO). Nenhuma leitura de Excel, nenhuma reextração,
// nenhuma segunda fonte: só projeção/derivação dos dados persistidos.
//
// Regras: dado ausente => null (UI mostra "Dado não disponível", nunca 0);
// valores do período nunca misturados com acumulados; moeda nunca
// misturada com percentual; avanço físico (Curva S) e financeiro sempre
// separados; acumulados de semanas sucessivas nunca são somados; versões
// da mesma semana nunca são somadas (só a válida mais recente é usada).

import type { ScheduleComparisonMetrics } from "../schedule/weekly-ingestion/compare-schedule-versions";
import type { FinancialColumnKey, FinancialSheetData, FinancialSheetRow } from "../schedule/weekly-report/types";
import type { SCurveMetrics } from "../schedule/s-curve/types";
import type { FinancialUnit } from "./format-br";

export interface FinancialSheetSnapshot {
  sheetId: string;
  workbookId: string;
  projectId: string;
  emailId: string | null;
  emailAttachmentId: string;
  /** Gmail provider_message_id do e-mail de origem. */
  messageId: string | null;
  emailSentAt: string | null;
  fileName: string;
  fileSha256: string;
  workWeekNumber: number | null;
  workWeekLabel: string | null;
  cutoffDate: string | null;
  sheetStatus: string;
  workbookStatus: string;
  confidence: number | null;
  originalSheetName: string | null;
  sheetIndex: number | null;
  locator: Record<string, unknown>;
  extractionMethod: string;
  extractedAt: string | null;
  data: FinancialSheetData | Record<string, never>;
  metrics: Record<string, unknown> | null;
  alerts: Array<{ code: string; detail: string; severity: string }>;
  expertId: string;
  humanCorrected: boolean;
  validatedAt: string | null;
}

export interface FinancialVersionOption {
  workbookId: string;
  sheetId: string;
  workWeekNumber: number | null;
  workWeekLabel: string | null;
  emailSentAt: string | null;
  cutoffDate: string | null;
  sheetStatus: string;
  workbookStatus: string;
  /** true para a versão válida mais recente da semana. */
  isLatestOfWeek: boolean;
  /** true quando substituída por envio posterior na mesma semana. */
  superseded: boolean;
}

export const VALID_SHEET_STATUSES = new Set(["EXTRACTED", "HUMAN_MAPPED", "HUMAN_VALIDATED"]);

/** Ordena versões (semana desc, envio desc) e marca a válida mais recente de cada semana — nunca soma versões. */
export function rankFinancialVersions(snapshots: FinancialSheetSnapshot[]): FinancialVersionOption[] {
  const sorted = [...snapshots].sort((a, b) => {
    const weekDelta = (b.workWeekNumber ?? -1) - (a.workWeekNumber ?? -1);
    if (weekDelta !== 0) return weekDelta;
    return (b.emailSentAt ?? "").localeCompare(a.emailSentAt ?? "");
  });
  const latestByWeek = new Map<string, string>();
  for (const snapshot of sorted) {
    const key = snapshot.workWeekLabel ?? `sem-wnn:${snapshot.workbookId}`;
    if (!latestByWeek.has(key) && VALID_SHEET_STATUSES.has(snapshot.sheetStatus)) latestByWeek.set(key, snapshot.workbookId);
  }
  return sorted.map((snapshot) => {
    const key = snapshot.workWeekLabel ?? `sem-wnn:${snapshot.workbookId}`;
    const latest = latestByWeek.get(key) === snapshot.workbookId;
    return {
      workbookId: snapshot.workbookId,
      sheetId: snapshot.sheetId,
      workWeekNumber: snapshot.workWeekNumber,
      workWeekLabel: snapshot.workWeekLabel,
      emailSentAt: snapshot.emailSentAt,
      cutoffDate: snapshot.cutoffDate,
      sheetStatus: snapshot.sheetStatus,
      workbookStatus: snapshot.workbookStatus,
      isLatestOfWeek: latest,
      superseded: !latest && latestByWeek.has(key) && VALID_SHEET_STATUSES.has(snapshot.sheetStatus),
    };
  });
}

/** Versão válida mais recente (padrão) ou a selecionada explicitamente. */
export function selectFinancialVersion(snapshots: FinancialSheetSnapshot[], selection: { workbookId?: string | null; workWeekNumber?: number | null }): FinancialSheetSnapshot | null {
  const ranked = rankFinancialVersions(snapshots);
  if (selection.workbookId) return snapshots.find((snapshot) => snapshot.workbookId === selection.workbookId) ?? null;
  if (selection.workWeekNumber !== null && selection.workWeekNumber !== undefined) {
    const option = ranked.find((item) => item.workWeekNumber === selection.workWeekNumber && item.isLatestOfWeek);
    return option ? (snapshots.find((snapshot) => snapshot.workbookId === option.workbookId) ?? null) : null;
  }
  const latest = ranked.find((item) => item.isLatestOfWeek);
  return latest ? (snapshots.find((snapshot) => snapshot.workbookId === latest.workbookId) ?? null) : null;
}

/** Versão válida imediatamente anterior (semana anterior à selecionada; mesma semana nunca). */
export function selectPreviousValidVersion(snapshots: FinancialSheetSnapshot[], current: FinancialSheetSnapshot): FinancialSheetSnapshot | null {
  const ranked = rankFinancialVersions(snapshots).filter((item) => item.isLatestOfWeek);
  const candidates = ranked.filter((item) => {
    if (current.workWeekNumber !== null && item.workWeekNumber !== null) return item.workWeekNumber < current.workWeekNumber;
    return (item.emailSentAt ?? "") < (current.emailSentAt ?? "") && item.workbookId !== current.workbookId;
  });
  const previous = candidates[0];
  return previous ? (snapshots.find((snapshot) => snapshot.workbookId === previous.workbookId) ?? null) : null;
}

// ------------------------------------------------------------------
// Cards
// ------------------------------------------------------------------

export interface FinancialCard {
  key: string;
  label: string;
  value: number;
  unit: FinancialUnit;
  scope: "PERIOD" | "CUMULATIVE" | "DERIVED";
  note: string | null;
}

function hasData(snapshot: FinancialSheetSnapshot): snapshot is FinancialSheetSnapshot & { data: FinancialSheetData } {
  return Array.isArray((snapshot.data as FinancialSheetData).rows);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lastValue(rows: FinancialSheetRow[], key: FinancialColumnKey): { value: number | null; period: string | null } {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const value = rows[i].values[key];
    if (typeof value === "number") return { value, period: rows[i].period };
  }
  return { value: null, period: null };
}

function sumValues(rows: FinancialSheetRow[], key: FinancialColumnKey): number | null {
  const values = rows.map((row) => row.values[key]).filter((value): value is number => typeof value === "number");
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

/** Linhas até a data de corte (nunca "valores futuros" como realizados). */
export function rowsUpToCutoff(rows: FinancialSheetRow[], cutoffDate: string | null): FinancialSheetRow[] {
  if (!cutoffDate) return rows;
  const dated = rows.filter((row) => row.date);
  if (dated.length === 0) return rows;
  return rows.filter((row) => !row.date || row.date <= cutoffDate);
}

export function buildFinancialCards(snapshot: FinancialSheetSnapshot): FinancialCard[] {
  if (!hasData(snapshot)) return [];
  const data = snapshot.data;
  const unit: FinancialUnit = data.unit === "CURRENCY" ? "CURRENCY" : data.unit === "PERCENT" ? "PERCENT" : "UNKNOWN";
  const rows = rowsUpToCutoff(data.rows, snapshot.cutoffDate);
  const cards: FinancialCard[] = [];
  const push = (key: string, label: string, value: number | null, scope: FinancialCard["scope"], cardUnit: FinancialUnit = unit, note: string | null = null) => {
    if (value === null) return; // sem dado => sem card (nunca zero)
    cards.push({ key, label, value, unit: cardUnit, scope, note });
  };

  const previstoPeriodo = lastValue(rows, "previsto");
  const realizadoPeriodo = lastValue(rows, "realizado");
  push("previsto_periodo", "Previsto do período", previstoPeriodo.value, "PERIOD", unit, previstoPeriodo.period ? `Período ${previstoPeriodo.period}` : null);
  push("realizado_periodo", "Realizado do período", realizadoPeriodo.value, "PERIOD", unit, realizadoPeriodo.period ? `Período ${realizadoPeriodo.period}` : null);
  if (previstoPeriodo.value !== null && realizadoPeriodo.value !== null && previstoPeriodo.period === realizadoPeriodo.period) {
    push("desvio_periodo", "Desvio do período", Math.round((realizadoPeriodo.value - previstoPeriodo.value) * 100) / 100, "DERIVED", unit, "Realizado − previsto do mesmo período");
  }

  const previstoAcum = lastValue(rows, "acumulado_previsto").value;
  const realizadoAcum = lastValue(rows, "acumulado_realizado").value;
  push("previsto_acumulado", "Previsto acumulado", previstoAcum, "CUMULATIVE", unit, "Coluna acumulada da própria aba (não é soma de semanas)");
  push("realizado_acumulado", "Realizado acumulado", realizadoAcum, "CUMULATIVE", unit, "Coluna acumulada da própria aba (não é soma de semanas)");
  if (previstoAcum !== null && realizadoAcum !== null) {
    push("desvio_acumulado", "Desvio acumulado", Math.round((realizadoAcum - previstoAcum) * 100) / 100, "DERIVED", unit, "Realizado acumulado − previsto acumulado");
    if (previstoAcum !== 0) push("cumprimento", "Cumprimento do previsto", Math.round((realizadoAcum / previstoAcum) * 10000) / 100, "DERIVED", "PERCENT", "Realizado acumulado ÷ previsto acumulado");
  }

  const medido = sumValues(rows, "medido");
  const faturado = sumValues(rows, "faturado");
  const recebido = sumValues(rows, "recebido");
  push("medido", "Medido", medido, "PERIOD", unit, "Soma dos períodos reportados nesta aba");
  push("faturado", "Faturado", faturado, "PERIOD", unit, "Soma dos períodos reportados nesta aba");
  push("recebido", "Recebido", recebido, "PERIOD", unit, "Soma dos períodos reportados nesta aba");
  if (faturado !== null && recebido !== null) push("saldo_receber", "Saldo a receber", Math.round((faturado - recebido) * 100) / 100, "DERIVED", unit, "Faturado − recebido");

  const custo = sumValues(rows, "custo");
  const receita = sumValues(rows, "receita");
  push("custo", "Custo", custo, "PERIOD", unit, "Soma dos períodos reportados nesta aba");
  push("receita", "Receita", receita, "PERIOD", unit, "Soma dos períodos reportados nesta aba");
  // Resultado/margem só com custo E receita compatíveis (mesma aba/unidade monetária).
  if (custo !== null && receita !== null && unit === "CURRENCY") {
    const resultado = Math.round((receita - custo) * 100) / 100;
    push("resultado", "Resultado", resultado, "DERIVED", unit, "Receita − custo (mesma aba e moeda)");
    if (receita > 0) push("margem", "Margem", Math.round((resultado / receita) * 10000) / 100, "DERIVED", "PERCENT", "Resultado ÷ receita");
  }
  return cards;
}

// ------------------------------------------------------------------
// Gráficos (séries com lacunas preservadas — null nunca vira 0)
// ------------------------------------------------------------------

export interface FinancialChartSeries {
  key: string;
  label: string;
  points: Array<{ period: string; value: number | null }>;
}

export interface FinancialChart {
  key: string;
  title: string;
  unit: FinancialUnit;
  series: FinancialChartSeries[];
  source: string;
  periodLabel: string;
}

function seriesFor(rows: FinancialSheetRow[], key: FinancialColumnKey, label: string): FinancialChartSeries | null {
  const points = rows.map((row) => ({ period: row.period, value: num(row.values[key]) }));
  return points.some((point) => point.value !== null) ? { key, label, points } : null;
}

export function buildFinancialCharts(snapshot: FinancialSheetSnapshot, options: { previousDeviationSeries?: FinancialChartSeries | null } = {}): FinancialChart[] {
  if (!hasData(snapshot)) return [];
  const data = snapshot.data;
  const unit: FinancialUnit = data.unit === "CURRENCY" ? "CURRENCY" : data.unit === "PERCENT" ? "PERCENT" : "UNKNOWN";
  const rows = rowsUpToCutoff(data.rows, snapshot.cutoffDate);
  const periodLabel = rows.length ? `${rows[0].period} → ${rows[rows.length - 1].period}` : "—";
  const source = `${snapshot.fileName} · aba "${snapshot.originalSheetName ?? "?"}" · ${String(snapshot.locator.range ?? "")}`;
  const charts: FinancialChart[] = [];
  const add = (key: string, title: string, series: Array<FinancialChartSeries | null>, chartUnit: FinancialUnit = unit) => {
    const present = series.filter((item): item is FinancialChartSeries => item !== null);
    if (present.length === 0) return;
    charts.push({ key, title, unit: chartUnit, series: present, source, periodLabel });
  };

  add("previsto_realizado", "Previsto × realizado por período", [seriesFor(rows, "previsto", "Previsto"), seriesFor(rows, "realizado", "Realizado")]);
  add("acumulados", "Previsto acumulado × realizado acumulado", [seriesFor(rows, "acumulado_previsto", "Previsto acumulado"), seriesFor(rows, "acumulado_realizado", "Realizado acumulado")]);
  add("medido_faturado_recebido", "Medido × faturado × recebido", [seriesFor(rows, "medido", "Medido"), seriesFor(rows, "faturado", "Faturado"), seriesFor(rows, "recebido", "Recebido")]);
  add("receita_custo", "Receita × custo", [seriesFor(rows, "receita", "Receita"), seriesFor(rows, "custo", "Custo")]);

  const deviation: FinancialChartSeries = {
    key: "desvio",
    label: "Desvio (realizado − previsto)",
    points: rows.map((row) => ({
      period: row.period,
      value: typeof row.values.previsto === "number" && typeof row.values.realizado === "number" ? Math.round((row.values.realizado - row.values.previsto) * 100) / 100 : null,
    })),
  };
  if (deviation.points.some((point) => point.value !== null)) add("desvio_periodo", "Desvio financeiro por período", [deviation]);
  if (options.previousDeviationSeries) add("evolucao_desvio", "Evolução semanal do desvio (relatório anterior × atual)", [options.previousDeviationSeries, { ...deviation, label: "Desvio — relatório atual" }]);
  // Forecast/projeção: só quando a fonte tiver coluna reconhecida como projeção (não há hoje em FinancialColumnKey => nunca inventada).
  return charts;
}

// ------------------------------------------------------------------
// Tabela detalhada
// ------------------------------------------------------------------

export interface FinancialTableRow {
  period: string;
  date: string | null;
  values: Partial<Record<FinancialColumnKey, number | null>>;
  deviationAbsolute: number | null;
  deviationPercent: number | null;
  unit: FinancialUnit;
  confidence: number | null;
  source: string;
}

export function buildFinancialTable(snapshot: FinancialSheetSnapshot, options: { query?: string; from?: string | null; to?: string | null; sort?: "period_desc" | "period_asc" | "deviation_desc"; page?: number; pageSize?: number } = {}) {
  if (!hasData(snapshot)) return { columns: [] as FinancialColumnKey[], rows: [] as FinancialTableRow[], total: 0, page: 1, pageSize: options.pageSize ?? 25 };
  const data = snapshot.data;
  const unit: FinancialUnit = data.unit === "CURRENCY" ? "CURRENCY" : data.unit === "PERCENT" ? "PERCENT" : "UNKNOWN";
  const columns = Object.keys(data.columns) as FinancialColumnKey[];
  const source = `${snapshot.originalSheetName ?? "?"}!${String(snapshot.locator.range ?? "")}`;
  let rows: FinancialTableRow[] = data.rows.map((row) => {
    const previsto = num(row.values.previsto);
    const realizado = num(row.values.realizado);
    const deviationAbsolute = previsto !== null && realizado !== null ? Math.round((realizado - previsto) * 100) / 100 : null;
    const deviationPercent = deviationAbsolute !== null && previsto ? Math.round((deviationAbsolute / Math.abs(previsto)) * 10000) / 100 : null;
    return { period: row.period, date: row.date, values: row.values, deviationAbsolute, deviationPercent, unit, confidence: snapshot.confidence, source };
  });
  if (options.query) {
    const q = options.query.toLowerCase();
    rows = rows.filter((row) => row.period.toLowerCase().includes(q) || (row.date ?? "").includes(q));
  }
  if (options.from) rows = rows.filter((row) => !row.date || row.date >= options.from!);
  if (options.to) rows = rows.filter((row) => !row.date || row.date <= options.to!);
  const sort = options.sort ?? "period_asc";
  if (sort === "period_desc") rows = [...rows].reverse();
  if (sort === "deviation_desc") rows = [...rows].sort((a, b) => (b.deviationAbsolute ?? -Infinity) - (a.deviationAbsolute ?? -Infinity));
  const pageSize = options.pageSize ?? 25;
  const page = Math.max(1, options.page ?? 1);
  const total = rows.length;
  return { columns, rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

// ------------------------------------------------------------------
// Comparação com o relatório anterior
// ------------------------------------------------------------------

export interface FinancialChange {
  code:
    | "NEW_PERIOD"
    | "PLANNED_CHANGED"
    | "ACTUAL_CHANGED"
    | "RETROACTIVE_CHANGE"
    | "ACTUAL_REDUCED"
    | "CUMULATIVE_CHANGED"
    | "MEASURED_CHANGED"
    | "INVOICED_CHANGED"
    | "RECEIVED_CHANGED"
    | "COST_CHANGED"
    | "REVENUE_CHANGED"
    | "UNIT_CHANGED"
    | "TOTAL_INCONSISTENT";
  metric: string;
  period: string | null;
  previousValue: number | string | null;
  currentValue: number | string | null;
  difference: number | null;
  previousSource: string;
  currentSource: string;
  classification: "LOW" | "MEDIUM" | "HIGH" | "REVIEW_REQUIRED";
  detail: string;
}

const COLUMN_CHANGE_CODE: Partial<Record<FinancialColumnKey, FinancialChange["code"]>> = {
  previsto: "PLANNED_CHANGED",
  realizado: "ACTUAL_CHANGED",
  acumulado_previsto: "CUMULATIVE_CHANGED",
  acumulado_realizado: "CUMULATIVE_CHANGED",
  medido: "MEASURED_CHANGED",
  faturado: "INVOICED_CHANGED",
  recebido: "RECEIVED_CHANGED",
  custo: "COST_CHANGED",
  receita: "REVENUE_CHANGED",
};

function sourceOf(snapshot: FinancialSheetSnapshot): string {
  return `${snapshot.workWeekLabel ?? "sem WNN"} · ${snapshot.fileName} · ${snapshot.originalSheetName ?? "?"}!${String(snapshot.locator.range ?? "")}`;
}

export function compareFinancialSheets(current: FinancialSheetSnapshot, previous: FinancialSheetSnapshot | null): FinancialChange[] {
  if (!previous || !hasData(current) || !hasData(previous)) return [];
  const changes: FinancialChange[] = [];
  const prevSource = sourceOf(previous);
  const currSource = sourceOf(current);
  const prevRows = new Map(previous.data.rows.map((row) => [row.period, row]));
  const currentCutoffPrev = previous.cutoffDate;

  if (previous.data.unit !== current.data.unit) {
    changes.push({ code: "UNIT_CHANGED", metric: "unidade", period: null, previousValue: previous.data.unit, currentValue: current.data.unit, difference: null, previousSource: prevSource, currentSource: currSource, classification: "REVIEW_REQUIRED", detail: `Unidade/moeda alterada de ${previous.data.unit} para ${current.data.unit}.` });
  }

  for (const row of current.data.rows) {
    const before = prevRows.get(row.period);
    if (!before) {
      const hasAny = Object.values(row.values).some((value) => typeof value === "number");
      if (hasAny) changes.push({ code: "NEW_PERIOD", metric: "período", period: row.period, previousValue: null, currentValue: row.period, difference: null, previousSource: prevSource, currentSource: currSource, classification: "LOW", detail: `Período ${row.period} novo neste relatório.` });
      continue;
    }
    const isRetroactive = Boolean(row.date && currentCutoffPrev && row.date <= currentCutoffPrev);
    for (const key of Object.keys({ ...before.values, ...row.values }) as FinancialColumnKey[]) {
      const prev = num(before.values[key]);
      const curr = num(row.values[key]);
      if (prev === null && curr === null) continue;
      if (prev !== null && curr !== null && Math.abs(prev - curr) < 0.005) continue;
      const difference = prev !== null && curr !== null ? Math.round((curr - prev) * 100) / 100 : null;
      const baseCode = COLUMN_CHANGE_CODE[key] ?? "ACTUAL_CHANGED";
      const reduced = key === "realizado" && prev !== null && curr !== null && curr < prev;
      const code: FinancialChange["code"] = reduced ? "ACTUAL_REDUCED" : isRetroactive && key !== "previsto" ? "RETROACTIVE_CHANGE" : baseCode;
      const classification: FinancialChange["classification"] = reduced || code === "RETROACTIVE_CHANGE" ? "REVIEW_REQUIRED" : key === "previsto" && isRetroactive ? "HIGH" : "MEDIUM";
      changes.push({
        code,
        metric: key,
        period: row.period,
        previousValue: prev,
        currentValue: curr,
        difference,
        previousSource: prevSource,
        currentSource: currSource,
        classification,
        detail:
          reduced
            ? `Realizado de ${row.period} reduzido de ${prev} para ${curr} — valor anteriormente reportado como realizado diminuiu.`
            : code === "RETROACTIVE_CHANGE"
              ? `${key} de ${row.period} (anterior à data de corte do relatório anterior) alterado de ${prev ?? "—"} para ${curr ?? "—"}.`
              : `${key} de ${row.period} alterado de ${prev ?? "—"} para ${curr ?? "—"}.`,
      });
    }
  }

  // Total incompatível com composição (acumulado informado × soma dos períodos, no próprio relatório atual).
  const rows = current.data.rows;
  const cumulativeActual = lastValue(rows, "acumulado_realizado").value;
  const sumActual = sumValues(rows, "realizado");
  if (cumulativeActual !== null && sumActual !== null && rows.every((row) => row.date) && sumActual > cumulativeActual + 0.005) {
    changes.push({ code: "TOTAL_INCONSISTENT", metric: "acumulado_realizado", period: null, previousValue: sumActual, currentValue: cumulativeActual, difference: Math.round((cumulativeActual - sumActual) * 100) / 100, previousSource: currSource, currentSource: currSource, classification: "REVIEW_REQUIRED", detail: `Soma dos períodos realizados (${sumActual}) maior que o acumulado informado (${cumulativeActual}) — composição incompatível.` });
  }
  return changes;
}

/** Série de desvio por período do relatório anterior (para o gráfico de evolução). */
export function deviationSeriesOf(snapshot: FinancialSheetSnapshot | null, label: string): FinancialChartSeries | null {
  if (!snapshot || !hasData(snapshot)) return null;
  const points = rowsUpToCutoff(snapshot.data.rows, snapshot.cutoffDate).map((row) => ({
    period: row.period,
    value: typeof row.values.previsto === "number" && typeof row.values.realizado === "number" ? Math.round((row.values.realizado - row.values.previsto) * 100) / 100 : null,
  }));
  return points.some((point) => point.value !== null) ? { key: "desvio_anterior", label, points } : null;
}

// ------------------------------------------------------------------
// Cruzamento Financeiro × Curva S × MPP (fato / diferença / interpretação / revisão)
// ------------------------------------------------------------------

export interface CrossCheckFinding {
  code: string;
  domain: "CURVA_S" | "MPP";
  fact: string;
  difference: string | null;
  interpretation: string;
  humanReviewRequired: boolean;
  severity: "INFO" | "WARNING" | "CRITICAL";
}

export function crossCheckFinancial(
  snapshot: FinancialSheetSnapshot,
  context: { curvaS: SCurveMetrics | null; mpp: ScheduleComparisonMetrics | null; mppStatusDate: string | null }
): CrossCheckFinding[] {
  const findings: CrossCheckFinding[] = [];
  const cards = buildFinancialCards(snapshot);
  const card = (key: string) => cards.find((item) => item.key === key)?.value ?? null;
  const cumprimento = card("cumprimento");
  const faturado = card("faturado");
  const recebido = card("recebido");
  const custo = card("custo");

  if (context.curvaS) {
    const physicalFulfillment = context.curvaS.fulfillmentPercent;
    if (cumprimento !== null && physicalFulfillment !== null) {
      const gap = Math.round((cumprimento - physicalFulfillment) * 100) / 100;
      findings.push({
        code: gap > 10 ? "FINANCIAL_AHEAD_OF_PHYSICAL" : gap < -10 ? "PHYSICAL_AHEAD_OF_FINANCIAL" : "FINANCIAL_PHYSICAL_ALIGNED",
        domain: "CURVA_S",
        fact: `Cumprimento financeiro ${cumprimento}% (realizado ÷ previsto acumulado, aba Financeiro) × cumprimento físico ${physicalFulfillment}% (realizado ÷ planejado, aba Curva S).`,
        difference: `${gap > 0 ? "+" : ""}${gap} p.p.`,
        interpretation:
          gap > 10
            ? "Avanço financeiro muito superior ao físico — possível antecipação de medição/faturamento ou avanço físico sub-reportado."
            : gap < -10
              ? "Avanço físico sem correspondente medição financeira — possível atraso de medição/faturamento."
              : "Curvas financeira e física em faixa compatível.",
        humanReviewRequired: Math.abs(gap) > 10,
        severity: Math.abs(gap) > 20 ? "CRITICAL" : Math.abs(gap) > 10 ? "WARNING" : "INFO",
      });
    }
    const financialTrend = (snapshot.metrics?.trend as string | undefined) ?? "UNKNOWN";
    findings.push({
      code: "TREND_COMPARISON",
      domain: "CURVA_S",
      fact: `Tendência financeira ${financialTrend} × tendência física ${context.curvaS.trend} (desvio físico ${context.curvaS.deviationPp ?? "n/a"} p.p.).`,
      difference: null,
      interpretation: financialTrend === "WORSENING" && context.curvaS.trend === "AGGRAVATION" ? "Deterioração simultânea das duas curvas (descolamento não explicado só por medição)." : "Tendências registradas para leitura conjunta.",
      humanReviewRequired: financialTrend === "WORSENING" && context.curvaS.trend === "AGGRAVATION",
      severity: financialTrend === "WORSENING" && context.curvaS.trend === "AGGRAVATION" ? "WARNING" : "INFO",
    });
    if (custo !== null && context.curvaS.actualWeekProgress !== null && context.curvaS.actualWeekProgress <= 0.05 && custo > 0) {
      findings.push({ code: "COST_WITH_STALLED_PROGRESS", domain: "CURVA_S", fact: `Custo ${custo} reportado com avanço físico da semana ${context.curvaS.actualWeekProgress} p.p.`, difference: null, interpretation: "Custos crescendo com avanço estagnado — possível improdutividade ou custo indireto.", humanReviewRequired: true, severity: "WARNING" });
    }
  }
  if (faturado !== null && recebido !== null && faturado > 0 && recebido / faturado < 0.5) {
    findings.push({ code: "INVOICED_WITHOUT_RECEIPT", domain: "CURVA_S", fact: `Faturado ${faturado} × recebido ${recebido}.`, difference: `${Math.round((faturado - recebido) * 100) / 100} a receber`, interpretation: "Faturamento sem recebimento correspondente — possível inadimplência/prazo de pagamento.", humanReviewRequired: true, severity: "WARNING" });
  }

  if (context.mpp) {
    const slip = context.mpp.finalDate.slipDays;
    const overdue = context.mpp.overdue.currentCount;
    const financialTrend = (snapshot.metrics?.trend as string | undefined) ?? "UNKNOWN";
    findings.push({
      code: slip !== null && slip > 0 && financialTrend === "WORSENING" ? "CRITICAL_PATH_AND_FINANCIAL_DETERIORATION" : "MPP_CONTEXT",
      domain: "MPP",
      fact: `MPP: data final ${slip === null ? "n/a" : `${slip > 0 ? "+" : ""}${slip} dia(s)`}, ${overdue} atividade(s) vencida(s), caminho crítico +${context.mpp.criticalPath.enteredCount}/−${context.mpp.criticalPath.leftCount}, avanço ${context.mpp.progress.currentPercent ?? "n/a"}%.`,
      difference: cumprimento !== null && context.mpp.progress.currentPercent !== null ? `cumprimento financeiro ${cumprimento}% × progresso das atividades ${context.mpp.progress.currentPercent}%` : null,
      interpretation: slip !== null && slip > 0 && financialTrend === "WORSENING" ? "Atraso do caminho crítico acompanhado de deterioração financeira." : "Realização financeira e progresso das atividades registrados para leitura conjunta (marcos/prazo no cronograma).",
      humanReviewRequired: slip !== null && slip > 0 && financialTrend === "WORSENING",
      severity: slip !== null && slip > 0 && financialTrend === "WORSENING" ? "CRITICAL" : "INFO",
    });
    if (snapshot.cutoffDate && context.mppStatusDate && snapshot.cutoffDate.slice(0, 10) !== context.mppStatusDate.slice(0, 10)) {
      findings.push({ code: "CUTOFF_MISMATCH", domain: "MPP", fact: `Data de corte financeira ${snapshot.cutoffDate} × status_date do MPP ${context.mppStatusDate}.`, difference: null, interpretation: "Valores podem não ser comparáveis (datas de corte diferentes).", humanReviewRequired: true, severity: "WARNING" });
    }
  }
  return findings;
}
