// Identificação DETERMINÍSTICA e tolerante das abas do relatório
// semanal (caixa, acentos, espaços, hífen, underscore, pequenas
// variações). Pura. Nunca inventa correspondência: sem candidata =>
// MISSING_SHEET; duas ou mais candidatas para a mesma categoria =>
// AMBIGUOUS_SHEET (revisão humana). Nomes/índices originais preservados.

import type { SheetMatch, WeeklyReportSheetCategory, WorkbookSheetIndexEntry } from "./types";
import { WEEKLY_REPORT_SHEET_CATEGORIES } from "./types";

/** Minúsculas, sem acentos, sem espaços/hífens/underscores/pontuação. */
export function normalizeSheetName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

interface SheetRule {
  category: WeeklyReportSheetCategory;
  /** Comparado com o nome normalizado. */
  patterns: Array<{ regex: RegExp; rule: string; exact?: boolean }>;
}

const RULES: SheetRule[] = [
  {
    category: "CURVA_S",
    patterns: [
      { regex: /^curvas$/, rule: "Curva S", exact: true },
      { regex: /^curvasfisica$|^curvasfisico$|^scurve$|^curvasavancofisico$/, rule: "Curva S física / S-Curve", exact: true },
      { regex: /^curvas(?!fin|financ)/, rule: "começa com Curva S (não financeira)" },
    ],
  },
  {
    category: "LINHA_BASE",
    patterns: [
      { regex: /^linhadebase$|^linhabase$|^baseline$|^baseline$|^linhadebaselinha$/, rule: "Linha de Base / Baseline", exact: true },
      { regex: /^baseline|^linhadebase|^linhabase/, rule: "começa com Linha de Base / Baseline" },
    ],
  },
  {
    category: "FINANCEIRO",
    patterns: [
      { regex: /^financeiro$|^curvafinanceira$|^avancofinanceiro$|^financial$|^curvasfinanceira$/, rule: "Financeiro / Curva Financeira / Financial", exact: true },
      { regex: /^financ|^curvafinanc|^avancofinanc|^curvasfinanc/, rule: "começa com Financeiro/Financial" },
    ],
  },
  {
    category: "HISTOGRAMA",
    patterns: [
      { regex: /^histograma$|^histogramademaodeobra$|^maodeobra$|^efetivo$|^workforce$|^histogram$/, rule: "Histograma / Mão de Obra / Efetivo / Workforce", exact: true },
      { regex: /^histograma|^histogram|^maodeobra|^efetivo|^workforce|^manpower/, rule: "começa com Histograma/Mão de Obra/Efetivo" },
    ],
  },
  {
    category: "SSMA",
    patterns: [
      { regex: /^ssma$|^esg$|^seguranca$|^segurancaemeioambiente$|^hse$|^ehs$|^sms$|^ssmaesg$/, rule: "SSMA / ESG / Segurança / HSE / EHS", exact: true },
      { regex: /^ssma|^esg|^seguranca|^hse|^ehs/, rule: "começa com SSMA/ESG/Segurança/HSE" },
    ],
  },
];

export function identifyWeeklyReportSheets(sheets: Array<Pick<WorkbookSheetIndexEntry, "name" | "index">>): SheetMatch[] {
  const normalized = sheets.map((sheet) => ({ ...sheet, key: normalizeSheetName(sheet.name) }));

  return WEEKLY_REPORT_SHEET_CATEGORIES.map((category) => {
    const rule = RULES.find((item) => item.category === category)!;
    const candidates: SheetMatch["candidates"] = [];
    for (const sheet of normalized) {
      const hit = rule.patterns.find((pattern) => pattern.regex.test(sheet.key));
      if (hit) candidates.push({ name: sheet.name, index: sheet.index, rule: hit.rule });
    }

    if (candidates.length === 0) return { category, status: "MISSING_SHEET", sheetName: null, sheetIndex: null, candidates };

    // Preferência por correspondência EXATA única; várias exatas ou várias
    // parciais sem exata => ambíguo (nunca escolhe sozinho).
    const exact = candidates.filter((candidate) => rule.patterns.some((pattern) => pattern.exact && pattern.regex.test(normalizeSheetName(candidate.name))));
    const chosen = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
    if (!chosen) return { category, status: "AMBIGUOUS_SHEET", sheetName: null, sheetIndex: null, candidates };
    return { category, status: "MATCHED", sheetName: chosen.name, sheetIndex: chosen.index, candidates };
  });
}
