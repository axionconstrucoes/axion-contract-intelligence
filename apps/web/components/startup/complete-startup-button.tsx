"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FeatureInfo } from "@/components/shared/feature-info";
import { completeStartupAction } from "@/app/[projectId]/startup/actions";
import { initialCompleteStartupState } from "@/app/[projectId]/startup/actions-state";

/** Só habilitado quando todos os findings históricos ALTO/CRÍTICO têm decisão humana (seção 14). */
export function CompleteStartupButton({ projectId, canComplete, pendingCount }: { projectId: string; canComplete: boolean; pendingCount: number }) {
  const [state, formAction, pending] = useActionState(completeStartupAction, initialCompleteStartupState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex items-center gap-1.5">
        <Button type="submit" disabled={!canComplete || pending}>
          {pending ? "Concluindo…" : "Concluir Start-up do projeto"}
        </Button>
        <FeatureInfo helpId="startup-complete" />
      </div>
      {!canComplete ? (
        <p className="text-xs text-muted-foreground">{pendingCount} finding(s) ALTO/CRÍTICO ainda sem decisão humana.</p>
      ) : null}
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Start-up concluído.</p> : null}
    </form>
  );
}
