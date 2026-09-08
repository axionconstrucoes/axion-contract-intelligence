// Formatacao numerica pt-BR para os paineis do Diario de Obra.
//
// `.toFixed(1)` usa ponto decimal ("3.5", "97.6%") — correto em
// ingles, errado em pt-BR ("3,5", "97,6%"). `Intl.NumberFormat("pt-BR")`
// formata; NUNCA muda o numero em si nem o que esta gravado no banco —
// so a REPRESENTACAO em tela.
//
// Modulo puro: sem rede, sem banco, sem IA.

const FORMATADOR_DECIMAL_PT_BR = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Numero decimal, 1 casa, virgula pt-BR. `null` vira "—". */
export function formatarNumeroPtBr(valor: number | null): string {
  return valor === null ? "—" : FORMATADOR_DECIMAL_PT_BR.format(valor);
}

/** Percentual, 1 casa, virgula pt-BR, com "%". `null` vira "—". */
export function formatarPercentualPtBr(valor: number | null): string {
  return valor === null ? "—" : `${FORMATADOR_DECIMAL_PT_BR.format(valor)}%`;
}
