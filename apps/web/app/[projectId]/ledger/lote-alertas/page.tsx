import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { getContractAlertBatchesList } from "@/lib/email/get-contract-alert-batches-list";
import type { ContractAlertBatchListStatus } from "@/lib/email/contract-alert-batch-list-status";
import { formatDate } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lotes de Alertas" };

// Rótulo/estilo de cada status de EXIBIÇÃO da listagem — nunca as
// colunas reais (PENDING/SENT/RESPONDED/FAILED), ver
// get-contract-alert-batches-list.ts. Sem PARCIAL: a RPC de resposta é
// atômica (tudo ou nada), então esse estado nunca é real — mostrar
// "X de Y respondidos" na própria linha já cobre o progresso.
const LIST_STATUS_LABELS: Record<ContractAlertBatchListStatus, string> = {
  PENDENTE_ENVIO: "Pendente de envio",
  ABERTO: "ABERTO",
  RESPONDIDO: "RESPONDIDO",
  FALHOU: "Falhou no envio",
};

const LIST_STATUS_VARIANTS: Record<ContractAlertBatchListStatus, "outline" | "secondary" | "default" | "destructive"> = {
  PENDENTE_ENVIO: "outline",
  ABERTO: "secondary",
  RESPONDIDO: "default",
  FALHOU: "destructive",
};

// cutoffDate é a quarta-feira (08:00 local) em que o fechamento
// automático ocorreu — não uma semana ISO Monday-Sunday. Exibida como
// "Fechamento de <data>" para não sugerir um período que não existe.
function formatCutoffLabel(cutoffDate: string | null): string {
  if (!cutoffDate) return "Lote manual (fora do fechamento semanal)";
  const wednesday = new Date(`${cutoffDate}T00:00:00Z`);
  return `Fechamento de ${formatDate(wednesday.toISOString())}`;
}

export default async function ContractAlertBatchesListPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const batches = await getContractAlertBatchesList(projectId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lotes de Alertas"
        description="Alertas MÉDIO e BAIXO são agregados automaticamente em um lote semanal por destinatário — CRÍTICO e ALTO continuam no fluxo imediato do Event Ledger."
      />
      {batches.length === 0 ? (
        <EmptyState message="Nenhum lote de alertas ainda. Alertas MÉDIO/BAIXO elegíveis são compostos automaticamente no início de cada semana." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fechamento</TableHead>
              <TableHead>Destinatário</TableHead>
              <TableHead>Alertas</TableHead>
              <TableHead>Baixo / Médio</TableHead>
              <TableHead>Respondidos</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enviado em</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell className="whitespace-nowrap">{formatCutoffLabel(batch.cutoffDate)}</TableCell>
                <TableCell>{batch.recipientName}</TableCell>
                <TableCell>{batch.totalCount}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {batch.lowCount} / {batch.mediumCount}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {batch.answeredCount} de {batch.totalCount}
                </TableCell>
                <TableCell>
                  <Badge variant={LIST_STATUS_VARIANTS[batch.listStatus]}>{LIST_STATUS_LABELS[batch.listStatus]}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {batch.sentAt ? formatDate(batch.sentAt) : "—"}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/${projectId}/ledger/lote-alertas/${batch.id}`}
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                  >
                    ABRIR
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
