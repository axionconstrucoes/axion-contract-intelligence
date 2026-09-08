// Badges de status do painel Construmanager.
//
// Status da INTEGRACAO (cabecalho do card) agora usa `integrationClasses`
// de components/shared/badges.tsx — a MESMA fonte que Drive, Gmail, ERP,
// ESG/SSMA e o Dashboard usam. Ate a padronizacao visual global, este
// arquivo mantinha um mapa proprio com hex levemente diferente
// (bg-yellow-400/bg-green-600/bg-red-600); isso violava a garantia de
// "o mesmo status tem aparencia identica em qualquer pagina", entao foi
// eliminado. `ConstrumanagerIntegrationStatusBadge` continua existindo
// como componente proprio (integration-card.tsx so troca de badge por
// tipo de fonte), so a cor deixou de ser duplicada.
//
// Status de CONTEUDO (download de cada item) e' um conceito DIFERENTE —
// nao e' status de integracao nem grau de risco — e continua com paleta
// propria abaixo, fora do escopo da padronizacao.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { integrationClasses } from "@/components/shared/badges";
import { integrationStatusLabels } from "@/lib/labels";
import type { IntegrationStatus } from "@axion/types";

export function ConstrumanagerIntegrationStatusBadge({
  status,
}: {
  status: IntegrationStatus;
}) {
  return (
    <Badge className={cn(integrationClasses[status])}>
      {integrationStatusLabels[status]}
    </Badge>
  );
}

export type ConstrumanagerContentStatus =
  | "PENDENTE"
  | "BAIXANDO"
  | "ARMAZENADO"
  | "ERRO"
  /**
   * Fica no Construmanager por política de tamanho.
   *
   * Não é erro e não é pendência — é uma decisão de armazenamento já
   * tomada. Por isso ganha família de cor própria (azul-escuro), longe
   * do vermelho de ERRO e do amarelo de PENDENTE: quem bate o olho no
   * painel precisa entender de imediato que não há nada a fazer com
   * este item.
   */
  | "REFERENCIA_EXTERNA";

/**
 * Status de CONTEÚDO de cada item da lista de download.
 *
 * ARMAZENADO é o estado bem-sucedido deste painel — mesmo verde do
 * "Ativo" do cabeçalho, para que "deu certo" tenha uma cor só no card.
 * BAIXANDO é transitório e usa azul: não é sucesso nem espera.
 */
export const CONSTRUMANAGER_CONTENT_STATUS_CLASSES: Record<
  ConstrumanagerContentStatus,
  string
> = {
  PENDENTE: "border-transparent bg-yellow-400 text-black font-bold",
  BAIXANDO: "border-transparent bg-blue-600 text-white font-bold",
  ARMAZENADO: "border-transparent bg-green-600 text-white font-bold",
  ERRO: "border-transparent bg-red-600 text-white font-bold",
  // Azul-escuro solido: familia de cor propria, longe do vermelho de
  // ERRO e do amarelo de PENDENTE.
  REFERENCIA_EXTERNA: "border-transparent bg-blue-900 text-white font-bold",
};

export const CONSTRUMANAGER_CONTENT_STATUS_LABELS: Record<
  ConstrumanagerContentStatus,
  string
> = {
  PENDENTE: "Pendente",
  BAIXANDO: "Baixando",
  ARMAZENADO: "Armazenado",
  REFERENCIA_EXTERNA: "SOMENTE NO CONSTRUMANAGER",
  ERRO: "Erro",
};

export function ConstrumanagerContentStatusBadge({
  status,
}: {
  status: string;
}) {
  // Status desconhecido não pode sumir da tela nem quebrar o painel:
  // cai num badge neutro exibindo o valor cru, que é informação útil
  // para diagnóstico.
  const known = status as ConstrumanagerContentStatus;
  const className = CONSTRUMANAGER_CONTENT_STATUS_CLASSES[known];

  if (!className) {
    return (
      <Badge className="border-transparent bg-muted text-muted-foreground font-bold">
        {status}
      </Badge>
    );
  }

  return (
    <Badge className={cn(className)}>
      {CONSTRUMANAGER_CONTENT_STATUS_LABELS[known]}
    </Badge>
  );
}
