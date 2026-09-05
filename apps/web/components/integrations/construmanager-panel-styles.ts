// Estilos do painel Construmanager (campo de busca e botão Baixar).
//
// Em módulo próprio, e não inline no componente, pelo mesmo motivo dos
// badges: as cores viram valores nomeados que o teste consegue afirmar,
// e ficam restritas ao Construmanager — nenhum primitivo compartilhado
// (Button, Input) é alterado, então nada muda no resto do sistema.

/** Magenta institucional aplicado ao painel Construmanager. */
export const CONSTRUMANAGER_MAGENTA = "#C2185B";

/** Magenta escuro do hover do botão Baixar. */
export const CONSTRUMANAGER_MAGENTA_HOVER = "#9D174D";

/**
 * Campo de pesquisa: fundo branco, borda magenta de 2 px, texto preto e
 * foco em magenta.
 *
 * `bg-white` e `text-black` são explícitos (e não tokens de tema) porque
 * o requisito pede branco e preto — não "a cor de fundo do tema", que
 * mudaria no modo escuro. `placeholder:text-neutral-500` acompanha:
 * sobre branco, o token de placeholder do tema escuro ficaria ilegível.
 */
export const CONSTRUMANAGER_SEARCH_INPUT_CLASS = [
  "border-2",
  "border-[#C2185B]",
  "bg-white",
  "text-black",
  "placeholder:text-neutral-500",
  "focus-visible:border-[#C2185B]",
  "focus-visible:ring-2",
  "focus-visible:ring-[#C2185B]",
].join(" ");

/**
 * Botão Baixar de cada item: magenta sólido, texto branco, negrito, e
 * cinza real quando desabilitado.
 *
 * `disabled:opacity-100` é necessário: o primitivo Button aplica
 * `disabled:opacity-50`, que sobre magenta produziria um rosa
 * desbotado em vez do cinza pedido. Anular a opacidade e fixar
 * `disabled:bg-neutral-400` dá o cinza de fato.
 *
 * `hover:opacity-100` pelo mesmo motivo: a variante padrão usa
 * `hover:opacity-90`, que competiria com a troca de cor do hover.
 */
export const CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS = [
  "bg-[#C2185B]",
  "text-white",
  "font-bold",
  "hover:bg-[#9D174D]",
  "hover:text-white",
  "hover:opacity-100",
  "disabled:bg-neutral-400",
  "disabled:text-white",
  "disabled:opacity-100",
].join(" ");

/** Rótulo do botão enquanto o download daquele item está em curso. */
export const CONSTRUMANAGER_DOWNLOADING_LABEL = "Baixando...";

/**
 * Botão "Copiar ID" das linhas de referência externa.
 *
 * Discreto de propósito: é uma conveniência para localizar o arquivo na
 * plataforma de origem, não uma ação de destaque como o Baixar. Negrito
 * porque todo texto de botão do painel é negrito.
 */
export const CONSTRUMANAGER_COPY_ID_BUTTON_CLASS = [
  "border-2",
  "border-[#C2185B]",
  "bg-white",
  "text-black",
  "font-bold",
  "hover:bg-[#C2185B]",
  "hover:text-white",
  "hover:opacity-100",
].join(" ");
