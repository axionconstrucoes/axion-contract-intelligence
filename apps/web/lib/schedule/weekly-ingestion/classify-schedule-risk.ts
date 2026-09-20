// Classificação de risco da comparação de cronograma — PURA.
//
// Regra central (requisito): a classificação depende EXCLUSIVAMENTE dos
// limites configurados por projeto (project_schedule_risk_thresholds).
// Sem limite para uma dimensão que apresenta variação adversa =>
// REVIEW_REQUIRED. Sem nenhum limite configurado => REVIEW_REQUIRED.
// NUNCA "LOW por ausência de configuração".
//
// Cada dimensão produz um FATO (valor medido), a comparação com o
// limite produz uma INFERÊNCIA (severidade) e o resultado agregado
// carrega as razões — permitindo revisão humana de cada passo.

import type { ScheduleComparisonMetrics } from "./compare-schedule-versions";
import type { ScheduleRiskClassification, ScheduleRiskDimension, ScheduleRiskThreshold } from "./types";

export type ScheduleRiskSeverity = Exclude<ScheduleRiskClassification, "REVIEW_REQUIRED">;

export interface DimensionAssessment {
  dimension: ScheduleRiskDimension;
  /** Valor medido (null = não mensurável nesta comparação). */
  value: number | null;
  /** true quando o valor representa piora relevante (exige limite configurado). */
  adverse: boolean;
  configured: boolean;
  severity: ScheduleRiskSeverity | null;
  reason: string;
}

export interface ScheduleRiskAssessment {
  classification: ScheduleRiskClassification;
  /** Maior severidade entre as dimensões configuradas (mesmo quando REVIEW_REQUIRED). */
  partialSeverity: ScheduleRiskSeverity | null;
  /** Limites ausentes que impediram a classificação automática (sempre informados). */
  missingThresholds: ScheduleRiskDimension[];
  dimensions: DimensionAssessment[];
  reasons: string[];
}

const SEVERITY_RANK: Record<ScheduleRiskSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Dimensões em que "menor é pior" (limiares lidos como "abaixo de"). */
const LOWER_IS_WORSE = new Set<ScheduleRiskDimension>(["MIN_TOTAL_FLOAT_DAYS"]);

function severityFor(dimension: ScheduleRiskDimension, value: number, threshold: ScheduleRiskThreshold): ScheduleRiskSeverity {
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

interface Measured {
  dimension: ScheduleRiskDimension;
  value: number | null;
  adverse: boolean;
  fact: string;
}

export function measureDimensions(metrics: ScheduleComparisonMetrics): Measured[] {
  const finalSlip = metrics.finalDate.slipDays;
  const milestoneSlip = metrics.milestones.maxSlipDays;
  const criticalChanged = metrics.criticalPath.enteredCount + metrics.criticalPath.leftCount;
  const minFloat = metrics.totalFloat.currentMinDays;
  const overdue = metrics.overdue.currentCount;
  const addedRemoved = metrics.matching.addedCount + metrics.matching.removedCount;
  const durationChange = metrics.durations.maxChangePercent;
  const relationChanges = metrics.relations.changedCount;
  const progressShortfall =
    metrics.progress.deltaPercent !== null ? Math.max(0, -metrics.progress.deltaPercent) : null;
  const aggravation = metrics.delay.trendDays;

  return [
    {
      dimension: "FINAL_DATE_SLIP_DAYS",
      value: finalSlip,
      adverse: finalSlip !== null && finalSlip > 0,
      fact: `Data final: ${finalSlip === null ? "não mensurável" : `${finalSlip > 0 ? "+" : ""}${finalSlip} dia(s)`}.`,
    },
    {
      dimension: "CONTRACT_MILESTONE_SLIP_DAYS",
      value: milestoneSlip,
      adverse: milestoneSlip !== null && milestoneSlip > 0,
      fact: `Marcos: ${metrics.milestones.slippedCount} deslizado(s), máximo ${milestoneSlip ?? "n/a"} dia(s).`,
    },
    {
      dimension: "CRITICAL_PATH_CHANGED_COUNT",
      value: criticalChanged,
      adverse: criticalChanged > 0,
      fact: `Caminho crítico: ${metrics.criticalPath.enteredCount} entrada(s), ${metrics.criticalPath.leftCount} saída(s).`,
    },
    {
      dimension: "MIN_TOTAL_FLOAT_DAYS",
      value: minFloat,
      // Folga negativa/zero é sempre adversa; positiva depende do limite.
      adverse: minFloat !== null && minFloat <= 0,
      fact: `Folga total mínima: ${minFloat === null ? "não mensurável" : `${minFloat} dia(s)`}.`,
    },
    {
      dimension: "OVERDUE_ACTIVITIES_COUNT",
      value: overdue,
      adverse: overdue > 0,
      fact: `Atividades vencidas: ${overdue} (variação ${metrics.overdue.deltaCount >= 0 ? "+" : ""}${metrics.overdue.deltaCount}).`,
    },
    {
      dimension: "ADDED_REMOVED_ACTIVITIES_COUNT",
      value: addedRemoved,
      adverse: addedRemoved > 0,
      fact: `Atividades adicionadas/removidas: ${metrics.matching.addedCount}/${metrics.matching.removedCount}.`,
    },
    {
      dimension: "DURATION_CHANGE_PERCENT",
      value: durationChange === null ? null : Math.abs(durationChange),
      adverse: durationChange !== null && durationChange !== 0,
      fact: `Durações alteradas: ${metrics.durations.changedCount} (maior variação ${durationChange ?? "n/a"}%).`,
    },
    {
      dimension: "RELATION_CHANGES_COUNT",
      value: relationChanges,
      adverse: relationChanges > 0,
      fact: `Predecessoras/sucessoras alteradas: ${relationChanges}.`,
    },
    {
      dimension: "PHYSICAL_PROGRESS_SHORTFALL_PERCENT",
      value: progressShortfall,
      adverse: progressShortfall !== null && progressShortfall > 0,
      fact: `Avanço físico: ${metrics.progress.currentPercent ?? "n/a"}% (variação ${metrics.progress.deltaPercent ?? "n/a"} p.p.).`,
    },
    {
      dimension: "DELAY_AGGRAVATION_DAYS",
      value: aggravation,
      adverse: aggravation !== null && aggravation > 0,
      fact: `Tendência do atraso: ${metrics.delay.trend} (${aggravation === null ? "n/a" : `${aggravation > 0 ? "+" : ""}${aggravation} dia(s)`}).`,
    },
  ];
}

export function classifyScheduleRisk(
  metrics: ScheduleComparisonMetrics,
  thresholds: ScheduleRiskThreshold[]
): ScheduleRiskAssessment {
  const thresholdByDimension = new Map(thresholds.map((threshold) => [threshold.dimension, threshold]));
  const dimensions: DimensionAssessment[] = [];
  const reasons: string[] = [];
  let partialSeverity: ScheduleRiskSeverity | null = null;
  const unconfiguredAdverse: ScheduleRiskDimension[] = [];

  for (const measured of measureDimensions(metrics)) {
    const threshold = thresholdByDimension.get(measured.dimension);
    const configured = threshold !== undefined;

    if (measured.value === null) {
      dimensions.push({ ...measured, configured, severity: null, reason: `${measured.fact} Não mensurável nesta comparação.` });
      continue;
    }

    if (!configured) {
      if (measured.adverse) unconfiguredAdverse.push(measured.dimension);
      dimensions.push({
        ...measured,
        configured: false,
        severity: null,
        reason: `${measured.fact} Sem limite configurado para o projeto${measured.adverse ? " — variação adversa exige revisão" : ""}.`,
      });
      continue;
    }

    const severity = severityFor(measured.dimension, measured.value, threshold);
    if (partialSeverity === null || SEVERITY_RANK[severity] > SEVERITY_RANK[partialSeverity]) {
      partialSeverity = severity;
    }
    dimensions.push({
      ...measured,
      configured: true,
      severity,
      reason: `${measured.fact} Limites ${threshold.medium}/${threshold.high}/${threshold.critical} => ${severity}.`,
    });
    if (severity !== "LOW") reasons.push(`${measured.dimension}: ${severity} (${measured.fact})`);
  }

  const mppThresholds = thresholds.filter((threshold) => !threshold.dimension.startsWith("S_CURVE_"));
  if (mppThresholds.length === 0) {
    const missingThresholds = dimensions.filter((dimension) => dimension.value !== null).map((dimension) => dimension.dimension);
    reasons.unshift(
      `Projeto sem limites de risco de cronograma configurados — classificação automática indisponível. Limites ausentes: ${missingThresholds.join(", ") || "todos"}.`
    );
    return { classification: "REVIEW_REQUIRED", partialSeverity: null, missingThresholds, dimensions, reasons };
  }

  if (unconfiguredAdverse.length > 0) {
    reasons.unshift(
      `Dimensões com variação adversa sem limite configurado: ${unconfiguredAdverse.join(", ")}${partialSeverity ? ` (severidade parcial das dimensões configuradas: ${partialSeverity})` : ""}.`
    );
    return { classification: "REVIEW_REQUIRED", partialSeverity, missingThresholds: unconfiguredAdverse, dimensions, reasons };
  }

  const classification: ScheduleRiskClassification = partialSeverity ?? "REVIEW_REQUIRED";
  if (classification === "REVIEW_REQUIRED") {
    reasons.unshift("Nenhuma dimensão mensurável coberta pelos limites configurados.");
  } else if (classification === "LOW") {
    reasons.unshift("Todas as dimensões mensuráveis ficaram abaixo dos limites MEDIUM configurados.");
  }
  return { classification, partialSeverity, missingThresholds: [], dimensions, reasons };
}
