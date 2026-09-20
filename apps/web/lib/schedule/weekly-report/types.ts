// Tipos puros do RELATÓRIO SEMANAL EM EXCEL (anexo classificado
// RELATORIO_SEMANAL_PLANEJAMENTO). A planilha é UMA unidade documental;
// as abas Curva S / Linha de Base / Financeiro / Histograma / SSMA são
// componentes extraídos — nunca documentos independentes. A Curva S vem
// EXCLUSIVAMENTE desta planilha (PDF/imagem nunca são fonte).

import type { ExpertId } from "../../ai/types";
import type { ScheduleRiskClassification } from "../weekly-ingestion/types";
import type { SCurveMetrics, SCurveMppCrossCheck, SCurveSeries } from "../s-curve/types";

export type WeeklyReportSheetCategory = "CURVA_S" | "LINHA_BASE" | "FINANCEIRO" | "HISTOGRAMA" | "SSMA";

export const WEEKLY_REPORT_SHEET_CATEGORIES: WeeklyReportSheetCategory[] = ["CURVA_S", "LINHA_BASE", "FINANCEIRO", "HISTOGRAMA", "SSMA"];

export type WeeklyReportWorkbookStatus =
  | "EXTRACTED"
  | "PARTIAL"
  | "PENDING_HUMAN_REVIEW"
  | "LEGACY_FORMAT_REVIEW_REQUIRED"
  | "INVALID_FILE"
  | "FAILED";

export type WeeklyReportSheetStatus =
  | "EXTRACTED"
  | "MISSING_SHEET"
  | "AMBIGUOUS_SHEET"
  | "PENDING_HUMAN_REVIEW"
  | "HUMAN_MAPPED"
  | "HUMAN_VALIDATED"
  | "FAILED";

/** Célula lida com valores ARMAZENADOS — nunca recalculada. */
export interface SheetCell {
  address: string;
  /** Valor armazenado (fórmulas: o resultado cached; sem cached => null). */
  value: string | number | Date | boolean | null;
  /** Texto da fórmula, preservado como evidência (nunca executada). */
  formula: string | null;
  /** true quando há fórmula sem valor calculado armazenado — valor "não disponível". */
  cachedValueMissing: boolean;
}

export interface SheetGrid {
  /** Nome ORIGINAL da aba. */
  name: string;
  /** Índice da aba no arquivo (0-based). */
  index: number;
  rows: SheetCell[][];
  /** Aba oculta no arquivo (informativo). */
  hidden: boolean;
}

export interface WorkbookSafetyReport {
  detectedFormat: "XLSX" | "XLS_LEGACY" | "UNKNOWN";
  signatureValid: boolean;
  extensionValid: boolean;
  mimeValid: boolean;
  sizeValid: boolean;
  /** Presença de macro (vbaProject) no pacote — detectada e IGNORADA. */
  macrosDetected: boolean;
  /** Links externos/conexões de dados detectados no pacote — nunca seguidos. */
  externalLinksDetected: number;
  dataConnectionsDetected: number;
  /** Fórmulas sem valor armazenado (marcadas como não disponíveis). */
  formulasWithoutCachedValue: number;
  formulasPreserved: number;
  notes: string[];
}

export interface WorkbookSheetIndexEntry {
  index: number;
  name: string;
  hidden: boolean;
  rowCount: number;
}

export interface SheetMatch {
  category: WeeklyReportSheetCategory;
  status: "MATCHED" | "MISSING_SHEET" | "AMBIGUOUS_SHEET";
  /** Aba escolhida (só quando MATCHED). */
  sheetName: string | null;
  sheetIndex: number | null;
  /** Todas as abas candidatas (>= 2 quando ambíguo). */
  candidates: Array<{ name: string; index: number; rule: string }>;
}

export interface SourceLocator {
  file: string;
  sheet: string | null;
  sheetIndex: number | null;
  headerRow?: number;
  range?: string;
  columns?: Record<string, string>;
}

// ---- Dados por categoria ------------------------------------------

export interface CurvaSSheetData {
  series: SCurveSeries[];
  cutoffDate: string | null;
  headers: string[];
}

export interface BaselineSheetRow {
  label: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedPercent: number | null;
  period: string | null;
  isMilestone: boolean;
}

/** WEEKLY_REPORT_BASELINE_SHEET — nunca a OFFICIAL_SCHEDULE_BASELINE do MPP. */
export interface BaselineSheetData {
  kind: "WEEKLY_REPORT_BASELINE_SHEET";
  rows: BaselineSheetRow[];
  plannedSeries: SCurveSeries | null;
  finalPlannedDate: string | null;
  headers: string[];
}

export type FinancialColumnKey =
  | "previsto"
  | "realizado"
  | "acumulado_previsto"
  | "acumulado_realizado"
  | "medido"
  | "faturado"
  | "recebido"
  | "custo"
  | "receita"
  | "desembolso"
  | "variacao";

export interface FinancialSheetRow {
  period: string;
  date: string | null;
  values: Partial<Record<FinancialColumnKey, number | null>>;
}

export interface FinancialSheetData {
  unit: "CURRENCY" | "PERCENT" | "UNKNOWN";
  columns: Partial<Record<FinancialColumnKey, string>>;
  rows: FinancialSheetRow[];
  headers: string[];
}

export type HistogramResourceType = "LABOR" | "EQUIPMENT" | "TEAMS" | "OTHER" | "UNKNOWN";

export interface HistogramSheetRow {
  period: string;
  date: string | null;
  category: string | null;
  planned: number | null;
  actual: number | null;
  quantity: number | null;
}

export interface HistogramSheetData {
  resourceType: HistogramResourceType;
  resourceEvidence: string | null;
  unit: string | null;
  rows: HistogramSheetRow[];
  headers: string[];
}

export interface SsmaIndicator {
  key: string;
  /** Cabeçalho ORIGINAL. */
  label: string;
  unit: string | null;
  values: Array<{ period: string; date: string | null; value: number | null }>;
}

export interface SsmaSheetData {
  indicators: SsmaIndicator[];
  headers: string[];
}

export type WeeklyReportSheetData = CurvaSSheetData | BaselineSheetData | FinancialSheetData | HistogramSheetData | SsmaSheetData;

export interface SheetAlert {
  code: string;
  detail: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
}

export interface ExtractedSheet {
  category: WeeklyReportSheetCategory;
  status: WeeklyReportSheetStatus;
  originalSheetName: string | null;
  sheetIndex: number | null;
  candidateSheetNames: string[];
  locator: SourceLocator;
  extractionMethod: string;
  confidence: number | null;
  data: WeeklyReportSheetData | Record<string, never>;
  cutoffDate: string | null;
  metrics: unknown | null;
  crossCheck: unknown | null;
  riskClassification: ScheduleRiskClassification | null;
  riskReasons: string[];
  alerts: SheetAlert[];
  expertId: ExpertId;
  errorMessage: string | null;
}

export interface CurvaSSheetMetrics extends SCurveMetrics {
  mppCrossCheck: SCurveMppCrossCheck | null;
}

export interface WeeklyReportWorkbookResult {
  status: WeeklyReportWorkbookStatus;
  detectedFormat: WorkbookSafetyReport["detectedFormat"];
  safety: WorkbookSafetyReport;
  sheetIndex: WorkbookSheetIndexEntry[];
  sheets: ExtractedSheet[];
  summary: Record<string, unknown>;
  errorMessage: string | null;
}
