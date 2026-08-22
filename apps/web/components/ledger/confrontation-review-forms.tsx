"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  initialReviewEventClauseConfrontationCandidateState,
  reviewEventClauseConfrontationCandidateAction,
} from "@/app/[projectId]/ledger/[eventId]/actions";

export function ConfrontationReviewForms({
  projectId,
  eventId,
  candidateId,
}: {
  projectId: string;
  eventId: string;
  candidateId: string;
}) {
  const [approveState, approveAction, approvePending] = useActionState(
    reviewEventClauseConfrontationCandidateAction,
    initialReviewEventClauseConfrontationCandidateState
  );

  const [rejectState, rejectAction, rejectPending] = useActionState(
    reviewEventClauseConfrontationCandidateAction,
    initialReviewEventClauseConfrontationCandidateState
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={approveAction} className="flex flex-col gap-3 rounded-md border p-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="reviewAction" value="APPROVE" />

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Observação da revisão
          <span className="text-xs font-normal text-muted-foreground">Opcional para aprovação.</span>
          <Textarea
            name="reviewNote"
            rows={2}
            placeholder="Ex.: confronto confirmado após validação da cláusula."
          />
        </label>

        {approveState.error ? <p className="text-sm text-destructive">{approveState.error}</p> : null}

        <Button type="submit" disabled={approvePending}>
          {approvePending ? "Aprovando…" : "Aprovar relação"}
        </Button>
      </form>

      <form action={rejectAction} className="flex flex-col gap-3 rounded-md border border-destructive/30 p-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="reviewAction" value="REJECT" />

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Justificativa da rejeição
          <span className="text-xs font-normal text-muted-foreground">Campo obrigatório.</span>
          <Textarea
            name="reviewNote"
            required
            rows={2}
            placeholder="Explique por que este confronto não deve ser aprovado."
          />
        </label>

        {rejectState.error ? <p className="text-sm text-destructive">{rejectState.error}</p> : null}

        <Button
          type="submit"
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10"
          disabled={rejectPending}
        >
          {rejectPending ? "Rejeitando…" : "Rejeitar"}
        </Button>
      </form>
    </div>
  );
}
