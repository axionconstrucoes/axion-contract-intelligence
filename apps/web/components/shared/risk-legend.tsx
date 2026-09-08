import { SeverityBadge } from "@/components/shared/badges";

/**
 * Legenda dos 4 níveis de risco com ajuda contextual — único lugar
 * pensado para explicar o significado de cada nível (seção 11: "sem
 * poluir a tela" nos demais usos de SeverityBadge).
 *
 * Padrão único, sem exceção por página: as 4 severidades vêm sempre da
 * paleta global (severityClasses, badges.tsx). O antigo destaque
 * amarelo exclusivo do BAIXO na Start-up ACC foi removido — o padrão
 * definitivo de risco cancelou "BAIXO amarelo" em qualquer tela.
 */
export function RiskLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SeverityBadge severity="BAIXA" withInfo />
      <SeverityBadge severity="MEDIA" withInfo />
      <SeverityBadge severity="ALTA" withInfo />
      <SeverityBadge severity="CRITICA" withInfo />
    </div>
  );
}
