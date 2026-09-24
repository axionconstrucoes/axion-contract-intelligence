"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ContractAlertBatchItemAction } from "@/lib/email-actions/contract-alert-batch-types";

import { submitCompactContractAlertAction } from "./actions";
import {
  initialCompactContractAlertActionState,
} from "./actions-state";

export function CompactContractAlertActionForm({
  projectId,
  batchId,
  eventId,
  initialAction,
  members,
}: {
  projectId: string;
  batchId: string;
  eventId: string;
  initialAction: ContractAlertBatchItemAction;
  members: Array<{ userId: string; name: string }>;
}) {
  const boundAction = submitCompactContractAlertAction.bind(null, projectId, batchId, eventId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialCompactContractAlertActionState
  );

  if (state.success) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
        Ação registrada no ACC.
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="action" value={initialAction} />

      {initialAction === "ENVIADO_PARA" ? (
        <div className="grid gap-1.5 md:grid-cols-[110px_minmax(0,1fr)] md:items-center">
          <label htmlFor="assignedUserId" className="text-sm font-medium md:mb-0">
            Enviado para
          </label>
          <Select id="assignedUserId" name="assignedUserId" required defaultValue="">
            <option value="" disabled>
              Selecione um colaborador
            </option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {state.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}

      <Button type="submit" disabled={pending} className="md:self-end md:px-10">
        {pending ? "Confirmando…" : "CONFIRMAR"}
      </Button>
    </form>
  );
}
