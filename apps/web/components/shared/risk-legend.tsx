import { SeverityBadge } from "@/components/shared/badges";

/** Legenda dos 4 níveis de risco com ajuda contextual — único lugar pensado para explicar o significado de cada nível (seção 11: "sem poluir a tela" nos demais usos de SeverityBadge). */
export function RiskLegend({
  strongBaixaHighlight = false,
}: {
  // Amarelo forte + fonte preta no BAIXO — exclusivo da página Start-up
  // ACC (única tela que hoje usa RiskLegend), nunca a paleta padrão de
  // BAIXA (bg-severity-baixa/15) usada em qualquer outro lugar futuro
  // que venha a reaproveitar este componente.
  strongBaixaHighlight?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SeverityBadge
        severity="BAIXA"
        withInfo
        className={strongBaixaHighlight ? "bg-yellow-400 font-bold text-black" : undefined}
      />
      <SeverityBadge severity="MEDIA" withInfo />
      <SeverityBadge severity="ALTA" withInfo />
      <SeverityBadge severity="CRITICA" withInfo />
    </div>
  );
}
