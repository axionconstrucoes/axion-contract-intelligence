// Extratores PUROS por aba do relatório semanal, sobre o SheetGrid já
// lido com valores armazenados (read-workbook.ts). Cada extrator mapeia
// somente colunas identificadas com segurança pelos cabeçalhos REAIS —
// nunca presume campos ausentes nem inventa valores. Toda saída carrega
// o locator (aba, índice, linha de cabeçalho, faixa, colunas) para
// auditoria.

import { classifySeriesHeader, parsePeriodLabel, toNumericValue } from "../s-curve/detect-s-curve";
import type { SCurvePoint, SCurveSeries } from "../s-curve/types";
import type {
  BaselineSheetData,
  BaselineSheetRow,
  CurvaSSheetData,
  FinancialColumnKey,
  FinancialSheetData,
  FinancialSheetRow,
  HistogramResourceType,
  HistogramSheetData,
  SheetCell,
  SheetGrid,
  SourceLocator,
  SsmaIndicator,
  SsmaSheetData,
} from "./types";

const MAX_HEADER_SCAN_ROWS = 40;

export function cellText(cell: SheetCell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  return String(cell.value).trim();
}

export function cellNumber(cell: SheetCell | undefined): number | null {
  if (!cell || cell.cachedValueMissing) return null; // fórmula sem valor armazenado => não disponível
  if (cell.value instanceof Date) return null;
  return toNumericValue(cell.value);
}

export function cellPeriod(cell: SheetCell | undefined): { period: string; date: string | null } | null {
  if (!cell || cell.value === null) return null;
  return parsePeriodLabel(cell.value);
}

export function columnLetter(index0: number): string {
  let n = index0 + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export interface HeaderMatcher<K extends string> {
  key: K;
  regex: RegExp;
  /** Regex que, se casar, exclui o cabeçalho deste key (ex.: "acumulado" em "previsto"). */
  exclude?: RegExp;
}

export interface HeaderMatch<K extends string> {
  headerRow: number;
  headers: string[];
  columns: Partial<Record<K, number>>;
  columnLabels: Partial<Record<K, string>>;
}

/** Procura a linha de cabeçalho que casa o maior número de matchers (>= minMatches). */
export function findHeaderRow<K extends string>(grid: SheetGrid, matchers: HeaderMatcher<K>[], minMatches: number): HeaderMatch<K> | null {
  let best: HeaderMatch<K> | null = null;
  const lastRow = Math.min(grid.rows.length, MAX_HEADER_SCAN_ROWS);
  for (let r = 0; r < lastRow; r += 1) {
    const row = grid.rows[r];
    const headers = row.map(cellText);
    if (headers.filter(Boolean).length < 2) continue;
    const columns: Partial<Record<K, number>> = {};
    const columnLabels: Partial<Record<K, string>> = {};
    headers.forEach((header, c) => {
      if (!header) return;
      for (const matcher of matchers) {
        if (columns[matcher.key] !== undefined) continue;
        if (matcher.regex.test(header) && !(matcher.exclude && matcher.exclude.test(header))) {
          columns[matcher.key] = c;
          columnLabels[matcher.key] = header;
          break;
        }
      }
    });
    const count = Object.keys(columns).length;
    if (count >= minMatches && (!best || count > Object.keys(best.columns).length)) {
      best = { headerRow: r, headers: headers.filter(Boolean), columns, columnLabels };
    }
  }
  return best;
}

/** Primeira coluna, à esquerda dos dados, cujas células abaixo do cabeçalho parecem períodos. */
export function findPeriodColumn(grid: SheetGrid, headerRow: number, headers: string[]): number | null {
  const row = grid.rows[headerRow];
  const byHeader = row.findIndex((cell) => /^(data|per[íi]odo|semana|week|m[êe]s|month|corte|date|dia)\b/i.test(cellText(cell)));
  if (byHeader >= 0) return byHeader;
  const width = Math.max(...grid.rows.slice(headerRow, headerRow + 5).map((r) => r.length), 0);
  for (let c = 0; c < width; c += 1) {
    const sample = grid.rows[headerRow + 1]?.[c];
    if (cellPeriod(sample)) return c;
  }
  void headers;
  return null;
}

function dataRows(grid: SheetGrid, headerRow: number): Array<{ r: number; cells: SheetCell[] }> {
  const out: Array<{ r: number; cells: SheetCell[] }> = [];
  let blank = 0;
  for (let r = headerRow + 1; r < grid.rows.length; r += 1) {
    const cells = grid.rows[r];
    const hasContent = cells.some((cell) => cellText(cell) !== "" || cell.cachedValueMissing);
    if (!hasContent) {
      blank += 1;
      if (blank >= 3) break;
      continue;
    }
    blank = 0;
    out.push({ r, cells });
  }
  return out;
}

function findCutoffDate(grid: SheetGrid): string | null {
  for (const row of grid.rows.slice(0, Math.min(grid.rows.length, 400))) {
    for (let c = 0; c < row.length; c += 1) {
      if (/corte|cut[\s_-]*off|status\s*date|data\s*base/i.test(cellText(row[c]))) {
        for (let k = c + 1; k < Math.min(row.length, c + 4); k += 1) {
          const period = cellPeriod(row[k]);
          if (period?.date) return period.date;
        }
        const inline = /(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/.exec(cellText(row[c]));
        if (inline) return parsePeriodLabel(inline[1])?.date ?? null;
      }
    }
  }
  return null;
}

function locatorFor(grid: SheetGrid, fileName: string, headerRow: number, lastRow: number, columns: number[]): SourceLocator {
  const maxCol = Math.max(0, ...columns);
  const minCol = Math.min(...columns, maxCol);
  return {
    file: fileName,
    sheet: grid.name,
    sheetIndex: grid.index,
    headerRow: headerRow + 1,
    range: `${columnLetter(minCol)}${headerRow + 1}:${columnLetter(maxCol)}${lastRow + 1}`,
  };
}

// ------------------------------------------------------------------
// CURVA S
// ------------------------------------------------------------------

export interface SheetExtraction<T> {
  data: T;
  locator: SourceLocator;
  confidence: number;
  notes: string[];
}

export function extractCurvaSSheet(grid: SheetGrid, fileName: string): SheetExtraction<CurvaSSheetData> | null {
  const lastRow = Math.min(grid.rows.length, MAX_HEADER_SCAN_ROWS);
  let best: { r: number; series: Array<{ c: number; label: string }>; periodColumn: number } | null = null;
  for (let r = 0; r < lastRow; r += 1) {
    const row = grid.rows[r];
    const labels = row.map((cell, c) => ({ c, label: cellText(cell) })).filter((item) => item.label);
    if (labels.length < 3) continue;
    const series = labels.filter((item) => classifySeriesHeader(item.label).type !== "UNKNOWN");
    if (series.length < 2) continue;
    const periodColumn = findPeriodColumn(grid, r, labels.map((item) => item.label));
    if (periodColumn === null || series.some((item) => item.c === periodColumn)) continue;
    if (!best || series.length > best.series.length) best = { r, series, periodColumn };
  }
  if (!best) return null;

  const notes: string[] = [];
  const series: SCurveSeries[] = best.series.map((item) => {
    const classification = classifySeriesHeader(item.label);
    return { type: classification.type, unit: classification.unit, scale: classification.scale, sourceLabel: item.label, points: [] as SCurvePoint[] };
  });
  let last = best.r;
  let missing = 0;
  for (const { r, cells } of dataRows(grid, best.r)) {
    const period = cellPeriod(cells[best.periodColumn]);
    if (!period) continue;
    last = r;
    best.series.forEach((item, index) => {
      const cell = cells[item.c];
      if (cell?.cachedValueMissing) missing += 1;
      const value = cellNumber(cell);
      if (value !== null) series[index].points.push({ period: period.period, date: period.date, value });
    });
  }
  const usable = series.filter((item) => item.points.length >= 2);
  if (usable.length < 2) return null;
  if (missing > 0) notes.push(`${missing} célula(s) com fórmula sem valor armazenado ignorada(s) (não disponíveis).`);

  const hasPhysicalPair = usable.some((item) => item.type === "PHYSICAL_PLANNED") && usable.some((item) => item.type === "PHYSICAL_ACTUAL");
  if (!hasPhysicalPair) notes.push("Par físico Previsto/Realizado não encontrado nesta aba.");
  const cutoffDate = findCutoffDate(grid);
  const confidence = Math.min(1, 0.5 + (hasPhysicalPair ? 0.35 : 0.1) + (cutoffDate ? 0.05 : 0) + (usable.length >= 3 ? 0.05 : 0) + 0.05);
  return {
    data: { series: usable, cutoffDate, headers: best.series.map((item) => item.label) },
    locator: { ...locatorFor(grid, fileName, best.r, last, [best.periodColumn, ...best.series.map((item) => item.c)]), columns: Object.fromEntries(best.series.map((item) => [item.label, columnLetter(item.c)])) },
    confidence: Math.round(confidence * 100) / 100,
    notes,
  };
}

// ------------------------------------------------------------------
// LINHA DE BASE (WEEKLY_REPORT_BASELINE_SHEET)
// ------------------------------------------------------------------

type BaselineKey = "label" | "plannedStart" | "plannedEnd" | "plannedPercent" | "milestone";
const BASELINE_MATCHERS: HeaderMatcher<BaselineKey>[] = [
  { key: "label", regex: /^(atividade|tarefa|marco|descri[çc][ãa]o|item|wbs|nome|activity|task|milestone|name)/i },
  { key: "plannedStart", regex: /in[íi]cio|start|come[çc]o/i, exclude: /real|actual/i },
  { key: "plannedEnd", regex: /t[ée]rmino|fim|end|finish|conclus[ãa]o|data\s*(planejada|prevista|base)/i, exclude: /real|actual/i },
  { key: "plannedPercent", regex: /(%|percent|avan[çc]o).*(previst|planej|base)|(previst|planej|base).*(%|percent|avan[çc]o)|^previsto|^planejado|^baseline/i, exclude: /realiz|actual/i },
  { key: "milestone", regex: /^marco|milestone|tipo/i },
];

export function extractBaselineSheet(grid: SheetGrid, fileName: string): SheetExtraction<BaselineSheetData> | null {
  const header = findHeaderRow(grid, BASELINE_MATCHERS, 1);
  const notes: string[] = [];
  const rows: BaselineSheetRow[] = [];
  let plannedSeries: SCurveSeries | null = null;
  let locator: SourceLocator | null = null;

  if (header && header.columns.label !== undefined && (header.columns.plannedEnd !== undefined || header.columns.plannedStart !== undefined)) {
    let last = header.headerRow;
    for (const { r, cells } of dataRows(grid, header.headerRow)) {
      const label = cellText(cells[header.columns.label]);
      if (!label) continue;
      last = r;
      const start = header.columns.plannedStart !== undefined ? cellPeriod(cells[header.columns.plannedStart]) : null;
      const end = header.columns.plannedEnd !== undefined ? cellPeriod(cells[header.columns.plannedEnd]) : null;
      const percent = header.columns.plannedPercent !== undefined ? cellNumber(cells[header.columns.plannedPercent]) : null;
      const milestoneText = header.columns.milestone !== undefined ? cellText(cells[header.columns.milestone]) : "";
      rows.push({
        label,
        plannedStart: start?.date ?? null,
        plannedEnd: end?.date ?? null,
        plannedPercent: percent,
        period: null,
        isMilestone: /marco|milestone|sim|x|true/i.test(milestoneText) || /\bmarco\b/i.test(label),
      });
    }
    locator = locatorFor(grid, fileName, header.headerRow, last, Object.values(header.columns) as number[]);
  }

  // Alternativa/complemento: série planejada acumulada por período.
  const periodHeader = findHeaderRow(grid, [{ key: "plannedPercent", regex: /previst|planej|baseline|base/i, exclude: /realiz|actual/i }], 1);
  if (periodHeader && periodHeader.columns.plannedPercent !== undefined) {
    const periodColumn = findPeriodColumn(grid, periodHeader.headerRow, periodHeader.headers);
    if (periodColumn !== null && periodColumn !== periodHeader.columns.plannedPercent) {
      const points: SCurvePoint[] = [];
      let last = periodHeader.headerRow;
      for (const { r, cells } of dataRows(grid, periodHeader.headerRow)) {
        const period = cellPeriod(cells[periodColumn]);
        const value = cellNumber(cells[periodHeader.columns.plannedPercent]);
        if (period && value !== null) {
          points.push({ period: period.period, date: period.date, value });
          last = r;
        }
      }
      if (points.length >= 2) {
        const label = periodHeader.columnLabels.plannedPercent ?? "Planejado";
        const classification = classifySeriesHeader(label);
        plannedSeries = { type: "PHYSICAL_PLANNED", unit: classification.unit === "UNKNOWN" ? "PERCENT" : classification.unit, scale: classification.scale, sourceLabel: label, points };
        locator = locator ?? locatorFor(grid, fileName, periodHeader.headerRow, last, [periodColumn, periodHeader.columns.plannedPercent]);
      }
    }
  }

  if (rows.length === 0 && !plannedSeries) return null;
  const finalPlannedDate = rows.reduce<string | null>((max, row) => (row.plannedEnd && (!max || row.plannedEnd > max) ? row.plannedEnd : max), null);
  if (rows.length > 0 && !finalPlannedDate) notes.push("Tabela de atividades sem datas de término reconhecíveis.");
  return {
    data: { kind: "WEEKLY_REPORT_BASELINE_SHEET", rows, plannedSeries, finalPlannedDate, headers: header?.headers ?? periodHeader?.headers ?? [] },
    locator: locator!,
    confidence: Math.round(Math.min(1, 0.55 + (rows.length > 0 ? 0.25 : 0) + (plannedSeries ? 0.15 : 0)) * 100) / 100,
    notes,
  };
}

// ------------------------------------------------------------------
// FINANCEIRO
// ------------------------------------------------------------------

const FINANCIAL_MATCHERS: HeaderMatcher<FinancialColumnKey>[] = [
  { key: "acumulado_previsto", regex: /acumulad.*(previst|planej|or[çc]ad|budget)|(previst|planej|or[çc]ad|budget).*acumulad/i },
  { key: "acumulado_realizado", regex: /acumulad.*(realiz|actual|executad)|(realiz|actual|executad).*acumulad/i },
  { key: "previsto", regex: /previst|planejad|or[çc]ad|budget|planned/i, exclude: /acumulad|varia|desvio/i },
  { key: "realizado", regex: /realizad|actual|executad/i, exclude: /acumulad|varia|desvio|medi|fatur|receb/i },
  { key: "medido", regex: /medid|medi[çc][ãa]o|measured/i },
  { key: "faturado", regex: /fatur|invoic|billed/i },
  { key: "recebido", regex: /receb|received|collected/i },
  { key: "custo", regex: /custo|cost/i },
  { key: "receita", regex: /receita|revenue/i },
  { key: "desembolso", regex: /desembols|cash[\s_-]*flow|disburse/i },
  { key: "variacao", regex: /varia[çc][ãa]o|desvio|variance/i },
];

export function extractFinancialSheet(grid: SheetGrid, fileName: string): SheetExtraction<FinancialSheetData> | null {
  const header = findHeaderRow(grid, FINANCIAL_MATCHERS, 1);
  if (!header) return null;
  const periodColumn = findPeriodColumn(grid, header.headerRow, header.headers);
  if (periodColumn === null) return null;
  const notes: string[] = [];
  const rows: FinancialSheetData["rows"] = [];
  let last = header.headerRow;
  let missing = 0;
  for (const { r, cells } of dataRows(grid, header.headerRow)) {
    const period = cellPeriod(cells[periodColumn]);
    if (!period) continue;
    last = r;
    const values: FinancialSheetRow["values"] = {};
    for (const [key, column] of Object.entries(header.columns) as Array<[FinancialColumnKey, number]>) {
      if (column === periodColumn) continue;
      const cell = cells[column];
      if (cell?.cachedValueMissing) missing += 1;
      values[key] = cellNumber(cell);
    }
    rows.push({ period: period.period, date: period.date, values });
  }
  if (rows.length === 0) return null;
  if (missing > 0) notes.push(`${missing} célula(s) com fórmula sem valor armazenado (não disponíveis).`);
  const headerText = header.headers.join(" ");
  const unit: FinancialSheetData["unit"] = /r\$|us\$|\$|brl|usd|reais|mil|valor/i.test(headerText) ? "CURRENCY" : /%|percent/i.test(headerText) ? "PERCENT" : "UNKNOWN";
  if (unit === "PERCENT") notes.push("Cabeçalhos financeiros em percentual — mantidos separados do avanço físico.");
  return {
    data: { unit, columns: header.columnLabels, rows, headers: header.headers },
    locator: { ...locatorFor(grid, fileName, header.headerRow, last, [periodColumn, ...(Object.values(header.columns) as number[])]), columns: Object.fromEntries(Object.entries(header.columns).map(([key, c]) => [key, columnLetter(c as number)])) },
    confidence: Math.round(Math.min(1, 0.5 + Math.min(0.4, Object.keys(header.columns).length * 0.1) + (unit !== "UNKNOWN" ? 0.1 : 0)) * 100) / 100,
    notes,
  };
}

// ------------------------------------------------------------------
// HISTOGRAMA
// ------------------------------------------------------------------

type HistogramKey = "category" | "planned" | "actual" | "quantity" | "unit";
const HISTOGRAM_MATCHERS: HeaderMatcher<HistogramKey>[] = [
  { key: "category", regex: /categoria|fun[çc][ãa]o|recurso|equipe|equipamento|descri[çc][ãa]o|cargo|especialidade|resource|trade/i },
  { key: "planned", regex: /previst|planejad|planned|programad/i },
  { key: "actual", regex: /realizad|actual|efetivo\s*real|mobilizad/i },
  { key: "quantity", regex: /quantidade|qtd|qty|total|efetivo|headcount/i, exclude: /previst|planej|realiz|actual/i },
  { key: "unit", regex: /unidade|unid|un\.|unit/i },
];

function inferResourceType(texts: string[]): { type: HistogramResourceType; evidence: string | null } {
  const joined = texts.join(" | ");
  const labor = /m[ãa]o[\s_-]*de[\s_-]*obra|efetivo|\bhh\b|homem[\s_-]*hora|headcount|manpower|workforce|oper[áa]rio|pedreiro|soldador|encarregado|colaborador|pessoas/i.exec(joined);
  if (labor) return { type: "LABOR", evidence: labor[0] };
  const equipment = /equipamento|m[áa]quina|guindaste|escavadeira|caminh[ãa]o|grua|betoneira|equipment/i.exec(joined);
  if (equipment) return { type: "EQUIPMENT", evidence: equipment[0] };
  const teams = /\bequipe|\bfrente|\bteam|\bcrew/i.exec(joined);
  if (teams) return { type: "TEAMS", evidence: teams[0] };
  return { type: "UNKNOWN", evidence: null };
}

export function extractHistogramSheet(grid: SheetGrid, fileName: string): SheetExtraction<HistogramSheetData> | null {
  const header = findHeaderRow(grid, HISTOGRAM_MATCHERS, 1);
  if (!header) return null;
  const periodColumn = findPeriodColumn(grid, header.headerRow, header.headers);
  const hasPlannedOrActual = header.columns.planned !== undefined || header.columns.actual !== undefined || header.columns.quantity !== undefined;
  if (!hasPlannedOrActual) return null;
  const rows: HistogramSheetData["rows"] = [];
  const notes: string[] = [];
  let last = header.headerRow;
  const unitsSeen = new Set<string>();
  for (const { r, cells } of dataRows(grid, header.headerRow)) {
    const period = periodColumn !== null ? cellPeriod(cells[periodColumn]) : null;
    const category = header.columns.category !== undefined ? cellText(cells[header.columns.category]) || null : null;
    if (!period && !category) continue;
    last = r;
    const unit = header.columns.unit !== undefined ? cellText(cells[header.columns.unit]) : "";
    if (unit) unitsSeen.add(unit);
    rows.push({
      period: period?.period ?? "",
      date: period?.date ?? null,
      category,
      planned: header.columns.planned !== undefined ? cellNumber(cells[header.columns.planned]) : null,
      actual: header.columns.actual !== undefined ? cellNumber(cells[header.columns.actual]) : null,
      quantity: header.columns.quantity !== undefined ? cellNumber(cells[header.columns.quantity]) : null,
    });
  }
  if (rows.length === 0) return null;
  const resource = inferResourceType([grid.name, ...header.headers, ...rows.map((row) => row.category ?? ""), ...unitsSeen]);
  if (resource.type === "UNKNOWN") notes.push("Tipo de recurso não identificado pelos cabeçalhos/unidades — não presumido como mão de obra.");
  return {
    data: { resourceType: resource.type, resourceEvidence: resource.evidence, unit: unitsSeen.size === 1 ? [...unitsSeen][0] : unitsSeen.size > 1 ? "mista" : null, rows, headers: header.headers },
    locator: { ...locatorFor(grid, fileName, header.headerRow, last, [periodColumn ?? 0, ...(Object.values(header.columns) as number[])]), columns: Object.fromEntries(Object.entries(header.columns).map(([key, c]) => [key, columnLetter(c as number)])) },
    confidence: Math.round(Math.min(1, 0.5 + (header.columns.planned !== undefined && header.columns.actual !== undefined ? 0.3 : 0.1) + (resource.type !== "UNKNOWN" ? 0.1 : 0) + (periodColumn !== null ? 0.1 : 0)) * 100) / 100,
    notes,
  };
}

// ------------------------------------------------------------------
// SSMA
// ------------------------------------------------------------------

const SSMA_INDICATORS: Array<{ key: string; regex: RegExp }> = [
  { key: "horas_trabalhadas", regex: /horas?[\s_-]*trabalhad|hht|man[\s_-]*hours|\bhh\b/i },
  { key: "efetivo", regex: /efetivo|headcount|manpower/i },
  { key: "quase_acidentes", regex: /quase[\s_-]*acidente|near[\s_-]*miss/i },
  { key: "acidentes_com_afastamento", regex: /acidente.*(com|c\/)\s*afast|lti|lost[\s_-]*time/i },
  { key: "acidentes_sem_afastamento", regex: /acidente.*(sem|s\/)\s*afast|mtc|medical/i },
  { key: "acidentes", regex: /acidente|accident/i },
  { key: "incidentes", regex: /incidente|incident/i },
  { key: "desvios", regex: /desvio|deviation|n[ãa]o[\s_-]*conformidade|unsafe/i },
  { key: "treinamentos", regex: /treinamento|training|dds|capacita/i },
  { key: "inspecoes", regex: /inspe[çc][ãa]o|inspection|auditoria/i },
  { key: "acoes_abertas", regex: /a[çc][õo]es?\s*(abertas?|pendentes?)|open\s*actions/i },
  { key: "acoes_concluidas", regex: /a[çc][õo]es?\s*(conclu[íi]das?|fechadas?)|closed\s*actions/i },
  { key: "residuos", regex: /res[íi]duo|waste/i },
  { key: "agua", regex: /[áa]gua|water/i },
  { key: "energia", regex: /energia|energy/i },
  { key: "emissoes", regex: /emiss|co2|carbon/i },
  { key: "ocorrencias_ambientais", regex: /ambiental|environment/i },
];

export function extractSsmaSheet(grid: SheetGrid, fileName: string): SheetExtraction<SsmaSheetData> | null {
  // Layout A: indicadores em colunas × períodos em linhas.
  const lastScan = Math.min(grid.rows.length, MAX_HEADER_SCAN_ROWS);
  let best: { r: number; hits: Array<{ c: number; key: string; label: string }> } | null = null;
  for (let r = 0; r < lastScan; r += 1) {
    const hits: Array<{ c: number; key: string; label: string }> = [];
    grid.rows[r].forEach((cell, c) => {
      const label = cellText(cell);
      if (!label) return;
      const indicator = SSMA_INDICATORS.find((item) => item.regex.test(label));
      if (indicator && !hits.some((hit) => hit.key === indicator.key)) hits.push({ c, key: indicator.key, label });
    });
    if (hits.length >= 2 && (!best || hits.length > best.hits.length)) best = { r, hits };
  }
  const notes: string[] = [];
  if (best) {
    const periodColumn = findPeriodColumn(grid, best.r, []);
    const indicators: SsmaIndicator[] = best.hits.map((hit) => ({ key: hit.key, label: hit.label, unit: /hora|hh/i.test(hit.label) ? "h" : /%/.test(hit.label) ? "%" : null, values: [] }));
    let last = best.r;
    for (const { r, cells } of dataRows(grid, best.r)) {
      const period = periodColumn !== null ? cellPeriod(cells[periodColumn]) : null;
      const label = period?.period ?? cellText(cells[0]);
      if (!label) continue;
      last = r;
      best.hits.forEach((hit, index) => indicators[index].values.push({ period: label, date: period?.date ?? null, value: cellNumber(cells[hit.c]) }));
    }
    return {
      data: { indicators, headers: grid.rows[best.r].map(cellText).filter(Boolean) },
      locator: { ...locatorFor(grid, fileName, best.r, last, [periodColumn ?? 0, ...best.hits.map((hit) => hit.c)]), columns: Object.fromEntries(best.hits.map((hit) => [hit.key, columnLetter(hit.c)])) },
      confidence: Math.round(Math.min(1, 0.5 + Math.min(0.4, best.hits.length * 0.08) + (periodColumn !== null ? 0.1 : 0)) * 100) / 100,
      notes,
    };
  }

  // Layout B: indicador por linha (rótulo na 1ª coluna, valor na 2ª).
  const indicators: SsmaIndicator[] = [];
  let first = -1;
  let last = -1;
  grid.rows.forEach((row, r) => {
    const label = cellText(row[0]);
    const indicator = label ? SSMA_INDICATORS.find((item) => item.regex.test(label)) : undefined;
    if (!indicator) return;
    const value = cellNumber(row.slice(1).find((cell) => cellNumber(cell) !== null));
    indicators.push({ key: indicator.key, label, unit: null, values: [{ period: "acumulado", date: null, value }] });
    if (first < 0) first = r;
    last = r;
  });
  if (indicators.length < 2) return null;
  notes.push("Layout indicador-por-linha (sem série temporal).");
  return {
    data: { indicators, headers: indicators.map((item) => item.label) },
    locator: locatorFor(grid, fileName, first, last, [0, 1]),
    confidence: 0.6,
    notes,
  };
}
