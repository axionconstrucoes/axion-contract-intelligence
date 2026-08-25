import { ACC_TEST_MODE_BANNER_TEXT, isTestModeBannerVisible } from "@/lib/test-mode";

// Etiqueta global "SISTEMA EM TESTE" — renderizada uma única vez no
// layout raiz (nunca por página). Fica sempre dentro do fluxo normal
// do documento (nunca removida dele) para nunca sobrepor menus,
// títulos ou conteúdo; sticky apenas para continuar visível durante
// a rolagem.
export function TestModeBanner() {
  if (!isTestModeBannerVisible()) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex w-full shrink-0 items-center justify-center bg-red-600 px-4 py-1.5"
    >
      <span className="text-center text-xs font-bold text-white sm:text-sm">{ACC_TEST_MODE_BANNER_TEXT}</span>
    </div>
  );
}
