// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// Fonte única da padronização visual do e-mail institucional ACC (Parte C
// da correção pós-piloto): família tipográfica, hierarquia de tamanhos
// LIMITADA a 4 valores, e as duas cores de texto (bordô para título
// principal/títulos de seção, preto para corpo). Nunca duplicar estes
// valores como literais soltos em contract-alert-template.ts/
// render-buttons.ts — sempre importar daqui.
//
// Cores semânticas do badge de risco (verde/azul/laranja/vermelho, em
// BADGE_STYLES de contract-alert-template.ts) são um caso à parte —
// indicador de status, não hierarquia de texto — e não vêm daqui.

export const ACC_FONT_FAMILY = "Arial, Helvetica, sans-serif";

// Título principal do e-mail (h1) e títulos de seção — nunca usado como
// cor de corpo/valor.
export const ACC_COLOR_HEADING = "#7F1D1D";

// Corpo, descrições, cláusulas, justificativas e valores.
export const ACC_COLOR_BODY = "#111111";

// Só para informação secundária/auxiliar (legendas de botão, rodapé,
// metadados de evidência) — #4B5563 sobre fundo branco tem contraste
// ~8.4:1, acima do mínimo WCAG AA (4.5:1) para texto normal.
export const ACC_COLOR_MUTED = "#4B5563";

// Hierarquia de tamanhos — deliberadamente só estes 4 valores em todo o
// e-mail (nunca 11px/13px/18px soltos por aí).
export const ACC_FONT_SIZE_TITLE = "20px"; // título principal
export const ACC_FONT_SIZE_SECTION = "15px"; // títulos de seção
export const ACC_FONT_SIZE_BODY = "14px"; // corpo/descrições/valores
export const ACC_FONT_SIZE_AUX = "12px"; // texto auxiliar/secundário
