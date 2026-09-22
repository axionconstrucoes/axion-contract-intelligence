"use client";

import { useActionState, useMemo, useState } from "react";

import { SeverityBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  CONTRACT_ALERT_BATCH_ITEM_ACTIONS,
  CONTRACT_ALERT_BATCH_ITEM_ACTION_LABELS,
  type ContractAlertBatchItemAction,
} from "@/lib/email-actions/contract-alert-batch-types";
import { resolveContractAlertBatchAnsweredState } from "@/lib/email-actions/contract-alert-batch-validation";
import type { ContractAlertBatchViewItem } from "@/lib/email/get-contract-alert-batch";

import { submitContractAlertBatchAction } from "./actions";
import { initialSubmitContractAlertBatchState } from "./actions-state";

// Um bloco por alerta, cada um com sua PRÓPRIA coluna de ação alinhada
// ao lado (requisito 1: nunca uma coluna de ações genérica para todos
// os alertas). "VER EVENTO" é só um link de navegação (nunca aparece
// nesta lista de opções — não é um valor de ação possível, ver
// contract-alert-batch-types.ts) — por isso não conta como resposta.
export function ContractAlertBatchForm({
  batchId,
  projectId,
  items,
  members,
}: {
  batchId: string;
  projectId: string;
  items: ContractAlertBatchViewItem[];
  members: Array<{ userId: string; name: string }>;
}) {
  const boundAction = submitContractAlertBatchAction.bind(null, batchId, projectId);
  const [state, formAction, pending] = useActionState(boundAction, initialSubmitContractAlertBatchState);
  const [actions, setActions] = useState<Record<string, ContractAlertBatchItemAction | "">>(() =>
    Object.fromEntries(items.map((item) => [item.eventId, item.action ?? ""]))
  );
  const [assignees, setAssignees] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.eventId, item.assignedUserId ?? ""]))
  );

  // Mesma função pura usada pelo endpoint server-side
  // (contract-alert-batch-validation.ts) — a interface nunca inventa uma
  // segunda regra de "o que conta como respondido".
  const answeredState = useMemo(
    () =>
      resolveContractAlertBatchAnsweredState(
        items.map((item) => ({
          eventId: item.eventId,
          title: item.title,
          action: (actions[item.eventId] || null) as ContractAlertBatchItemAction | null,
          assignedUserId: assignees[item.eventId] || null,
        }))
      ),
    [actions, assignees, items]
  );

  if (state.success) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-sm font-medium text-emerald-800">
        Todos os alertas foram respondidos. A resposta ao ACC foi enviada.
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {items.map((item) => (
        <section
          key={item.eventId}
          id={`evento-${item.eventId}`}
          title={item.title}
          tabIndex={0}
          className="rounded-lg border bg-card p-4 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
        >
          <input type="hidden" name="eventId" value={item.eventId} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={item.severity} />
                <h2 className="font-semibold text-foreground">{item.title}</h2>
              </div>
            </div>

            <div className="grid w-full gap-2 sm:w-[260px]">
              <label className="text-xs font-medium" htmlFor={`action-${item.eventId}`}>
                Ação obrigatória
              </label>
              <Select
                id={`action-${item.eventId}`}
                name={`action:${item.eventId}`}
                required
                value={actions[item.eventId] ?? ""}
                onChange={(event) =>
                  setActions((current) => ({
                    ...current,
                    [item.eventId]: event.target.value as ContractAlertBatchItemAction | "",
                  }))
                }
              >
                <option value="" disabled>Selecione uma ação</option>
                {CONTRACT_ALERT_BATCH_ITEM_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {CONTRACT_ALERT_BATCH_ITEM_ACTION_LABELS[action]}
                  </option>
                ))}
              </Select>

              {actions[item.eventId] === "ENVIADO_PARA" ? (
                <>
                  <label className="text-xs font-medium" htmlFor={`assignee-${item.eventId}`}>
                    Enviado para
                  </label>
                  <Select
                    id={`assignee-${item.eventId}`}
                    name={`assignedUserId:${item.eventId}`}
                    required
                    value={assignees[item.eventId] ?? ""}
                    onChange={(event) => setAssignees((current) => ({ ...current, [item.eventId]: event.target.value }))}
                  >
                    <option value="" disabled>Selecione um colaborador</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.name}</option>
                    ))}
                  </Select>
                </>
              ) : null}
            </div>
          </div>
        </section>
      ))}

      <div className="sticky bottom-3 flex flex-col gap-2 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {answeredState.answeredCount} de {answeredState.totalCount} alertas respondidos
          </p>
          <Button type="submit" disabled={!answeredState.allEventsAnswered || pending}>
            {pending ? "Enviando resposta…" : "RESPONDER AO ACC"}
          </Button>
        </div>

        {!answeredState.allEventsAnswered ? (
          <div className="text-sm text-amber-700">
            <p>Todos os alertas precisam ter uma ação definida antes do envio.</p>
            {answeredState.pendingItems.length > 0 ? (
              <>
                <p className="mt-1 font-medium">Pendentes:</p>
                <ul className="list-disc pl-5">
                  {answeredState.pendingItems.map((pendingItem) => (
                    <li key={pendingItem.eventId}>{pendingItem.title}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {state.error ? (
        <div className="text-sm text-destructive">
          <p>{state.error}</p>
          {state.pendingItems.length > 0 ? (
            <ul className="list-disc pl-5">
              {state.pendingItems.map((pendingItem) => (
                <li key={pendingItem.eventId}>{pendingItem.title}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
