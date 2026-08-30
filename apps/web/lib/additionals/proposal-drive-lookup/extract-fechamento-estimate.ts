// Puro, sem I/O. Regra específica de estimativa (Propostas de Adicionais
// — Parte 7, "Estimativas"): quando a planilha de custo tem EXATAMENTE
// uma aba chamada "FECHAMENTO" (sem diferenciar maiúsculas/minúsculas),
// o valor de B12 é a estimativa de preço de venda. Fora desse caso
// específico (0, 2+ abas, ou aba com outro nome), esta função não tenta
// adivinhar — devolve false, e o caller decide o quê fazer (ver
// resolve-proposal-from-drive.ts: cai para "não resolvido", nunca um
// palpite).

export function isSingleFechamentoWorkbook(sheetNames: string[]): boolean {
  return sheetNames.length === 1 && sheetNames[0].trim().toUpperCase() === "FECHAMENTO";
}

// Aceita tanto number (leitura direta de célula numérica) quanto string
// formatada (ex.: "R$ 1.234.567,89") — nunca lança; retorna null quando o
// valor não é reconhecível como número, para o caller tratar como "não
// resolvido" em vez de um preço inventado.
export function parseFechamentoCellValue(rawValue: string | number | null): number | null {
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) ? rawValue : null;
  }
  if (typeof rawValue !== "string") return null;

  const normalized = rawValue
    .replace(/[^\d,.\-]/g, "") // remove "R$", espaços, etc.
    .replace(/\.(?=\d{3}(?:\D|$))/g, "") // remove separador de milhar "."
    .replace(",", "."); // vírgula decimal -> ponto

  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
