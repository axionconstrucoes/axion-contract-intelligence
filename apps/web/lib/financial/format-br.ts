// Formatação BRASILEIRA pura para o dashboard financeiro. A moeda NUNCA é
// fixa em código: o símbolo vem dos cabeçalhos da própria aba (R$, US$,
// €…); sem símbolo identificado, mostra só o número com a nota
// "moeda não identificada". Dado ausente => "Dado não disponível" (nunca 0).

export const NOT_AVAILABLE = "Dado não disponível";

export type FinancialUnit = "CURRENCY" | "PERCENT" | "QUANTITY" | "UNKNOWN";

export function detectCurrencySymbol(headers: string[]): string | null {
  const joined = headers.join(" ");
  if (/\bus\$|\busd\b/i.test(joined)) return "US$";
  if (/\br\$|\bbrl\b|\breais\b/i.test(joined)) return "R$";
  if (/€|\beur\b/i.test(joined)) return "€";
  if (/\$/.test(joined)) return "$";
  return null;
}

export function formatNumberBR(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value);
}

export function formatAmount(value: number | null | undefined, symbol: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  const text = formatNumberBR(value);
  return symbol ? `${symbol} ${text}` : text;
}

export function formatPercentBR(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  return `${formatNumberBR(value, fractionDigits)}%`;
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(date);
}

export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(date);
}

export function formatByUnit(value: number | null | undefined, unit: FinancialUnit, symbol: string | null): string {
  if (unit === "PERCENT") return formatPercentBR(value);
  if (unit === "CURRENCY") return formatAmount(value, symbol);
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  return formatNumberBR(value, 2);
}
