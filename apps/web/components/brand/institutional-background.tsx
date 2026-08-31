// Fundo institucional AXION/ACC — único lugar que decide como aplicar
// esse fundo em uma página. Reutilizável: qualquer página futura que
// precise do mesmo fundo só precisa renderizar <InstitutionalBackground />
// como filho de um contêiner `relative` com `min-h-dvh`/`overflow-hidden`
// próprio — sem copiar classes de fundo. Hoje usado só em /login e
// /projetos (nunca nas páginas internas do projeto, que usam
// [projectId]/layout.tsx).
//
// Asset oficial fornecido pela marca (public/brand/acc-background-oficial.png)
// — validado antes de copiar (sharp: PNG real, 1672x941, com canal alfa)
// — o PNG original nunca foi alterado/removido (outros pontos do repo
// podem passar a referenciá-lo diretamente no futuro) e continua sendo
// o fallback via image-set() abaixo. Um .webp irmão (mesmas dimensões,
// mesma cor média — gerado com sharp, qualidade 82, ~44x menor) foi
// adicionado só para reduzir a transferência em /login e /projetos;
// navegadores sem suporte a image-set()/webp continuam recebendo o PNG
// oficial byte-a-byte, então a aparência nunca depende do formato
// escolhido pelo navegador.
export const INSTITUTIONAL_BACKGROUND_PNG_PATH = "/brand/acc-background-oficial.png";
const INSTITUTIONAL_BACKGROUND_WEBP_PATH = "/brand/acc-background-oficial.webp";

// Cor vermelha predominante do PRÓPRIO arquivo acima, extraída por
// código (histograma de pixels via sharp sobre o PNG bruto — pico de
// frequência em torno de #c10c10; não escolhida/aproximada manualmente).
// Usada só como overlay/scrim de contraste sobre o fundo — nunca
// reaproveita --brand-sidebar (globals.css), que é intencionalmente a
// cor do LOGO (#7f1d1d), uma decisão de marca separada e já documentada
// lá — dois vermelhos diferentes, dois propósitos diferentes.
export const INSTITUTIONAL_BACKGROUND_DOMINANT_COLOR = "#c10c10";

export function InstitutionalBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat"
      style={{
        backgroundColor: INSTITUTIONAL_BACKGROUND_DOMINANT_COLOR,
        // Scrim escuro por cima do fundo oficial — só para garantir
        // contraste/legibilidade do card e do texto claro acima dele em
        // qualquer viewport (mobile inclusive), nunca para esconder o
        // asset em si.
        backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.55)), image-set(url(${INSTITUTIONAL_BACKGROUND_WEBP_PATH}) type("image/webp"), url(${INSTITUTIONAL_BACKGROUND_PNG_PATH}) type("image/png"))`,
      }}
    />
  );
}
