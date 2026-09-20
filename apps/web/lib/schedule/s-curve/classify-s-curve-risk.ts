// Risco da Curva S — PURO, só com limites do projeto
// (project_schedule_risk_thresholds, dimensões S_CURVE_*). Sem limites
// suficientes ou baixa confiança => REVIEW_REQUIRED, informando quais
// limites faltam. Nunca LOW automaticamente.

import type { ScheduleRiskClassification, ScheduleRiskDimension, ScheduleRiskThreshold } from "../weekly-ingestion/types";
import type { SCurveMetrics, SCurveMppCrossCheck } from "./types";

type Severity = Exclude<ScheduleRiskClassification, "REVIEW_REQUIRED">;
const RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const LOWER_IS_WORSE = new Set<ScheduleRiskDimension>(["S_CURVE_FULFILLMENT_PERCENT"]);

export interface SCurveRiskAssessment {
  classification: ScheduleRiskClassification;
  partialSeverity: Severity | null;
  missingThresholds: ScheduleRiskDimension[];
  dimensions: Array<{ dimension: ScheduleRiskDimension; value: number | null; adverse: boolean; configured: boolean; severity: Severity | null; fact: string }>;
  reasons: string[];
}

function severityFor(dimension: ScheduleRiskDimension, value: number, threshold: ScheduleRiskThreshold): Severity {
  if (LOWER_IS_WORSE.has(dimension)) {
    if (value <= threshold.critical) return "CRITICAL";
    if (value <= threshold.high) return "HIGH";
    if (value <= threshold.medium) return "MEDIUM";
    return "LOW";
  }
  if (value >= threshold.critical) return "CRITICAL";
  if (value >= threshold.high) return "HIGH";
  if (value >= threshold.medium) return "MEDIUM";
  return "LOW";
}

export function classifySCurveRisk(
  metrics: SCurveMetrics,
  crossCheck: SCurveMppCrossCheck | null,
  thresholds: ScheduleRiskThreshold[],
  options: { extractionConfidence?: number | null; minimumConfidence?: number } = {}
): SCurveRiskAssessment {
  const byDimension = new Map(thresholds.map((threshold) => [threshold.dimension, threshold]));
  const reasons: string[] = [];
  const missing: ScheduleRiskDimension[] = [];
  const dimensions: SCurveRiskAssessment["dimensions"] = [];
  let partial: Severity | null = null;

  const measured: Array<{ dimension: ScheduleRiskDimension; value: number | null; adverse: boolean; fact: string }> = [
    {
      dimension: "S_CURVE_DEVIATION_PP",
      value: metrics.deviationPp === null ? null : Math.max(0, -metrics.deviationPp),
      adverse: metrics.deviationPp !== null && metrics.deviationPp < 0,
      fact: `Desvio ${metrics.deviationPp === null ? "n/a" : `${metrics.deviationPp} p.p.`} (realizado ${metrics.actualCumulative ?? "n/a"}% − planejado ${metrics.plannedCumulative ?? "n/a"}%).`,
    },
    {
      dimension: "S_CURVE_FULFILLMENT_PERCENT",
      value: metrics.fulfillmentPercent,
      adverse: metrics.fulfillmentPercent !== null && metrics.fulfillmentPercent < 100,
      fact: `Cumprimento ${metrics.fulfillmentPercent === null ? "n/a" : `${metrics.fulfillmentPercent}%`}.`,
    },
    {
      dimension: "S_CURVE_AGGRAVATION_PP",
      value: metrics.deviationTrendPp === null ? null : Math.max(0, -metrics.deviationTrendPp),
      adverse: metrics.trend === "AGGRAVATION",
      fact: `Tendência ${metrics.trend} (${metrics.deviationTrendPp === null ? "n/a" : `${metrics.deviationTrendPp} p.p.`} vs semana anterior; ${metrics.negativeDeviationStreak} período(s) consecutivos negativos).`,
    },
    {
      dimension: "S_CURVE_MPP_DIVERGENCE_PP",
      value: crossCheck?.divergencePp ?? null,
      adverse: (crossCheck?.divergencePp ?? 0) > 0,
      fact: `Divergência Curva S × MPP ${crossCheck?.divergencePp === null || crossCheck?.divergencePp === undefined ? "n/a" : `${crossCheck.divergencePp} p.p.`}.`,
    },
  ];

  for (const item of measured) {
    const threshold = byDimension.get(item.dimension);
    if (item.value === null) {
      dimensions.push({ ...item, configured: threshold !== undefined, severity: null });
      continue;
    }
    if (!threshold) {
      if (item.adverse) missing.push(item.dimension);
      dimensions.push({ ...item, configured: false, severity: null });
      continue;
    }
    const severity = severityFor(item.dimension, item.value, threshold);
    if (partial === null || RANK[severity] > RANK[partial]) partial = severity;
    dimensions.push({ ...item, configured: true, severity });
    if (severity !== "LOW") reasons.push(`${item.dimension}: ${severity} (${item.fact})`);
  }

  const confidence = options.extractionConfidence ?? 1;
  const minimumConfidence = options.minimumConfidence ?? 0.6;
  if (confidence < minimumConfidence) {
    reasons.unshift(`Confiança da extração (${confidence}) abaixo do mínimo (${minimumConfidence}) — validação humana necessária.`);
    return { classification: "REVIEW_REQUIRED", partialSeverity: partial, missingThresholds: missing, dimensions, reasons };
  }

  const sCurveThresholds = thresholds.filter((threshold) => threshold.dimension.startsWith("S_CURVE_"));
  if (sCurveThresholds.length === 0) {
    const all = measured.filter((item) => item.value !== null).map((item) => item.dimension);
    reasons.unshift(`Projeto sem limites de risco para Curva S. Limites ausentes: ${all.join(", ") || "todos"}.`);
    return { classification: "REVIEW_REQUIRED", partialSeverity: null, missingThresholds: all, dimensions, reasons };
  }
  if (missing.length > 0) {
    reasons.unshift(`Dimensões adversas sem limite configurado: ${missing.join(", ")}${partial ? ` (severidade parcial ${partial})` : ""}.`);
    return { classification: "REVIEW_REQUIRED", partialSeverity: partial, missingThresholds: missing, dimensions, reasons };
  }
  for (const issue of crossCheck?.issues ?? []) {
    if (issue.code !== "S_CURVE_MPP_PROGRESS_DIVERGENCE") reasons.push(`Inconsistência: ${issue.detail}`);
  }
  if (partial === null) {
    reasons.unshift("Nenhuma dimensão mensurável coberta pelos limites configurados.");
    return { classification: "REVIEW_REQUIRED", partialSeverity: null, missingThresholds: missing, dimensions, reasons };
  }
  if (partial === "LOW") reasons.unshift("Todas as dimensões mensuráveis abaixo dos limites MEDIUM configurados.");
  return { classification: partial, partialSeverity: partial, missingThresholds: missing, dimensions, reasons };
}
