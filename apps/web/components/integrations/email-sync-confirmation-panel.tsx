"use client";

// Prévia + confirmação humana antes de importar (seção 8) — somente
// humano executa. Nenhuma chamada real ao Gmail acontece ao confirmar;
// isso apenas enfileira a execução (project_email_ingestion_sync_runs),
// que é processada pela infraestrutura de sincronização já existente
// (scripts/gmail-inbound-*.mjs).

import { useActionState } from "react";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { startEmailSyncAction } from "@/app/[projectId]/integracoes/actions";
import { initialStartEmailSyncState } from "@/app/[projectId]/integracoes/actions-state";
import { formatDate } from "@/lib/labels";

const WINDOW_MODE_LABELS: Record<string, string> = {
  FROM_PROJECT_START: "Desde o início do projeto",
  FROM_NOW: "A partir de hoje",
  CUSTOM: "Período personalizado",
};

export function EmailSyncConfirmationPanel({
  projectId,
  projectName,
  configId,
  accountEmail,
  windowMode,
  periodStart,
  periodEnd,
  clientDomain,
  participantsCount,
  includeAttachments,
  preliminaryCount,
}: {
  projectId: string;
  projectName: string;
  configId: string;
  accountEmail: string;
  windowMode: string;
  periodStart: string | null;
  periodEnd: string | null;
  clientDomain: string;
  participantsCount: number;
  includeAttachments: boolean;
  preliminaryCount: number;
}) {
  const [state, formAction, pending] = useActionState(startEmailSyncAction, initialStartEmailSyncState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prévia antes de importar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <Field label="Conta" value={accountEmail} />
          <Field label="Projeto" value={projectName} />
          <Field
            label="Período"
            value={`${WINDOW_MODE_LABELS[windowMode] ?? windowMode}${periodStart ? ` (${formatDate(periodStart)} → ${periodEnd ? formatDate(periodEnd) : "hoje"})` : ""}`}
          />
          <Field label="Domínio cliente" value={clientDomain || "Não configurado"} />
          <Field label="Participantes considerados" value={String(participantsCount)} />
          <Field label="Anexos" value={includeAttachments ? "Sim" : "Não"} />
          <Field label="Contagem preliminar de mensagens já conhecidas" value={String(preliminaryCount)} />
        </dl>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Após a carga inicial, novas sincronizações são incrementais — nunca reimportam a caixa inteira.
          <FeatureInfo helpId="gmail-incremental-sync" />
        </p>

        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        {state.success ? (
          <p className="text-sm">Sincronização confirmada e enfileirada.</p>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="configId" value={configId} />
            <Button type="submit" disabled={pending}>
              {pending ? "Confirmando…" : "Confirmar sincronização"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
