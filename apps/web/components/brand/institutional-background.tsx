// Fundo institucional AXION/ACC (bordô + quadriculado branco discreto)
// — único lugar que decide como aplicar esse fundo em uma página.
// Reutilizável: qualquer página futura que precise do mesmo fundo só
// precisa renderizar <InstitutionalBackground /> como filho de um
// contêiner `relative` com `min-h-dvh`/`overflow-hidden` próprio — sem
// copiar classes de fundo. Hoje usado só em /login e /projetos
// (nunca nas páginas internas do projeto, que usam [projectId]/layout.tsx).
//
// O fundo é o próprio asset institucional reutilizável
// (public/brand/acc-burgundy-white-grid-background.svg, também
// oferecido para download nas mesmas páginas) usado como
// background-image — nunca uma implementação CSS paralela: a página e
// o arquivo baixável são sempre visualmente idênticos por construção.
export const INSTITUTIONAL_BACKGROUND_SVG_PATH =
  "/brand/acc-burgundy-white-grid-background.svg";
export const INSTITUTIONAL_BACKGROUND_PNG_PATH =
  "/brand/acc-burgundy-white-grid-background-1920x1080.png";

export function InstitutionalBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 bg-brand-sidebar bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `url(${INSTITUTIONAL_BACKGROUND_SVG_PATH})`,
      }}
    />
  );
}
