// Painel de sincronização (seção 13/14/20) — contadores sempre reais,
// nunca timer/percentual fake. Server component (só leitura).

import { FeatureInfo } from "@/components/shared/feature-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { computeSyncProgress } from "@/lib/email/inbound/ingestion-controls/compute-sync-progress";
import type { EmailSyncRun } from "@/lib/email/inbound/ingestion-controls/types";
import { formatDateTime } from "@/lib/labels";

const STATUS_LABELS: Record<string, string> = {
  PREPARING: "Preparando",
  RUNNING: "Sincronizando",
  COMPLETED: "Concluída",
  FAILED: "Falha",
};

export function EmailSyncPanel({ run, consideredCount }: { run: EmailSyncRun | null; consideredCount: number }) {
  if (!run) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Painel de sincronização
            <FeatureInfo helpId="gmail-sync-progress" />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Nenhuma sincronização confirmada ainda.</CardContent>
      </Card>
    );
  }

  const progress = computeSyncProgress(run);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Painel de sincronização
          <FeatureInfo helpId="gmail-sync-progress" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{progress.label}</p>
          <Progress value={progress.percent} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Status" value={STATUS_LABELS[run.status] ?? run.status} />
          <Stat label="E-mails encontrados" value={run.emailsFound ?? "—"} />
          <Stat label="E-mails importados" value={run.emailsImported} />
          <Stat label="Anexos encontrados" value={run.attachmentsFound} />
          <Stat label="Anexos processados" value={run.attachmentsProcessed} />
          <Stat label="Considerados pelo ACC" value={consideredCount} />
          <Stat label="Findings gerados" value={run.findingsGenerated} />
          <Stat label="Falhas/retries" value={run.failuresCount} />
        </div>

        <p className="text-xs text-muted-foreground">
          Última execução: {formatDateTime(run.startedAt)}
          {run.completedAt ? ` · concluída em ${formatDateTime(run.completedAt)}` : ""}
        </p>

        {run.errorMessage ? <p className="text-xs text-destructive">{run.errorMessage}</p> : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
