import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getProjectMembers } from "@/lib/data";
import { getContractAlertBatch } from "@/lib/email/get-contract-alert-batch";
import { isValidContractAlertBatchAction } from "@/lib/email-actions/contract-alert-batch-validation";
import type { ContractAlertBatchItemAction } from "@/lib/email-actions/contract-alert-batch-types";
import { formatDateTime } from "@/lib/labels";

import { ContractAlertBatchForm } from "./contract-alert-batch-form";

export const metadata: Metadata = { title: "Responder alertas do ACC" };

export default async function ContractAlertBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; batchId: string }>;
  searchParams: Promise<{ acao?: string | string[]; evento?: string | string[] }>;
}) {
  const { projectId, batchId } = await params;
  const query = await searchParams;
  const [batch, members] = await Promise.all([
    getContractAlertBatch(projectId, batchId),
    getProjectMembers(projectId),
  ]);

  if (!batch) {
    return (
      <Card>
        <CardHeader><CardTitle>Lote de alertas indisponível</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">O link não existe ou seu usuário não tem acesso a este lote de alertas.</p>
          <Link href={`/${projectId}/ledger`} className={buttonVariants({ variant: "outline" })}>Voltar para o Ledger</Link>
        </CardContent>
      </Card>
    );
  }

  const activeMembers = members
    .filter((member) => member.status === "ACTIVE")
    .map((member) => ({ userId: member.userId, name: member.user.name }));

  const requestedAction = Array.isArray(query.acao) ? query.acao[0] : query.acao;
  const requestedEventId = Array.isArray(query.evento) ? query.evento[0] : query.evento;
  const initialAction =
    requestedAction &&
    requestedEventId &&
    isValidContractAlertBatchAction(requestedAction) &&
    batch.items.some((item) => item.eventId === requestedEventId)
      ? { eventId: requestedEventId, action: requestedAction as ContractAlertBatchItemAction }
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-primary">ACC · AXION CONTROLE DE CONTRATOS</p>
        <h1 className="mt-1 text-2xl font-semibold">Responder alertas de contrato</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {batch.projectName} · Responsável: {batch.recipientName} · {batch.items.length} {batch.items.length === 1 ? "alerta" : "alertas"} neste lote
        </p>
      </div>

      {batch.status === "RESPONDED" ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p className="font-medium text-emerald-700">Lote respondido integralmente.</p>
            {batch.respondedAt ? <p className="text-sm text-muted-foreground">Registrado em {formatDateTime(batch.respondedAt)}.</p> : null}
            <Link href={`/${projectId}/ledger`} className={buttonVariants({ variant: "outline" })}>Ver Ledger</Link>
          </CardContent>
        </Card>
      ) : batch.status !== "SENT" ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Este lote de alertas ainda não foi enviado ou está aguardando reprocessamento.</CardContent></Card>
      ) : (
        <>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Defina RESOLVIDO, EM ANDAMENTO ou ENVIADO P/ para cada alerta. "VER EVENTO" é só consulta e não conta como resposta.
            A resposta ao ACC só é liberada quando todos os alertas abaixo tiverem uma ação definida.
          </div>
          <ContractAlertBatchForm
            batchId={batch.id}
            projectId={projectId}
            items={batch.items}
            members={activeMembers}
            initialAction={initialAction}
          />
        </>
      )}
    </div>
  );
}
