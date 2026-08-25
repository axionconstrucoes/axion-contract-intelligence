"use client";

import { Progress } from "@/components/ui/progress";
import type { BatchSummary } from "@/lib/documents/multi-upload/types";

export function UploadSummaryBar({ summary }: { summary: BatchSummary }) {
  if (summary.total === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Progresso geral</span>
        <span className="text-muted-foreground">{summary.overallPercent}%</span>
      </div>

      <Progress value={summary.overallPercent} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Total: {summary.total}</span>
        <span>Concluídos: {summary.completed}</span>
        {summary.pendingReview > 0 ? (
          <span>Aguardando análise (Ata de Reunião): {summary.pendingReview}</span>
        ) : null}
        <span>Processando: {summary.processing}</span>
        <span>Duplicados: {summary.duplicated}</span>
        <span>Rejeitados: {summary.rejected}</span>
        <span>Com erro: {summary.errored}</span>
      </div>
    </div>
  );
}
