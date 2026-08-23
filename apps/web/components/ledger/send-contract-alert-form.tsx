"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendContractAlertEmailAction } from "@/app/[projectId]/ledger/[eventId]/send-alert-actions";
import { initialSendContractAlertState } from "@/app/[projectId]/ledger/[eventId]/send-alert-actions-state";

export function SendContractAlertForm({ projectId, eventId }: { projectId: string; eventId: string }) {
  const [state, formAction, pending] = useActionState(
    sendContractAlertEmailAction,
    initialSendContractAlertState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="eventId" value={eventId} />

      <p className="text-xs font-medium text-muted-foreground">
        Enviar este achado como alerta por e-mail (padrão institucional ACC)
      </p>

      <div className="flex flex-wrap gap-2">
        <Input
          name="recipientEmail"
          type="email"
          required
          placeholder="destinatario@exemplo.com"
          className="max-w-xs"
        />
        <Input name="recipientName" type="text" placeholder="Nome (opcional)" className="max-w-xs" />
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "Enviando…" : "Enviar Alerta"}
        </Button>
      </div>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">{state.success}</p> : null}
    </form>
  );
}
