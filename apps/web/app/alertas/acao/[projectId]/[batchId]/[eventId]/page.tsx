import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getProjectMembers } from "@/lib/data";
import { getContractAlertBatch } from "@/lib/email/get-contract-alert-batch";
import { isValidContractAlertBatchAction } from "@/lib/email-actions/contract-alert-batch-validation";
import {
  CONTRACT_ALERT_BATCH_ITEM_ACTION_LABELS,
  type ContractAlertBatchItemAction,
} from "@/lib/email-actions/contract-alert-batch-types";

import { CompactContractAlertActionForm } from "./compact-action-form";

export const metadata: Metadata = { title: "Responder alerta do ACC" };

export default async function CompactContractAlertActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; batchId: string; eventId: string }>;
  searchParams: Promise<{ acao?: string | string[] }>;
}) {
  const { projectId, batchId, eventId } = await params;
  const query = await searchParams;
  const requestedAction = Array.isArray(query.acao) ? query.acao[0] : query.acao;

  const action: ContractAlertBatchItemAction | null =
    requestedAction && isValidContractAlertBatchAction(requestedAction)
      ? requestedAction
      : null;

  const [batch, members] = await Promise.all([
    getContractAlertBatch(projectId, batchId),
    getProjectMembers(projectId),
  ]);

  const item = batch?.items.find((candidate) => candidate.eventId === eventId) ?? null;
  const activeMembers = members
    .filter((member) => member.status === "ACTIVE")
    .map((member) => ({ userId: member.userId, name: member.user.name }));

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-10 w-auto" />
          </div>
          <CardTitle>AXION Controle de Contratos</CardTitle>
          <CardDescription>Resposta rápida ao alerta</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {!batch || !item ? (
            <p className="text-sm text-destructive">
              Este link não existe ou seu usuário não tem acesso ao alerta.
            </p>
          ) : batch.status === "RESPONDED" ? (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
              Este alerta já foi respondido.
            </p>
          ) : !action ? (
            <p className="text-sm text-destructive">Ação inválida ou ausente.</p>
          ) : (
            <>
              <div className="rounded-md border p-4">
                <p className="text-xs font-medium text-muted-foreground">Projeto</p>
                <p className="mt-1 text-sm font-medium">{batch.projectName}</p>
                <p className="mt-4 text-xs font-medium text-muted-foreground">Alerta</p>
                <p className="mt-1 font-semibold">{item.title}</p>
                <p className="mt-4 text-xs font-medium text-muted-foreground">Ação</p>
                <p className="mt-1 font-semibold">
                  {CONTRACT_ALERT_BATCH_ITEM_ACTION_LABELS[action]}
                </p>
              </div>

              {batch.items.length === 1 ? (
                <CompactContractAlertActionForm
                  projectId={projectId}
                  batchId={batchId}
                  eventId={eventId}
                  initialAction={action}
                  members={activeMembers}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    Este e-mail contém vários alertas. Para preservar a resposta conjunta, conclua todos no ACC.
                  </p>
                  <Link
                    href={`/${projectId}/ledger/lote-alertas/${batchId}#evento-${eventId}`}
                    className={buttonVariants()}
                  >
                    RESPONDER AO ACC
                  </Link>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
