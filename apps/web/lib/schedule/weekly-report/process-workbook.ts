// Processamento PURO de uma planilha já lida (grids + relatório de
// segurança) => resultado por aba. Testável sem exceljs/Supabase.
//
// Regras: identificação tolerante (identify-sheets.ts); aba ausente =>
// MISSING_SHEET; duas candidatas => AMBIGUOUS_SHEET; mapeamento humano
// prévio (HUMAN_MAPPED) tem prioridade sobre a detecção automática;
// valores validados por humano (HUMAN_VALIDATED) são preservados e só
// as métricas são recalculadas.

import type { MppFactsForCrossCheck } from "../s-curve/analyze-s-curve";
import type { ScheduleRiskThreshold } from "../weekly-ingestion/types";
import { analyzeBaselineSheet, analyzeCurvaSSheet, analyzeFinancialSheet, analyzeHistogramSheet, analyzeSsmaSheet, routeSheetToExpert, type OfficialBaselineFacts } from "./analyze-sheets";
import { extractBaselineSheet, extractCurvaSSheet, extractFinancialSheet, extractHistogramSheet, extractSsmaSheet } from "./extract-sheets";
import { identifyWeeklyReportSheets } from "./identify-sheets";
import type {
  BaselineSheetData,
  CurvaSSheetData,
  ExtractedSheet,
  SheetGrid,
  WeeklyReportSheetCategory,
  WeeklyReportSheetData,
  WeeklyReportWorkbookResult,
  WorkbookSafetyReport,
  WorkbookSheetIndexEntry,
} from "./types";
import { WEEKLY_REPORT_SHEET_CATEGORIES } from "./types";

export interface WorkbookProcessingContext {
  fileName: string;
  workWeekLabel: string | null;
  thresholds: ScheduleRiskThreshold[];
  mppFacts: MppFactsForCrossCheck | null;
  officialBaseline: OfficialBaselineFacts | null;
  previousDeviationPp: number | null;
  previousBaselineSheet: BaselineSheetData | null;
  criticalActivityCount: number | null;
  /** Decisões humanas anteriores por categoria (mapeamento/validação) — preservadas. */
  humanDecisions: Partial<Record<WeeklyReportSheetCategory, { status: "HUMAN_MAPPED" | "HUMAN_VALIDATED"; sheetName: string | null; data: WeeklyReportSheetData | null; cutoffDate: string | null }>>;
}

const METHOD = "xlsx-stored-values-v1";

function emptySheet(category: WeeklyReportSheetCategory, fileName: string): ExtractedSheet {
  return {
    category,
    status: "MISSING_SHEET",
    originalSheetName: null,
    sheetIndex: null,
    candidateSheetNames: [],
    locator: { file: fileName, sheet: null, sheetIndex: null },
    extractionMethod: METHOD,
    confidence: null,
    data: {},
    cutoffDate: null,
    metrics: null,
    crossCheck: null,
    riskClassification: null,
    riskReasons: [],
    alerts: [{ code: "MISSING_SHEET", detail: "Aba não localizada no arquivo — mapeie manualmente ou confirme a ausência.", severity: "WARNING" }],
    expertId: routeSheetToExpert(category),
    errorMessage: null,
  };
}

export function processWorkbookGrids(input: { grids: SheetGrid[]; safety: WorkbookSafetyReport; sheetIndex: WorkbookSheetIndexEntry[] }, context: WorkbookProcessingContext): WeeklyReportWorkbookResult {
  const { grids, safety, sheetIndex } = input;
  const matches = identifyWeeklyReportSheets(sheetIndex);
  const gridByName = new Map(grids.map((grid) => [grid.name, grid]));

  const sheets: ExtractedSheet[] = [];
  // Passo 1: extrai dados brutos de cada aba (sem análise) para permitir cruzamentos.
  const raw: Partial<Record<WeeklyReportSheetCategory, { sheet: ExtractedSheet; data: WeeklyReportSheetData }>> = {};

  for (const category of WEEKLY_REPORT_SHEET_CATEGORIES) {
    const match = matches.find((item) => item.category === category)!;
    const human = context.humanDecisions[category];
    const sheet = emptySheet(category, context.fileName);
    sheet.candidateSheetNames = match.candidates.map((candidate) => candidate.name);

    let chosenName: string | null = null;
    if (human?.status === "HUMAN_VALIDATED" && human.data) {
      sheet.status = "HUMAN_VALIDATED";
      sheet.originalSheetName = human.sheetName;
      sheet.sheetIndex = sheetIndex.find((entry) => entry.name === human.sheetName)?.index ?? null;
      sheet.data = human.data;
      sheet.cutoffDate = human.cutoffDate;
      sheet.confidence = 1;
      sheet.alerts = [];
      sheet.extractionMethod = "human-validated-values";
      raw[category] = { sheet, data: human.data };
      sheets.push(sheet);
      continue;
    }
    if (human?.status === "HUMAN_MAPPED" && human.sheetName && gridByName.has(human.sheetName)) {
      chosenName = human.sheetName;
      sheet.extractionMethod = `${METHOD}+human-mapped`;
    } else if (match.status === "MATCHED") {
      chosenName = match.sheetName;
    } else if (match.status === "AMBIGUOUS_SHEET") {
      sheet.status = "AMBIGUOUS_SHEET";
      sheet.alerts = [{ code: "AMBIGUOUS_SHEET", detail: `Mais de uma aba pode corresponder a ${category}: ${match.candidates.map((candidate) => `"${candidate.name}"`).join(", ")}. Revisão humana necessária.`, severity: "WARNING" }];
      sheets.push(sheet);
      continue;
    } else {
      sheets.push(sheet);
      continue;
    }

    const grid = gridByName.get(chosenName!)!;
    sheet.originalSheetName = grid.name;
    sheet.sheetIndex = grid.index;
    sheet.alerts = [];
    try {
      const extraction =
        category === "CURVA_S"
          ? extractCurvaSSheet(grid, context.fileName)
          : category === "LINHA_BASE"
            ? extractBaselineSheet(grid, context.fileName)
            : category === "FINANCEIRO"
              ? extractFinancialSheet(grid, context.fileName)
              : category === "HISTOGRAMA"
                ? extractHistogramSheet(grid, context.fileName)
                : extractSsmaSheet(grid, context.fileName);
      if (!extraction) {
        sheet.status = "PENDING_HUMAN_REVIEW";
        sheet.alerts.push({ code: "TABLE_NOT_RECOGNIZED", detail: `Aba "${grid.name}" localizada, mas nenhuma tabela reconhecível pelos cabeçalhos — validação humana necessária.`, severity: "WARNING" });
      } else {
        sheet.status = extraction.confidence < 0.6 ? "PENDING_HUMAN_REVIEW" : "EXTRACTED";
        sheet.data = extraction.data as WeeklyReportSheetData;
        sheet.locator = extraction.locator;
        sheet.confidence = extraction.confidence;
        sheet.cutoffDate = "cutoffDate" in extraction.data ? (extraction.data as CurvaSSheetData).cutoffDate : null;
        for (const note of extraction.notes) sheet.alerts.push({ code: "EXTRACTION_NOTE", detail: note, severity: "INFO" });
        if (human?.status === "HUMAN_MAPPED") sheet.status = "HUMAN_MAPPED";
        raw[category] = { sheet, data: extraction.data as WeeklyReportSheetData };
      }
    } catch (error) {
      sheet.status = "FAILED";
      sheet.errorMessage = error instanceof Error ? error.message : String(error);
    }
    sheets.push(sheet);
  }

  // Passo 2: análises/cruzamentos com o que foi extraído.
  const curvaS = raw.CURVA_S?.data as CurvaSSheetData | undefined;
  const baseline = raw.LINHA_BASE?.data as BaselineSheetData | undefined;
  let physicalTrend: "RECOVERY" | "AGGRAVATION" | "STABLE" | "UNKNOWN" | null = null;
  let physicalDeviationPp: number | null = null;

  if (raw.CURVA_S && curvaS) {
    const confidence = raw.CURVA_S.sheet.confidence ?? 0;
    const analysis = analyzeCurvaSSheet(curvaS, {
      mppFacts: context.mppFacts,
      previousDeviationPp: context.previousDeviationPp,
      baselineSheet: baseline ?? null,
      extractionConfidence: confidence,
      thresholds: context.thresholds,
      workWeekLabel: context.workWeekLabel,
    });
    raw.CURVA_S.sheet.metrics = analysis.metrics;
    raw.CURVA_S.sheet.crossCheck = analysis.crossCheck;
    raw.CURVA_S.sheet.riskClassification = analysis.risk.classification;
    raw.CURVA_S.sheet.riskReasons = analysis.risk.reasons;
    raw.CURVA_S.sheet.alerts.push(...analysis.alerts);
    raw.CURVA_S.sheet.cutoffDate = analysis.metrics.cutoffDate ?? curvaS.cutoffDate;
    physicalTrend = analysis.metrics.trend;
    physicalDeviationPp = analysis.metrics.deviationPp;
  }
  if (raw.LINHA_BASE && baseline) {
    const analysis = analyzeBaselineSheet(baseline, { officialBaseline: context.officialBaseline, previousBaselineSheet: context.previousBaselineSheet, curvaS: curvaS ?? null, thresholds: context.thresholds });
    raw.LINHA_BASE.sheet.metrics = analysis.metrics;
    raw.LINHA_BASE.sheet.crossCheck = analysis.crossCheck;
    raw.LINHA_BASE.sheet.riskClassification = analysis.risk.classification;
    raw.LINHA_BASE.sheet.riskReasons = analysis.risk.reasons;
    raw.LINHA_BASE.sheet.alerts.push(...analysis.alerts);
  }
  if (raw.FINANCEIRO) {
    const analysis = analyzeFinancialSheet(raw.FINANCEIRO.data as Parameters<typeof analyzeFinancialSheet>[0], context.thresholds);
    raw.FINANCEIRO.sheet.metrics = analysis.metrics;
    raw.FINANCEIRO.sheet.riskClassification = analysis.risk.classification;
    raw.FINANCEIRO.sheet.riskReasons = analysis.risk.reasons;
    raw.FINANCEIRO.sheet.alerts.push(...analysis.alerts);
  }
  if (raw.HISTOGRAMA) {
    const analysis = analyzeHistogramSheet(raw.HISTOGRAMA.data as Parameters<typeof analyzeHistogramSheet>[0], { thresholds: context.thresholds, physicalTrend, physicalDeviationPp, criticalActivityCount: context.criticalActivityCount });
    raw.HISTOGRAMA.sheet.metrics = analysis.metrics;
    raw.HISTOGRAMA.sheet.crossCheck = analysis.crossCheck;
    raw.HISTOGRAMA.sheet.riskClassification = analysis.risk.classification;
    raw.HISTOGRAMA.sheet.riskReasons = analysis.risk.reasons;
    raw.HISTOGRAMA.sheet.alerts.push(...analysis.alerts);
  }
  if (raw.SSMA) {
    const analysis = analyzeSsmaSheet(raw.SSMA.data as Parameters<typeof analyzeSsmaSheet>[0]);
    raw.SSMA.sheet.metrics = analysis.metrics;
    raw.SSMA.sheet.riskClassification = analysis.risk.classification;
    raw.SSMA.sheet.riskReasons = analysis.risk.reasons;
    raw.SSMA.sheet.alerts.push(...analysis.alerts);
  }

  const extractedCount = sheets.filter((sheet) => sheet.status === "EXTRACTED" || sheet.status === "HUMAN_MAPPED" || sheet.status === "HUMAN_VALIDATED").length;
  const needsHuman = sheets.some((sheet) => sheet.status === "AMBIGUOUS_SHEET" || sheet.status === "PENDING_HUMAN_REVIEW");
  const status: WeeklyReportWorkbookResult["status"] = extractedCount === sheets.length ? "EXTRACTED" : needsHuman ? "PENDING_HUMAN_REVIEW" : extractedCount > 0 ? "PARTIAL" : "PENDING_HUMAN_REVIEW";

  return {
    status,
    detectedFormat: safety.detectedFormat,
    safety,
    sheetIndex,
    sheets,
    summary: {
      sheetsFound: sheets.filter((sheet) => sheet.originalSheetName).map((sheet) => `${sheet.category}=${sheet.originalSheetName}`),
      missing: sheets.filter((sheet) => sheet.status === "MISSING_SHEET").map((sheet) => sheet.category),
      ambiguous: sheets.filter((sheet) => sheet.status === "AMBIGUOUS_SHEET").map((sheet) => sheet.category),
      experts: Object.fromEntries(sheets.map((sheet) => [sheet.category, sheet.expertId])),
      consolidator: "ceo",
      curvaS: raw.CURVA_S?.sheet.metrics ? { deviationPp: (raw.CURVA_S.sheet.metrics as { deviationPp: number | null }).deviationPp, risk: raw.CURVA_S.sheet.riskClassification } : null,
    },
    errorMessage: null,
  };
}
