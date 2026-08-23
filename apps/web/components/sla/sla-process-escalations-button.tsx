"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { processSlaEscalationsAction } from "@/app/[projectId]/acoes/actions";
import { initialProcessSlaEscalationsState } from "@/app/[projectId]/acoes/actions-state";

// Dispara a varredura do motor determinístico de SLA (seção 10) — nenhum
// LLM decide aqui, só aritmética de datas já calculada em
// compute-escalation.ts. Enquanto não existir um agendador real (ver
// docs/sla-escalation.md "Limitações"), este botão é o gatilho.
export function SlaProcessEscalationsButton({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(
    processSlaEscalationsAction,
    initialProcessSlaEscalationsState
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Verificando…" : "Verificar escalonamentos"}
      </Button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      {!pending && state.escalatedCount > 0 ? (
        <span className="text-xs text-emerald-600">{state.escalatedCount} ação(ões) escalada(s).</span>
      ) : null}
    </form>
  );
}
