"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { BatchSummary } from "@/lib/documents/multi-upload/types";

type Props = {
  summary: BatchSummary;
  // Remove SÓ os itens ERRO do estado local do lote (nunca toca em
  // documento/versão/Storage já persistidos) — ver clearAllErrors em
  // use-document-upload-queue.ts.
  onClearErrors: () => void;
};

export function UploadSummaryBar({ summary, onClearErrors }: Props) {
  if (summary.total === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Progresso geral</span>
        <span className="text-muted-foreground">{summary.overallPercent}%</span>
      </div>

      <Progress value={summary.overallPercent} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Total: {summary.total}</span>
        <span>Concluídos: {summary.completed}</span>
        {summary.pendingReview > 0 ? (
          <span>Aguardando análise (Ata de Reunião): {summary.pendingReview}</span>
        ) : null}
        <span>Processando: {summary.processing}</span>
        <span>Duplicados: {summary.duplicated}</span>
        <span>Rejeitados: {summary.rejected}</span>
        <span>Com erro: {summary.errored}</span>

        {summary.errored > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClearErrors}
          >
            Limpar todos os erros
          </Button>
        ) : null}
      </div>
    </div>
  );
}
