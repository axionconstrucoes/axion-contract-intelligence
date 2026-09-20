// Tipos puros da Curva S — fonte ESTRUTURADA para o Expert de
// Planejamento (não é "só um anexo"). Cada série carrega tipo e
// unidade explícitos: físico, financeiro, mão de obra e desembolso
// NUNCA se misturam numa mesma análise.

export type SCurveSeriesType =
  | "PHYSICAL_PLANNED"
  | "PHYSICAL_ACTUAL"
  | "PHYSICAL_FORECAST"
  | "PHYSICAL_RECOVERY"
  | "FINANCIAL_PLANNED"
  | "FINANCIAL_ACTUAL"
  | "FINANCIAL_FORECAST"
  | "LABOR"
  | "DISBURSEMENT"
  | "UNKNOWN";

export type SCurveUnit = "PERCENT" | "CURRENCY" | "HOURS" | "HEADCOUNT" | "UNKNOWN";

/** CUMULATIVE = acumulado (curva S clássica); PERIOD = produção do período. */
export type SCurveScale = "CUMULATIVE" | "PERIOD";

export interface SCurvePoint {
  /** Rótulo do período como veio da fonte (data ISO, "W37", "Semana 37"…) — nunca convertido. */
  period: string;
  /** Data ISO quando o período é uma data reconhecível; senão null. */
  date: string | null;
  value: number;
}

export interface SCurveSeries {
  type: SCurveSeriesType;
  unit: SCurveUnit;
  scale: SCurveScale;
  /** Cabeçalho original da fonte (auditoria). */
  sourceLabel: string;
  points: SCurvePoint[];
}

export interface SCurveSourceLocator {
  file: string;
  sheet?: string;
  headerRow?: number;
  range?: string;
  page?: number;
}

export interface SCurveExtraction {
  series: SCurveSeries[];
  cutoffDate: string | null;
  locator: SCurveSourceLocator;
  method: string;
  /** 0..1 */
  confidence: number;
  notes: string[];
}

export interface SCurveMetrics {
  cutoffPeriod: string | null;
  cutoffDate: string | null;
  plannedCumulative: number | null;
  actualCumulative: number | null;
  forecastCumulative: number | null;
  /** realizado − planejado, em PONTOS PERCENTUAIS (não variação percentual). */
  deviationPp: number | null;
  /** realizado ÷ planejado × 100. */
  fulfillmentPercent: number | null;
  plannedWeekProgress: number | null;
  actualWeekProgress: number | null;
  /** Média do avanço realizado por período nos últimos N períodos. */
  velocityPerPeriod: number | null;
  /** Desvio na semana anterior (quando houver histórico) e variação. */
  previousDeviationPp: number | null;
  deviationTrendPp: number | null;
  trend: "RECOVERY" | "AGGRAVATION" | "STABLE" | "UNKNOWN";
  /** Períodos consecutivos com desvio negativo até o corte. */
  negativeDeviationStreak: number;
  projectedCompletionPeriod: string | null;
  projectedCompletionNote: string | null;
  unit: SCurveUnit;
  seriesUsed: { planned: string | null; actual: string | null; forecast: string | null };
  warnings: string[];
}

export interface SCurveMppCrossCheck {
  mppProgressPercent: number | null;
  sCurveActualPercent: number | null;
  /** |Curva S − MPP| em p.p. */
  divergencePp: number | null;
  mppFinalDateSlipDays: number | null;
  mppOverdueCount: number | null;
  cutoffMatches: boolean | null;
  issues: Array<{ code: SCurveIssueCode; detail: string }>;
}

export type SCurveIssueCode =
  | "S_CURVE_MPP_PROGRESS_DIVERGENCE"
  | "PROGRESS_WITHOUT_ACTIVITIES"
  | "RECOVERY_WITH_FINAL_DATE_SLIP"
  | "CUTOFF_DATE_MISMATCH"
  | "POSSIBLE_OTHER_PROJECT_OR_WEEK"
  | "PHYSICAL_FINANCIAL_CONFUSION"
  | "LOW_CONFIDENCE";
