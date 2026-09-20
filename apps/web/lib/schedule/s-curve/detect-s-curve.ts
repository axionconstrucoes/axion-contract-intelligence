// Identificação determinística da Curva S e tipagem de séries por
// cabeçalho — puro. Nunca "adivinha": um cabeçalho sem sinal claro vira
// UNKNOWN e a série é ignorada nos cálculos (reportada nas notas).

import type { SCurveSeriesType, SCurveUnit } from "./types";

const S_CURVE_SIGNALS: Array<{ regex: RegExp; label: string }> = [
  // (?=$|[^a-z]) em vez de \b: "_" conta como caractere de palavra e
  // "Curva_S_W37.xlsx" precisa casar.
  { regex: /curva[\s_-]*s(?=$|[^a-z])/i, label: "Curva S" },
  { regex: /(?:^|[^a-z])s[\s_-]*curve(?=$|[^a-z])/i, label: "S-Curve" },
  { regex: /avan[çc]o[\s_-]*f[íi]sico/i, label: "avanço físico" },
  { regex: /progresso[\s_-]*acumulado/i, label: "progresso acumulado" },
  { regex: /\bplanned\b/i, label: "Planned" },
  { regex: /\bactual\b/i, label: "Actual" },
  { regex: /\bprevisto\b/i, label: "Previsto" },
  { regex: /\brealizado\b/i, label: "Realizado" },
  { regex: /\bforecast\b|\bprojetado\b|\btend[êe]ncia\b/i, label: "Forecast/Projetado" },
];

export function detectSCurveSignals(texts: string[]): { isSCurve: boolean; signals: string[]; score: number } {
  const joined = texts.join(" \n ");
  const signals = S_CURVE_SIGNALS.filter((signal) => signal.regex.test(joined)).map((signal) => signal.label);
  const hasName = signals.includes("Curva S") || signals.includes("S-Curve");
  const hasPlanned = signals.includes("Planned") || signals.includes("Previsto");
  const hasActual = signals.includes("Actual") || signals.includes("Realizado");
  const score = (hasName ? 0.6 : 0) + (hasPlanned && hasActual ? 0.4 : hasPlanned || hasActual ? 0.15 : 0) + (signals.includes("avanço físico") || signals.includes("progresso acumulado") ? 0.2 : 0);
  return { isSCurve: hasName || (hasPlanned && hasActual), signals, score: Math.min(1, score) };
}

const FINANCIAL_REGEX = /financ|r\$|\bus\$|\$|desembols|custo|cost|valor|\bbrl\b|\busd\b|fatur|medi[çc][ãa]o/i;
const LABOR_REGEX = /m[ãa]o[\s_-]*de[\s_-]*obra|efetivo|\bhh\b|homem[\s_-]*hora|headcount|\bmanpower\b/i;
const DISBURSEMENT_REGEX = /desembols|cash[\s_-]*flow|fluxo[\s_-]*de[\s_-]*caixa/i;
const PLANNED_REGEX = /\bprevisto\b|\bplanejado\b|\bplanned\b|\bbaseline\b|\bplan\b|\bprogramado\b/i;
const ACTUAL_REGEX = /\brealizado\b|\bactual\b|\breal\b|\bexecutado\b/i;
const FORECAST_REGEX = /\bforecast\b|\bprojetado\b|\bproje[çc][ãa]o\b|\btend[êe]ncia\b|\bprevis[ãa]o\b|\breprogramado\b/i;
const RECOVERY_REGEX = /recupera[çc][ãa]o|\brecovery\b|\bcatch[\s_-]*up\b/i;
const PERIOD_REGEX = /acumulad|cumulative|\bacum\b|\bcum\b/i;
const WEEKLY_REGEX = /\bsemana\b|\bweekly\b|\bper[íi]odo\b|\bmensal\b|\bmonthly\b|no\s+per[íi]odo/i;

export interface SeriesHeaderClassification {
  type: SCurveSeriesType;
  unit: SCurveUnit;
  scale: "CUMULATIVE" | "PERIOD";
}

export function classifySeriesHeader(header: string): SeriesHeaderClassification {
  const text = header.trim();
  const financial = FINANCIAL_REGEX.test(text);
  const labor = LABOR_REGEX.test(text);
  const disbursement = DISBURSEMENT_REGEX.test(text);
  const scale: "CUMULATIVE" | "PERIOD" = WEEKLY_REGEX.test(text) && !PERIOD_REGEX.test(text) ? "PERIOD" : "CUMULATIVE";
  const unit: SCurveUnit = /%|percent|pct/i.test(text) ? "PERCENT" : financial ? "CURRENCY" : labor ? (/hh|hora/i.test(text) ? "HOURS" : "HEADCOUNT") : "UNKNOWN";

  if (disbursement) return { type: "DISBURSEMENT", unit: unit === "UNKNOWN" ? "CURRENCY" : unit, scale };
  if (labor) return { type: "LABOR", unit, scale };
  if (RECOVERY_REGEX.test(text)) return { type: "PHYSICAL_RECOVERY", unit: unit === "UNKNOWN" ? "PERCENT" : unit, scale };

  const family = financial ? "FINANCIAL" : "PHYSICAL";
  const defaultUnit: SCurveUnit = unit !== "UNKNOWN" ? unit : financial ? "CURRENCY" : "PERCENT";
  if (FORECAST_REGEX.test(text)) return { type: `${family}_FORECAST`, unit: defaultUnit, scale };
  if (ACTUAL_REGEX.test(text)) return { type: `${family}_ACTUAL`, unit: defaultUnit, scale };
  if (PLANNED_REGEX.test(text)) return { type: `${family}_PLANNED`, unit: defaultUnit, scale };
  return { type: "UNKNOWN", unit, scale };
}

/** Reconhece um rótulo de período: data (ISO/BR), "W37", "Semana 37", "Sem 37", número de série Excel já convertido. */
export function parsePeriodLabel(value: unknown): { period: string; date: string | null } | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    return { period: iso, date: iso };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Data serial do Excel (dias desde 1899-12-30) — só faixa plausível.
    if (value > 30000 && value < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      const iso = date.toISOString().slice(0, 10);
      return { period: iso, date: iso };
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return { period: text, date: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (br) return { period: text, date: `${br[3]}-${br[2]}-${br[1]}` };
  if (/^[Ww]\s?\d{1,3}$/.test(text) || /^(semana|sem\.?|week|wk)\s*\d{1,3}$/i.test(text)) return { period: text, date: null };
  return null;
}

/**
 * Converte texto/número de célula em número — formatos BRASILEIROS e
 * internacionais, sem inventar: "R$ 1.234.567,89", "1.234.567,89",
 * "12,50%", "(1.234,56)" (negativo contábil), "-1.234,56", "1,234,567.89".
 * Vazio/texto não numérico => null. Fórmulas {formula, result} usam SÓ o
 * resultado armazenado (sem result => null).
 */
export function toNumericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    return toNumericValue((value as { result: unknown }).result);
  }
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;

  // Negativo contábil entre parênteses.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  // Prefixos/sufixos de moeda e unidade (R$, US$, BRL, USD, €, $) e espaços.
  text = text.replace(/^(r\$|us\$|brl|usd|eur|€|\$)\s*/i, "").replace(/\s*(r\$|brl|usd|eur|€|\$)$/i, "").replace(/\s/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  const percent = text.endsWith("%");
  if (percent) text = text.slice(0, -1);
  if (!/^[0-9.,]+$/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // O separador que aparece por último é o decimal.
    normalized = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Só vírgula: decimal BR (1234,56) — várias vírgulas seriam milhar EN.
    normalized = (text.match(/,/g) ?? []).length > 1 ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (lastDot >= 0) {
    // Só ponto: milhar BR quando agrupa exatamente 3 dígitos repetidos (1.234.567); senão decimal.
    normalized = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  } else {
    normalized = text;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}
