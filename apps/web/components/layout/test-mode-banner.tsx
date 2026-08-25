import { ACC_TEST_MODE_BANNER_TEXT, isTestModeBannerVisible } from "@/lib/test-mode";

// Etiqueta global "SISTEMA EM TESTE" — renderizada uma única vez no
// layout raiz (nunca por página). Fica sempre dentro do fluxo normal
// do documento (nunca removida dele) para nunca sobrepor menus,
// títulos ou conteúdo; sticky apenas para continuar visível durante
// a rolagem. Visual de faixa de sinalização (diagonais amarelo/preto,
// repeating-linear-gradient) — o texto fica sobre uma placa preta
// sólida central, nunca diretamente sobre as diagonais, para manter
// contraste/legibilidade garantidos independente de onde a listra caia.
export function TestModeBanner() {
  if (!isTestModeBannerVisible()) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex w-full shrink-0 items-center justify-center bg-[repeating-linear-gradient(45deg,#facc15_0px,#facc15_14px,#000000_14px,#000000_28px)] px-4 py-1.5"
    >
      <span className="bg-black px-3 py-0.5 text-center text-xs font-bold text-yellow-300 sm:text-sm">
        {ACC_TEST_MODE_BANNER_TEXT}
      </span>
    </div>
  );
}
