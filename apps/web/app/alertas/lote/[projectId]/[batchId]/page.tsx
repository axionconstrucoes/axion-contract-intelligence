import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjectMembers } from "@/lib/data";
import { getContractAlertBatch } from "@/lib/email/get-contract-alert-batch";
import { isValidContractAlertBatchAction } from "@/lib/email-actions/contract-alert-batch-validation";
import type { ContractAlertBatchItemAction } from "@/lib/email-actions/contract-alert-batch-types";
import { ContractAlertBatchForm } from "@/app/[projectId]/ledger/lote-alertas/[batchId]/contract-alert-batch-form";

export const metadata: Metadata = { title: "Responder alertas do ACC" };

export default async function CompactContractAlertBatchPage({
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
      <div className="flex min-h-dvh items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-3xl">
          <CardContent className="pt-6 text-sm text-destructive">
            Este link não existe ou seu usuário não tem acesso aos alertas.
          </CardContent>
        </Card>
      </div>
    );
  }

  const requestedAction = Array.isArray(query.acao) ? query.acao[0] : query.acao;
  const requestedEventId = Array.isArray(query.evento) ? query.evento[0] : query.evento;

  const initialAction =
    requestedAction &&
    requestedEventId &&
    isValidContractAlertBatchAction(requestedAction) &&
    batch.items.some((item) => item.eventId === requestedEventId)
      ? { eventId: requestedEventId, action: requestedAction as ContractAlertBatchItemAction }
      : null;

  const activeMembers = members
    .filter((member) => member.status === "ACTIVE")
    .map((member) => ({ userId: member.userId, name: member.user.name }));

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-5xl">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-10 w-auto" />
          </div>
          <CardTitle>AXION Controle de Contratos</CardTitle>
          <CardDescription>
            Resposta rápida · {batch.projectName} · {batch.items.length} {batch.items.length === 1 ? "alerta" : "alertas"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {batch.status === "RESPONDED" ? (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
              Este lote de alertas já foi respondido.
            </p>
          ) : batch.status !== "SENT" ? (
            <p className="text-sm text-muted-foreground">
              Este lote ainda não está disponível para resposta.
            </p>
          ) : (
            <ContractAlertBatchForm
              batchId={batch.id}
              projectId={projectId}
              items={batch.items}
              members={activeMembers}
              initialAction={initialAction}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
