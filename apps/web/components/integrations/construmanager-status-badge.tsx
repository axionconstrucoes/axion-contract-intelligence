// Badges de status do painel Construmanager.
//
// Módulo próprio, e não uma alteração de integrationClasses em
// components/shared/badges.tsx, por um motivo concreto: aquele mapa é
// compartilhado por Drive, Gmail, ERP e ESG/SSMA. Mudar as cores lá
// repintaria badges de áreas que ninguém pediu para mexer. Aqui as
// regras valem só para o Construmanager, e as demais integrações
// continuam com IntegrationStatusBadge exatamente como estava.
//
// Contraste: caixa sólida + texto de alto contraste + negrito, para que
// o estado seja legível de relance no card. PENDENTE usa texto preto
// sobre amarelo porque branco sobre amarelo-400 não alcança contraste
// aceitável.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { integrationStatusLabels } from "@/lib/labels";
import type { IntegrationStatus } from "@axion/types";

/**
 * Status da INTEGRAÇÃO (cabeçalho do card).
 *
 * CONECTADO é rotulado "Ativo" na UI (integrationStatusLabels), daí o
 * verde. ATENCAO não foi especificado nas regras visuais; recebe laranja
 * sólido para permanecer distinguível de ERRO sem se confundir com ele.
 */
export const CONSTRUMANAGER_INTEGRATION_STATUS_CLASSES: Record<
  IntegrationStatus,
  string
> = {
  CONECTADO: "border-transparent bg-green-600 text-white font-bold",
  PENDENTE: "border-transparent bg-yellow-400 text-black font-bold",
  ATENCAO: "border-transparent bg-orange-500 text-white font-bold",
  ERRO: "border-transparent bg-red-600 text-white font-bold",
};

export function ConstrumanagerIntegrationStatusBadge({
  status,
}: {
  status: IntegrationStatus;
}) {
  return (
    <Badge className={cn(CONSTRUMANAGER_INTEGRATION_STATUS_CLASSES[status])}>
      {integrationStatusLabels[status]}
    </Badge>
  );
}

export type ConstrumanagerContentStatus =
  | "PENDENTE"
  | "BAIXANDO"
  | "ARMAZENADO"
  | "ERRO";

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
};

export const CONSTRUMANAGER_CONTENT_STATUS_LABELS: Record<
  ConstrumanagerContentStatus,
  string
> = {
  PENDENTE: "Pendente",
  BAIXANDO: "Baixando",
  ARMAZENADO: "Armazenado",
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
