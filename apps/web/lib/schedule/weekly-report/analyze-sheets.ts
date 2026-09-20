// Análise PURA das abas extraídas: métricas, cruzamentos e risco por
// limites do projeto. Fatos separados de inferências; sem limite =>
// REVIEW_REQUIRED informando os limites ausentes; nada é inventado.
//
// Separação inviolável: avanço físico (Curva S) × financeiro × recursos
// (Histograma) × SSMA — cada aba tem métricas próprias e nunca mistura
// unidades. A aba Linha de Base é WEEKLY_REPORT_BASELINE_SHEET e é
// COMPARADA com a OFFICIAL_SCHEDULE_BASELINE do MPP — jamais a substitui.

import type { ExpertId } from "../../ai/types";
import { analyzeSCurve, crossCheckSCurveWithMpp, type MppFactsForCrossCheck } from "../s-curve/analyze-s-curve";
import { classifySCurveRisk } from "../s-curve/classify-s-curve-risk";
import type { SCurveMetrics } from "../s-curve/types";
import type { ScheduleRiskClassification, ScheduleRiskDimension, ScheduleRiskThreshold } from "../weekly-ingestion/types";
import type {
  BaselineSheetData,
  CurvaSSheetData,
  FinancialColumnKey,
  FinancialSheetData,
  HistogramSheetData,
  SheetAlert,
  SsmaSheetData,
  WeeklyReportSheetCategory,
} from "./types";

export const SHEET_EXPERT: Record<WeeklyReportSheetCategory, ExpertId> = {
  CURVA_S: "planning-director",
  LINHA_BASE: "planning-director",
  HISTOGRAMA: "planning-director",
  FINANCEIRO: "commercial-director",
  SSMA: "esg-director",
};

/** Consolidador multidisciplinar existente (síntese; nunca substitui decisão humana). */
export const WEEKLY_REPORT_CONSOLIDATOR: ExpertId = "ceo";

export function routeSheetToExpert(category: WeeklyReportSheetCategory): ExpertId {
  return SHEET_EXPERT[category];
}

type Severity = Exclude<ScheduleRiskClassification, "REVIEW_REQUIRED">;

function severityFor(value: number, threshold: ScheduleRiskThreshold): Severity {
  if (value >= threshold.critical) return "CRITICAL";
  if (value >= threshold.high) return "HIGH";
  if (value >= threshold.medium) return "MEDIUM";
  return "LOW";
}

function classifySingle(
  dimension: ScheduleRiskDimension,
  value: number | null,
  adverse: boolean,
  thresholds: ScheduleRiskThreshold[]
): { classification: ScheduleRiskClassification; reasons: string[]; missing: ScheduleRiskDimension[] } {
  const threshold = thresholds.find((item) => item.dimension === dimension);
  if (value === null) return { classification: "REVIEW_REQUIRED", reasons: [`${dimension}: não mensurável nesta aba.`], missing: [] };
  if (!threshold) {
    return {
      classification: "REVIEW_REQUIRED",
      reasons: [`${dimension}: sem limite configurado para o projeto${adverse ? " — variação adversa exige revisão" : ""}. Limite ausente: ${dimension}.`],
      missing: [dimension],
    };
  }
  const severity = adverse ? severityFor(value, threshold) : "LOW";
  return { classification: severity, reasons: [`${dimension}: ${value} => ${severity} (limites ${threshold.medium}/${threshold.high}/${threshold.critical}).`], missing: [] };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ------------------------------------------------------------------
// CURVA S
// ------------------------------------------------------------------

export interface CurvaSContext {
  mppFacts: MppFactsForCrossCheck | null;
  previousDeviationPp: number | null;
  baselineSheet: BaselineSheetData | null;
  extractionConfidence: number;
  thresholds: ScheduleRiskThreshold[];
  workWeekLabel: string | null;
}

export function analyzeCurvaSSheet(data: CurvaSSheetData, context: CurvaSContext) {
  const metrics: SCurveMetrics = analyzeSCurve(data.series, { cutoffDate: data.cutoffDate, previousDeviationPp: context.previousDeviationPp });
  const crossCheck = crossCheckSCurveWithMpp(metrics, context.mppFacts, { extractionConfidence: context.extractionConfidence, sCurveWorkWeekLabel: context.workWeekLabel });
  const risk = classifySCurveRisk(metrics, crossCheck, context.thresholds, { extractionConfidence: context.extractionConfidence });
  const alerts: SheetAlert[] = crossCheck.issues.map((issue) => ({ code: issue.code, detail: issue.detail, severity: issue.code === "LOW_CONFIDENCE" ? "WARNING" : "CRITICAL" }));

  // Curva S planejada × aba Linha de Base (planejado do próprio Excel).
  const baselinePlanned = context.baselineSheet?.plannedSeries;
  const planned = data.series.find((series) => series.type === "PHYSICAL_PLANNED");
  if (baselinePlanned && planned && metrics.cutoffPeriod) {
    const basePoint = baselinePlanned.points.find((point) => point.period === metrics.cutoffPeriod);
    const curvePoint = planned.points.find((point) => point.period === metrics.cutoffPeriod);
    if (basePoint && curvePoint && Math.abs(basePoint.value - curvePoint.value) > 0.05) {
      alerts.push({
        code: "PLANNED_DIFFERS_FROM_BASELINE_SHEET",
        detail: `Planejado da Curva S (${curvePoint.value}%) difere da aba Linha de Base (${basePoint.value}%) no período ${metrics.cutoffPeriod} — possível replanejamento sem aprovação.`,
        severity: "WARNING",
      });
    }
  }
  return { metrics: { ...metrics, mppCrossCheck: crossCheck }, crossCheck, risk, alerts };
}

// ------------------------------------------------------------------
// LINHA DE BASE (comparação, nunca substituição)
// ------------------------------------------------------------------

export interface OfficialBaselineFacts {
  scheduleVersionId: string;
  finalPlannedDate: string | null;
  milestones: Array<{ name: string; plannedEnd: string | null }>;
}

export interface BaselineSheetContext {
  officialBaseline: OfficialBaselineFacts | null;
  previousBaselineSheet: BaselineSheetData | null;
  curvaS: CurvaSSheetData | null;
  thresholds: ScheduleRiskThreshold[];
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);
}

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function analyzeBaselineSheet(data: BaselineSheetData, context: BaselineSheetContext) {
  const alerts: SheetAlert[] = [];
  const divergences: Array<{ code: string; detail: string; days?: number }> = [];

  if (!context.officialBaseline) {
    alerts.push({ code: "OFFICIAL_BASELINE_NOT_SET", detail: "Baseline oficial do MPP não definida — a aba Linha de Base NÃO a substitui; defina a baseline oficial com justificativa.", severity: "WARNING" });
  } else {
    const finalDelta = daysBetween(data.finalPlannedDate, context.officialBaseline.finalPlannedDate);
    if (finalDelta !== null && finalDelta !== 0) {
      divergences.push({ code: "FINAL_DATE_DIFFERS", detail: `Data final da aba Linha de Base (${data.finalPlannedDate}) difere da baseline oficial do MPP (${context.officialBaseline.finalPlannedDate}) em ${finalDelta} dia(s).`, days: Math.abs(finalDelta) });
    }
    const officialByName = new Map(context.officialBaseline.milestones.map((milestone) => [normalizeName(milestone.name), milestone]));
    for (const row of data.rows.filter((item) => item.isMilestone && item.plannedEnd)) {
      const official = officialByName.get(normalizeName(row.label));
      if (!official) continue;
      const delta = daysBetween(row.plannedEnd, official.plannedEnd);
      if (delta !== null && delta !== 0) divergences.push({ code: "MILESTONE_DIFFERS", detail: `Marco "${row.label}": aba ${row.plannedEnd} × baseline oficial ${official.plannedEnd} (${delta} dia(s)).`, days: Math.abs(delta) });
    }
  }

  // Alteração retroativa / mudança da linha planejada vs semana anterior.
  if (context.previousBaselineSheet?.plannedSeries && data.plannedSeries) {
    const previous = new Map(context.previousBaselineSheet.plannedSeries.points.map((point) => [point.period, point.value]));
    const changed = data.plannedSeries.points.filter((point) => previous.has(point.period) && Math.abs((previous.get(point.period) ?? 0) - point.value) > 0.05);
    if (changed.length > 0) {
      divergences.push({ code: "PLANNED_LINE_CHANGED", detail: `Linha planejada alterada em ${changed.length} período(s) já reportado(s) (alteração retroativa/revisão sem aprovação): ${changed.slice(0, 5).map((point) => point.period).join(", ")}.` });
    }
  }
  // Percentuais planejados diferentes da Curva S.
  if (context.curvaS && data.plannedSeries) {
    const curvePlanned = context.curvaS.series.find((series) => series.type === "PHYSICAL_PLANNED");
    if (curvePlanned) {
      const byPeriod = new Map(curvePlanned.points.map((point) => [point.period, point.value]));
      const mismatched = data.plannedSeries.points.filter((point) => byPeriod.has(point.period) && Math.abs((byPeriod.get(point.period) ?? 0) - point.value) > 0.05);
      if (mismatched.length > 0) divergences.push({ code: "PLANNED_PERCENT_DIFFERS_FROM_CURVE", detail: `Percentuais planejados da aba divergem da Curva S em ${mismatched.length} período(s).` });
    }
  }

  for (const divergence of divergences) alerts.push({ code: divergence.code, detail: divergence.detail, severity: "WARNING" });
  const maxDays = divergences.reduce<number | null>((max, item) => (item.days !== undefined && (max === null || item.days > max) ? item.days : max), null);
  const risk = classifySingle("BASELINE_SHEET_DIVERGENCE_DAYS", context.officialBaseline ? (maxDays ?? 0) : null, divergences.length > 0, context.thresholds);
  if (divergences.length > 0 && risk.classification !== "REVIEW_REQUIRED") {
    risk.reasons.push("Qualquer mudança de baseline exige revisão humana, justificativa, usuário, data, histórico e permissão — a aba nunca substitui a baseline oficial.");
  }
  return {
    metrics: { finalPlannedDate: data.finalPlannedDate, rowCount: data.rows.length, milestoneCount: data.rows.filter((row) => row.isMilestone).length, divergences, officialBaselineScheduleVersionId: context.officialBaseline?.scheduleVersionId ?? null },
    crossCheck: { officialBaseline: context.officialBaseline, divergenceCount: divergences.length, maxDivergenceDays: maxDays },
    risk,
    alerts,
  };
}

// ------------------------------------------------------------------
// FINANCEIRO
// ------------------------------------------------------------------

export function analyzeFinancialSheet(data: FinancialSheetData, thresholds: ScheduleRiskThreshold[]) {
  const sum = (key: FinancialColumnKey) => {
    const values = data.rows.map((row) => row.values[key]).filter((value): value is number => typeof value === "number");
    return values.length ? round2(values.reduce((acc, value) => acc + value, 0)) : null;
  };
  const last = (key: FinancialColumnKey) => {
    for (let i = data.rows.length - 1; i >= 0; i -= 1) {
      const value = data.rows[i].values[key];
      if (typeof value === "number") return value;
    }
    return null;
  };
  const plannedTotal = last("acumulado_previsto") ?? sum("previsto");
  const actualTotal = last("acumulado_realizado") ?? sum("realizado");
  const deviationAbsolute = plannedTotal !== null && actualTotal !== null ? round2(actualTotal - plannedTotal) : null;
  const deviationPercent = plannedTotal && actualTotal !== null ? round2(((actualTotal - plannedTotal) / Math.abs(plannedTotal)) * 100) : null;

  // Tendência: desvio por período nos últimos 3 períodos com previsto e realizado.
  const periodDeviations = data.rows
    .map((row) => (typeof row.values.previsto === "number" && typeof row.values.realizado === "number" ? row.values.realizado - row.values.previsto : null))
    .filter((value): value is number => value !== null);
  const recent = periodDeviations.slice(-3);
  const trend = recent.length >= 2 ? (recent[recent.length - 1] > recent[0] ? "IMPROVING" : recent[recent.length - 1] < recent[0] ? "WORSENING" : "STABLE") : "UNKNOWN";

  const cumulative = data.rows.map((row) => ({ period: row.period, previsto: row.values.acumulado_previsto ?? null, realizado: row.values.acumulado_realizado ?? null }));
  const alerts: SheetAlert[] = [];
  if (data.unit === "PERCENT") alerts.push({ code: "FINANCIAL_IN_PERCENT", detail: "Aba financeira em percentual — não confundir com avanço físico.", severity: "INFO" });
  const risk = classifySingle("FINANCIAL_DEVIATION_PERCENT", deviationPercent === null ? null : Math.abs(deviationPercent), deviationPercent !== null && deviationPercent < 0, thresholds);
  return {
    metrics: {
      unit: data.unit,
      columnsMapped: Object.keys(data.columns),
      plannedTotal,
      actualTotal,
      deviationAbsolute,
      deviationPercent,
      trend,
      // Colunas de fluxo por período: soma do período reportado (nunca
      // confundidas com colunas "acumulado", que usam o último valor).
      medido: sum("medido"),
      faturado: sum("faturado"),
      recebido: sum("recebido"),
      custo: sum("custo"),
      receita: sum("receita"),
      desembolso: sum("desembolso"),
      cumulative,
    },
    crossCheck: null,
    risk,
    alerts,
  };
}

// ------------------------------------------------------------------
// HISTOGRAMA
// ------------------------------------------------------------------

export function analyzeHistogramSheet(
  data: HistogramSheetData,
  context: { thresholds: ScheduleRiskThreshold[]; physicalTrend: SCurveMetrics["trend"] | null; physicalDeviationPp: number | null; criticalActivityCount: number | null }
) {
  const planned = data.rows.map((row) => row.planned).filter((value): value is number => value !== null);
  const actual = data.rows.map((row) => row.actual).filter((value): value is number => value !== null);
  const plannedTotal = planned.length ? round2(planned.reduce((a, b) => a + b, 0)) : null;
  const actualTotal = actual.length ? round2(actual.reduce((a, b) => a + b, 0)) : null;
  const shortfallPercent = plannedTotal && actualTotal !== null ? round2(((plannedTotal - actualTotal) / plannedTotal) * 100) : null;
  const perPeriod = data.rows.filter((row) => row.planned !== null && row.actual !== null).map((row) => ({ period: row.period, category: row.category, gap: round2((row.actual ?? 0) - (row.planned ?? 0)) }));
  const recent = perPeriod.slice(-3).map((item) => item.gap);
  const trend = recent.length >= 2 ? (recent[recent.length - 1] > recent[0] ? "IMPROVING" : recent[recent.length - 1] < recent[0] ? "WORSENING" : "STABLE") : "UNKNOWN";

  const alerts: SheetAlert[] = [];
  if (data.resourceType === "UNKNOWN") alerts.push({ code: "RESOURCE_TYPE_UNKNOWN", detail: "Tipo de recurso não identificado — não presumido como mão de obra.", severity: "INFO" });
  if (shortfallPercent !== null && shortfallPercent > 0 && (context.physicalTrend === "AGGRAVATION" || (context.physicalDeviationPp ?? 0) < 0)) {
    alerts.push({ code: "INSUFFICIENT_RESOURCES_FOR_RECOVERY", detail: `Recursos ${shortfallPercent}% abaixo do previsto com avanço físico atrasado/agravando — indício de insuficiência de recursos para recuperação.`, severity: "CRITICAL" });
  }
  if (shortfallPercent !== null && shortfallPercent < 0) alerts.push({ code: "RESOURCE_EXCESS", detail: `Recursos ${Math.abs(shortfallPercent)}% acima do previsto.`, severity: "INFO" });
  if (context.criticalActivityCount !== null && context.criticalActivityCount > 0 && shortfallPercent !== null && shortfallPercent > 0) {
    alerts.push({ code: "SHORTFALL_WITH_CRITICAL_ACTIVITIES", detail: `${context.criticalActivityCount} atividade(s) crítica(s) no MPP com falta de recursos (${shortfallPercent}%).`, severity: "WARNING" });
  }
  const risk = classifySingle("HISTOGRAM_SHORTFALL_PERCENT", shortfallPercent === null ? null : Math.max(0, shortfallPercent), shortfallPercent !== null && shortfallPercent > 0, context.thresholds);
  return { metrics: { resourceType: data.resourceType, resourceEvidence: data.resourceEvidence, unit: data.unit, plannedTotal, actualTotal, shortfallPercent, trend, perPeriod: perPeriod.slice(0, 200) }, crossCheck: { physicalTrend: context.physicalTrend, physicalDeviationPp: context.physicalDeviationPp, criticalActivityCount: context.criticalActivityCount }, risk, alerts };
}

// ------------------------------------------------------------------
// SSMA (componente do relatório semanal; alimenta o Expert ESG/SSMA)
// ------------------------------------------------------------------

export function analyzeSsmaSheet(data: SsmaSheetData) {
  const latest = data.indicators.map((indicator) => {
    const values = indicator.values.filter((item) => item.value !== null);
    const last = values[values.length - 1] ?? null;
    const previous = values[values.length - 2] ?? null;
    return {
      key: indicator.key,
      label: indicator.label,
      latest: last?.value ?? null,
      latestPeriod: last?.period ?? null,
      previous: previous?.value ?? null,
      trend: last && previous ? (last.value! > previous.value! ? "UP" : last.value! < previous.value! ? "DOWN" : "STABLE") : "UNKNOWN",
    };
  });
  const alerts: SheetAlert[] = [];
  for (const item of latest) {
    if (/acidente|incidente|quase_acidentes|desvios/.test(item.key) && item.latest !== null && item.latest > 0) {
      alerts.push({ code: "SSMA_OCCURRENCE", detail: `${item.label}: ${item.latest} no período ${item.latestPeriod}.`, severity: /acidentes(_com_afastamento)?$/.test(item.key) ? "CRITICAL" : "WARNING" });
    }
  }
  return {
    metrics: { indicators: latest, classificationNote: "Componente do RELATORIO_SEMANAL_PLANEJAMENTO (não é RELATORIO_DIARIO_SSMA_ESG); avaliação pelo Expert ESG/SSMA." },
    crossCheck: null,
    risk: { classification: null as ScheduleRiskClassification | null, reasons: ["Risco SSMA é avaliado pelo Expert ESG/SSMA com os indicadores extraídos."], missing: [] as ScheduleRiskDimension[] },
    alerts,
  };
}
