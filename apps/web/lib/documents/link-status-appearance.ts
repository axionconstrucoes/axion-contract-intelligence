// Cor/rótulo dos ícones de vínculo contratual (vincular/desvincular).
//
// Regra única, deliberadamente separada dos componentes: a cor é
// decidida SOMENTE pelo estado REAL do vínculo do documento —
// VINCULADO = verde, DESVINCULADO = vermelho — e NUNCA pela ação que o
// botão executa. Antes desta regra cada controle escolhia a própria
// cor pela ação ("desvincular" = vermelho, "vincular" = verde), o que
// deixava todo documento já vinculado com ícone vermelho.
//
// Os dois controles que usam isto (unlink-contractual-attachment-
// control.tsx e link-existing-document-to-parent-control.tsx) montam
// no estado que a página carregou e, quando a Server Action confirma
// sucesso, INVERTEM esse estado localmente via resolveLinkStatus — a
// cor muda na hora, sem esperar a revalidação recompor a árvore nem
// exigir recarregamento manual. A revalidação continua sendo a
// verdade final (o documento troca de lugar na tela).
export type LinkStatus = "linked" | "unlinked";

export function resolveLinkStatus({
  linkedOnLoad,
  lastActionSucceeded,
}: {
  // Estado do vínculo quando o controle foi renderizado pela página.
  linkedOnLoad: boolean;
  // true só quando a Server Action do PRÓPRIO controle retornou
  // success — cada controle só executa a ação que inverte o estado em
  // que nasceu (desvincular um vinculado / vincular um desvinculado).
  lastActionSucceeded: boolean;
}): LinkStatus {
  const linkedNow = lastActionSucceeded ? !linkedOnLoad : linkedOnLoad;
  return linkedNow ? "linked" : "unlinked";
}

export interface LinkStatusAppearance {
  status: LinkStatus;
  // "Vinculado" / "Desvinculado" — estado, não ação.
  statusLabel: string;
  // Fundo/texto/hover/anel de foco do gatilho (summary ou Button).
  triggerClassName: string;
  // Variante desabilitada do Button de submit (mesma família de cor,
  // mais clara) — irrelevante para <summary>, que nunca desabilita.
  disabledClassName: string;
}

export function getLinkStatusAppearance(status: LinkStatus): LinkStatusAppearance {
  if (status === "linked") {
    return {
      status,
      statusLabel: "Vinculado",
      triggerClassName: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-400",
      disabledClassName: "disabled:bg-emerald-300 disabled:text-white",
    };
  }

  return {
    status,
    statusLabel: "Desvinculado",
    triggerClassName: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-400",
    disabledClassName: "disabled:bg-red-300 disabled:text-white",
  };
}
