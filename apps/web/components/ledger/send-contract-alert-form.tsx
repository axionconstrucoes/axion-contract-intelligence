"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { sendContractAlertEmailAction } from "@/app/[projectId]/ledger/[eventId]/send-alert-actions";
import { initialSendContractAlertState } from "@/app/[projectId]/ledger/[eventId]/send-alert-actions-state";

export type EligibleAlertRecipient = { email: string; name: string };

// Destinatário é escolhido dentre os membros ACTIVE do projeto (passados
// pela página, já filtrados a partir da mesma fonte canônica usada pela
// tela de Usuários) — nunca digitado livremente. O campo Nome é só
// leitura e existe apenas para conferência visual: não tem atributo
// `name`, então nunca é enviado no FormData — o servidor resolve
// nome/e-mail de novo a partir do e-mail selecionado, sem confiar em
// nada vindo do navegador (ver send-alert-actions.ts).
export function SendContractAlertForm({
  projectId,
  eventId,
  eligibleRecipients,
}: {
  projectId: string;
  eventId: string;
  eligibleRecipients: EligibleAlertRecipient[];
}) {
  const [state, formAction, pending] = useActionState(
    sendContractAlertEmailAction,
    initialSendContractAlertState
  );

  const hasEligibleRecipients = eligibleRecipients.length > 0;
  const [recipientEmail, setRecipientEmail] = useState(eligibleRecipients[0]?.email ?? "");
  const selectedRecipient = eligibleRecipients.find((r) => r.email === recipientEmail) ?? null;

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="eventId" value={eventId} />

      <p className="text-xs font-medium text-muted-foreground">
        Enviar este achado como alerta por e-mail (padrão institucional ACC)
      </p>

      {hasEligibleRecipients ? (
        <div className="flex flex-wrap gap-2">
          <Select
            name="recipientEmail"
            required
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className="max-w-xs"
          >
            {eligibleRecipients.map((r) => (
              <option key={r.email} value={r.email}>
                {r.name} — {r.email}
              </option>
            ))}
          </Select>
          <Input
            type="text"
            value={selectedRecipient?.name ?? ""}
            readOnly
            placeholder="Nome"
            className="max-w-xs bg-muted"
          />
          <Button type="submit" disabled={pending} size="sm">
            {pending ? "Enviando…" : "Enviar Alerta"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-destructive">
          Nenhum usuário ativo elegível neste projeto para receber este alerta por e-mail.
        </p>
      )}

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">{state.success}</p> : null}
    </form>
  );
}
