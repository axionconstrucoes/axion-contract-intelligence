// Análise PURA da Curva S: desvio em pontos percentuais, cumprimento,
// avanço da semana, velocidade, tendência (recuperação/agravamento),
// projeção de conclusão e cruzamento com o MPP. Só FATOS mensuráveis;
// o risco é classificado à parte (classify-s-curve-risk.ts) com os
// limites do projeto.
//
// Regras invioláveis:
//   - só séries FÍSICAS em PERCENT entram no cálculo de avanço; séries
//     financeiras/mão de obra/desembolso são reportadas mas nunca
//     misturadas;
//   - desvio = realizado acumulado − planejado acumulado (p.p.);
//     cumprimento = realizado ÷ planejado (%). Nunca confundir p.p. com
//     variação percentual;
//   - nada é inventado: sem série ou sem ponto no corte => null + warning.

import type { ScheduleComparisonMetrics } from "../weekly-ingestion/compare-schedule-versions";
import type { SCurveMetrics, SCurveMppCrossCheck, SCurvePoint, SCurveSeries } from "./types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeToPercent(points: SCurvePoint[]): SCurvePoint[] {
  // Séries em fração (0..1) viram percentuais; séries já em % ficam.
  const max = Math.max(...points.map((point) => Math.abs(point.value)));
  if (Number.isFinite(max) && max > 0 && max <= 1.0001) {
    return points.map((point) => ({ ...point, value: round2(point.value * 100) }));
  }
  return points;
}

function toCumulative(series: SCurveSeries): SCurvePoint[] {
  const points = normalizeToPercent(series.points);
  if (series.scale === "CUMULATIVE") return points;
  let acc = 0;
  return points.map((point) => {
    acc += point.value;
    return { ...point, value: round2(acc) };
  });
}

function periodIndex(points: SCurvePoint[], cutoff: string | null): number {
  if (points.length === 0) return -1;
  if (!cutoff) return points.length - 1;
  // Corte por data (quando as duas são datas) ou por rótulo exato.
  const byLabel = points.findIndex((point) => point.period === cutoff);
  if (byLabel >= 0) return byLabel;
  if (/^\d{4}-\d{2}-\d{2}/.test(cutoff)) {
    // Corte por data só faz sentido quando os períodos têm data; séries
    // rotuladas só por semana da obra (W37) usam o último realizado.
    if (!points.some((point) => point.date)) return points.length - 1;
    let index = -1;
    points.forEach((point, i) => {
      if (point.date && point.date <= cutoff) index = i;
    });
    return index;
  }
  return points.length - 1;
}

/** Último período em que a série REALIZADA tem valor (o "corte" implícito da curva). */
function lastActualIndex(actual: SCurvePoint[]): number {
  for (let i = actual.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(actual[i].value)) return i;
  }
  return -1;
}

export function pickPhysicalSeries(series: SCurveSeries[]): {
  planned: SCurveSeries | null;
  actual: SCurveSeries | null;
  forecast: SCurveSeries | null;
  recovery: SCurveSeries | null;
  excluded: string[];
} {
  const physicalPercent = (type: SCurveSeries["type"]) =>
    series.find((candidate) => candidate.type === type && (candidate.unit === "PERCENT" || candidate.unit === "UNKNOWN")) ?? null;
  const excluded = series
    .filter((candidate) => !candidate.type.startsWith("PHYSICAL_"))
    .map((candidate) => `${candidate.sourceLabel} (${candidate.type}/${candidate.unit})`);
  return {
    planned: physicalPercent("PHYSICAL_PLANNED"),
    actual: physicalPercent("PHYSICAL_ACTUAL"),
    forecast: physicalPercent("PHYSICAL_FORECAST"),
    recovery: physicalPercent("PHYSICAL_RECOVERY"),
    excluded,
  };
}

export interface AnalyzeSCurveOptions {
  cutoffDate?: string | null;
  /** Desvio (p.p.) da semana anterior, quando houver histórico. */
  previousDeviationPp?: number | null;
  /** Janela para velocidade média (períodos). */
  velocityWindow?: number;
}

export function analyzeSCurve(series: SCurveSeries[], options: AnalyzeSCurveOptions = {}): SCurveMetrics {
  const warnings: string[] = [];
  const { planned, actual, forecast, excluded } = pickPhysicalSeries(series);
  if (excluded.length > 0) warnings.push(`Séries não físicas ignoradas no avanço: ${excluded.join("; ")}.`);

  const base: SCurveMetrics = {
    cutoffPeriod: null,
    cutoffDate: options.cutoffDate ?? null,
    plannedCumulative: null,
    actualCumulative: null,
    forecastCumulative: null,
    deviationPp: null,
    fulfillmentPercent: null,
    plannedWeekProgress: null,
    actualWeekProgress: null,
    velocityPerPeriod: null,
    previousDeviationPp: options.previousDeviationPp ?? null,
    deviationTrendPp: null,
    trend: "UNKNOWN",
    negativeDeviationStreak: 0,
    projectedCompletionPeriod: null,
    projectedCompletionNote: null,
    unit: "PERCENT",
    seriesUsed: { planned: planned?.sourceLabel ?? null, actual: actual?.sourceLabel ?? null, forecast: forecast?.sourceLabel ?? null },
    warnings,
  };

  if (!planned || !actual) {
    warnings.push("Curva S sem série física planejada e/ou realizada — avanço não mensurável.");
    return base;
  }

  const plannedCum = toCumulative(planned);
  const actualCum = toCumulative(actual);
  const forecastCum = forecast ? toCumulative(forecast) : [];

  const actualIndex = lastActualIndex(actualCum);
  const cutoffIndex = options.cutoffDate ? Math.min(periodIndex(actualCum, options.cutoffDate), actualIndex) : actualIndex;
  if (cutoffIndex < 0) {
    warnings.push("Nenhum ponto realizado até a data de corte.");
    return base;
  }

  const cutoffPoint = actualCum[cutoffIndex];
  const plannedAtCutoff =
    plannedCum.find((point) => point.period === cutoffPoint.period) ??
    (cutoffPoint.date ? [...plannedCum].reverse().find((point) => point.date && point.date <= cutoffPoint.date!) : plannedCum[cutoffIndex]) ??
    null;
  if (!plannedAtCutoff) {
    warnings.push("Série planejada não tem ponto correspondente ao período de corte.");
    return { ...base, cutoffPeriod: cutoffPoint.period, actualCumulative: round2(cutoffPoint.value) };
  }

  const plannedValue = plannedAtCutoff.value;
  const actualValue = cutoffPoint.value;
  const deviationPp = round2(actualValue - plannedValue);
  const fulfillmentPercent = plannedValue > 0 ? round2((actualValue / plannedValue) * 100) : null;
  if (fulfillmentPercent === null) warnings.push("Planejado acumulado = 0 no corte — cumprimento indefinido.");

  const previousActual = cutoffIndex > 0 ? actualCum[cutoffIndex - 1].value : 0;
  const plannedPreviousIndex = plannedCum.findIndex((point) => point.period === plannedAtCutoff.period);
  const previousPlanned = plannedPreviousIndex > 0 ? plannedCum[plannedPreviousIndex - 1].value : 0;
  const actualWeekProgress = round2(actualValue - previousActual);
  const plannedWeekProgress = round2(plannedValue - previousPlanned);

  const window = Math.max(1, options.velocityWindow ?? 4);
  const startIndex = Math.max(0, cutoffIndex - window);
  const velocity = cutoffIndex > startIndex ? round2((actualValue - actualCum[startIndex].value) / (cutoffIndex - startIndex)) : actualWeekProgress;

  let streak = 0;
  for (let i = cutoffIndex; i >= 0; i -= 1) {
    const plannedPoint = plannedCum.find((point) => point.period === actualCum[i].period) ?? plannedCum[i];
    if (!plannedPoint || actualCum[i].value - plannedPoint.value >= 0) break;
    streak += 1;
  }

  const previousDeviation = options.previousDeviationPp ?? (cutoffIndex > 0 ? round2(previousActual - previousPlanned) : null);
  const deviationTrendPp = previousDeviation === null ? null : round2(deviationPp - previousDeviation);
  const trend: SCurveMetrics["trend"] =
    deviationTrendPp === null ? "UNKNOWN" : deviationTrendPp > 0.05 ? "RECOVERY" : deviationTrendPp < -0.05 ? "AGGRAVATION" : "STABLE";

  let projectedCompletionPeriod: string | null = null;
  let projectedCompletionNote: string | null = null;
  const forecastPoint = forecastCum.length > 0 ? forecastCum[Math.min(cutoffIndex, forecastCum.length - 1)] : null;
  if (actualValue >= 99.99) {
    projectedCompletionPeriod = cutoffPoint.period;
    projectedCompletionNote = "Realizado acumulado atingiu 100%.";
  } else if (velocity > 0 && cutoffIndex >= 2) {
    const remainingPeriods = Math.ceil((100 - actualValue) / velocity);
    const targetIndex = cutoffIndex + remainingPeriods;
    projectedCompletionPeriod =
      targetIndex < plannedCum.length ? plannedCum[targetIndex].period : `${cutoffPoint.period} + ${remainingPeriods} período(s)`;
    projectedCompletionNote = `Extrapolação linear pela velocidade média de ${velocity} p.p./período (${window} períodos).`;
  } else {
    projectedCompletionNote = "Dados insuficientes para projetar conclusão (velocidade nula ou histórico curto).";
  }

  return {
    ...base,
    cutoffPeriod: cutoffPoint.period,
    cutoffDate: options.cutoffDate ?? cutoffPoint.date,
    plannedCumulative: round2(plannedValue),
    actualCumulative: round2(actualValue),
    forecastCumulative: forecastPoint ? round2(forecastPoint.value) : null,
    deviationPp,
    fulfillmentPercent,
    plannedWeekProgress,
    actualWeekProgress,
    velocityPerPeriod: velocity,
    previousDeviationPp: previousDeviation,
    deviationTrendPp,
    trend,
    negativeDeviationStreak: streak,
    projectedCompletionPeriod,
    projectedCompletionNote,
  };
}

export interface MppFactsForCrossCheck {
  /** Avanço físico agregado do MPP (%). */
  progressPercent: number | null;
  finalDateSlipDays: number | null;
  overdueCount: number | null;
  /** status_date do MPP (ISO date) */
  statusDate: string | null;
  /** Atividades com avanço no período (quando disponível). */
  activitiesWithProgressCount?: number | null;
  /** Rótulo de semana da obra do pacote (para detectar curva de outra semana). */
  workWeekLabel?: string | null;
}

export function crossCheckSCurveWithMpp(
  metrics: SCurveMetrics,
  mpp: MppFactsForCrossCheck | null,
  options: { extractionConfidence?: number | null; sCurveWorkWeekLabel?: string | null } = {}
): SCurveMppCrossCheck {
  const issues: SCurveMppCrossCheck["issues"] = [];
  const result: SCurveMppCrossCheck = {
    mppProgressPercent: mpp?.progressPercent ?? null,
    sCurveActualPercent: metrics.actualCumulative,
    divergencePp: null,
    mppFinalDateSlipDays: mpp?.finalDateSlipDays ?? null,
    mppOverdueCount: mpp?.overdueCount ?? null,
    cutoffMatches: null,
    issues,
  };

  if ((options.extractionConfidence ?? 1) < 0.6) {
    issues.push({ code: "LOW_CONFIDENCE", detail: `Confiança da extração ${options.extractionConfidence} — valores exigem validação humana.` });
  }
  if (metrics.warnings.some((warning) => /financ/i.test(warning)) && metrics.actualCumulative === null) {
    issues.push({ code: "PHYSICAL_FINANCIAL_CONFUSION", detail: "Só há séries financeiras: curva física ausente ou confundida com financeira." });
  }
  if (!mpp) return result;

  if (mpp.progressPercent !== null && metrics.actualCumulative !== null) {
    result.divergencePp = round2(Math.abs(metrics.actualCumulative - mpp.progressPercent));
    if (result.divergencePp > 0) {
      issues.push({
        code: "S_CURVE_MPP_PROGRESS_DIVERGENCE",
        detail: `Curva S realizada ${metrics.actualCumulative}% vs MPP ${mpp.progressPercent}% (Δ ${result.divergencePp} p.p.).`,
      });
    }
  }
  if (
    metrics.actualWeekProgress !== null &&
    metrics.actualWeekProgress > 0 &&
    mpp.activitiesWithProgressCount !== undefined &&
    mpp.activitiesWithProgressCount !== null &&
    mpp.activitiesWithProgressCount === 0
  ) {
    issues.push({ code: "PROGRESS_WITHOUT_ACTIVITIES", detail: `Curva S avança ${metrics.actualWeekProgress} p.p. na semana sem atividade do MPP com avanço.` });
  }
  if (metrics.trend === "RECOVERY" && mpp.finalDateSlipDays !== null && mpp.finalDateSlipDays > 0) {
    issues.push({ code: "RECOVERY_WITH_FINAL_DATE_SLIP", detail: `Curva indica recuperação, mas a data final do MPP piorou ${mpp.finalDateSlipDays} dia(s).` });
  }
  if (metrics.cutoffDate && mpp.statusDate) {
    result.cutoffMatches = metrics.cutoffDate.slice(0, 10) === mpp.statusDate.slice(0, 10);
    if (!result.cutoffMatches) {
      issues.push({ code: "CUTOFF_DATE_MISMATCH", detail: `Data de corte da Curva S (${metrics.cutoffDate}) difere do status_date do MPP (${mpp.statusDate}).` });
    }
  }
  if (options.sCurveWorkWeekLabel && mpp.workWeekLabel && options.sCurveWorkWeekLabel.toUpperCase() !== mpp.workWeekLabel.toUpperCase()) {
    issues.push({ code: "POSSIBLE_OTHER_PROJECT_OR_WEEK", detail: `Curva S rotulada ${options.sCurveWorkWeekLabel} em pacote ${mpp.workWeekLabel}.` });
  }
  return result;
}

/** Fatos do MPP a partir das métricas de comparação já computadas (reuso, sem nova leitura). */
export function mppFactsFromComparison(
  metrics: ScheduleComparisonMetrics | null,
  statusDate: string | null,
  workWeekLabel: string | null
): MppFactsForCrossCheck | null {
  if (!metrics) return null;
  return {
    progressPercent: metrics.progress.currentPercent,
    finalDateSlipDays: metrics.finalDate.slipDays,
    overdueCount: metrics.overdue.currentCount,
    statusDate,
    workWeekLabel,
  };
}
