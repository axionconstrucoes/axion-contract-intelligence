"use client";

import { useActionState, useMemo, useState } from "react";

import { SeverityBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confrontationSeverityToAlertSeverity, formatDateTime } from "@/lib/labels";
import type { WeeklyDigestResponse, WeeklyDigestViewItem } from "@/lib/email/get-weekly-alert-digest";

import { submitWeeklyDigestAction } from "./actions";
import { initialSubmitWeeklyDigestState } from "./actions-state";

const RESPONSE_OPTIONS: Array<{ value: WeeklyDigestResponse; label: string }> = [
  { value: "AWARE", label: "Ciente" },
  { value: "STUDYING", label: "Estudando solução" },
  { value: "RESOLVED", label: "Resolvido" },
  { value: "FORWARDED", label: "Direcionar para…" },
];

export function WeeklyDigestForm({
  digestId,
  projectId,
  items,
  members,
}: {
  digestId: string;
  projectId: string;
  items: WeeklyDigestViewItem[];
  members: Array<{ userId: string; name: string }>;
}) {
  const boundAction = submitWeeklyDigestAction.bind(null, digestId, projectId);
  const [state, formAction, pending] = useActionState(boundAction, initialSubmitWeeklyDigestState);
  const [answers, setAnswers] = useState<Record<string, WeeklyDigestResponse | "">>({});
  const [directions, setDirections] = useState<Record<string, string>>({});

  const complete = useMemo(
    () => items.every((item) => {
      const answer = answers[item.actionId];
      return Boolean(answer) && (answer !== "FORWARDED" || Boolean(directions[item.actionId]));
    }),
    [answers, directions, items]
  );

  if (state.success) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-sm font-medium text-emerald-800">
        Todas as respostas foram registradas. As ações do ACC já foram atualizadas.
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {items.map((item) => (
        <section
          key={item.id}
          title={item.description || item.title}
          tabIndex={0}
          className="rounded-lg border bg-card p-4 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
        >
          <input type="hidden" name="actionId" value={item.actionId} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={confrontationSeverityToAlertSeverity[item.riskLevel]} />
                <h2 className="font-semibold text-foreground">{item.title}</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{item.description || "Sem detalhe adicional."}</p>
              {item.dueAt ? <p className="mt-1 text-xs text-muted-foreground">Prazo: {formatDateTime(item.dueAt)}</p> : null}
            </div>

            <div className="grid w-full gap-2 sm:w-[260px]">
              <label className="text-xs font-medium" htmlFor={`resolution-${item.actionId}`}>
                Tratamento obrigatório
              </label>
              <Select
                id={`resolution-${item.actionId}`}
                name={`resolution:${item.actionId}`}
                required
                value={answers[item.actionId] ?? ""}
                onChange={(event) => setAnswers((current) => ({
                  ...current,
                  [item.actionId]: event.target.value as WeeklyDigestResponse | "",
                }))}
              >
                <option value="" disabled>Selecione uma resposta</option>
                {RESPONSE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>

              {answers[item.actionId] === "FORWARDED" ? (
                <>
                  <label className="text-xs font-medium" htmlFor={`direction-${item.actionId}`}>Direcionar para</label>
                  <Select
                    id={`direction-${item.actionId}`}
                    name={`directedToUserId:${item.actionId}`}
                    required
                    value={directions[item.actionId] ?? ""}
                    onChange={(event) => setDirections((current) => ({ ...current, [item.actionId]: event.target.value }))}
                  >
                    <option value="" disabled>Selecione uma pessoa</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.name}</option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">Os prazos e o escalonamento não serão reiniciados.</p>
                </>
              ) : null}
            </div>
          </div>
        </section>
      ))}

      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
        <p className="text-sm text-muted-foreground">
          {complete ? "Todos os itens estão respondidos." : "Responda todos os itens para liberar o envio."}
        </p>
        <Button type="submit" disabled={!complete || pending}>
          {pending ? "Enviando respostas…" : "Enviar todas as respostas"}
        </Button>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
