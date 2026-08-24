// Resumo de status das integrações no Dashboard — só o número total de
// cada status (Ativo/Pendente/Atenção/Erro); passar o mouse por cima
// mostra os nomes de todas as fontes naquele status (title nativo,
// sempre acessível por teclado/leitor de tela — mesmo padrão já usado
// em campos pré-preenchidos).

import Link from "next/link";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { integrationStatusLabels } from "@/lib/labels";
import type { IntegrationStatusGroup } from "@/lib/ui/resolve-integration-display-status";

// ERRO usa cinza neutro (não vermelho) — mesmo ajuste de
// components/shared/badges.tsx: o vermelho do farol de risco fica
// reservado a severidade contratual, nunca a estado técnico de
// integração (pedido explícito do usuário).
const STATUS_TONE_CLASSNAME: Record<IntegrationStatusGroup["status"], string> = {
  CONECTADO: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  PENDENTE: "border-transparent bg-severity-media/15 text-severity-media",
  ATENCAO: "border-transparent bg-orange-500/15 text-orange-600 dark:text-orange-400",
  ERRO: "border-transparent bg-secondary text-foreground font-semibold",
};

export function IntegrationStatusSummary({ projectId, groups }: { projectId: string; groups: IntegrationStatusGroup[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Status das integrações
          <FeatureInfo helpId="dashboard-integration-status-summary" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {groups.map((group) => (
          <span
            key={group.status}
            title={group.labels.length > 0 ? group.labels.join("\n") : "Nenhuma fonte neste status"}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${STATUS_TONE_CLASSNAME[group.status]}`}
          >
            <span className="text-sm font-semibold">{group.count}</span>
            {integrationStatusLabels[group.status]}
          </span>
        ))}
        <Link href={`/${projectId}/integracoes`} className="ml-auto text-xs text-muted-foreground underline hover:text-foreground">
          Ver Integrações
        </Link>
      </CardContent>
    </Card>
  );
}
