"use client";

import { useActionState } from "react";

import type { AlertSeverity } from "@axion/types";

import { AlertActionNotice } from "@/components/alerts/alert-action-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { respondDeliveryAlertAction } from "./actions";
import { initialDeliveryAlertActionState } from "./actions-state";

export function DeliveryAlertActionForm({
  projectId,
  itemId,
  action,
  severity,
  members,
}: {
  projectId: string;
  itemId: string;
  action: "RESOLVIDO" | "EM_ANDAMENTO" | "ENVIADO_PARA";
  severity: AlertSeverity;
  members: Array<{ userId: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(
    respondDeliveryAlertAction.bind(null, projectId, itemId, action),
    initialDeliveryAlertActionState
  );

  if (state.success) {
    return (
      <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
        Ação registrada no ACC. Você pode voltar ao e-mail.
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <AlertActionNotice action={action} severity={severity} />

      {action === "ENVIADO_PARA" ? (
        <label className="grid gap-1.5 text-sm font-medium">
          Enviado para
          <Select name="assignedUserId" required defaultValue="">
            <option value="" disabled>
              Selecione um colaborador
            </option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {action === "RESOLVIDO" ? (
        <>
          <p className="text-xs text-muted-foreground">
            Concluir a providência exige gestor, gerente ou administrador da obra e uma evidência/protocolo ou uma justificativa.
          </p>
          <label className="grid gap-1 text-sm font-medium">
            Evidência / documento / protocolo
            <Input name="evidence" />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Justificativa (se não houver evidência)
            <Textarea name="justification" rows={2} />
          </label>
        </>
      ) : null}

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="md:self-end md:px-10">
        {pending ? "Confirmando…" : "CONFIRMAR"}
      </Button>
    </form>
  );
}
