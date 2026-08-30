"use client";

import { useActionState, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reviewEventClauseConfrontationCandidateAction } from "@/app/[projectId]/ledger/[eventId]/actions";
import { initialReviewEventClauseConfrontationCandidateState } from "@/app/[projectId]/ledger/[eventId]/actions-state";
import {
  CONFRONTATION_JUSTIFICATION_HELP_TEXT,
  MIN_JUSTIFICATION_LENGTH,
  validateConfrontationJustification,
} from "@/lib/ledger/confrontation-justification-validation";

// Justificativa obrigatória e específica em APROVAÇÃO e REJEIÇÃO — mesma
// função de validação (validateConfrontationJustification) usada aqui
// (feedback imediato) e no Server Action (fonte de verdade real: o
// servidor nunca confia neste gate do cliente, que pode ser contornado).
// "Aprovado"/"de acordo"/"possível relação"/"confronto humano aprovado"
// (o texto genérico visto no e-mail real do piloto) e equivalentes de
// rejeição são rejeitados nos dois lados.
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

  const [approveNote, setApproveNote] = useState("");
  const [approveClientError, setApproveClientError] = useState<string | null>(null);

  const [rejectNote, setRejectNote] = useState("");
  const [rejectClientError, setRejectClientError] = useState<string | null>(null);

  function guardSubmit(note: string, setClientError: (error: string | null) => void) {
    return (event: FormEvent<HTMLFormElement>) => {
      const result = validateConfrontationJustification(note);
      if (!result.valid) {
        event.preventDefault();
        setClientError(result.error);
        return;
      }
      setClientError(null);
    };
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        action={approveAction}
        onSubmit={guardSubmit(approveNote, setApproveClientError)}
        className="flex flex-col gap-3 rounded-md border p-4"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="reviewAction" value="APPROVE" />

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Justificativa da aprovação
          <span className="text-xs font-normal text-muted-foreground">{CONFRONTATION_JUSTIFICATION_HELP_TEXT}</span>
          <Textarea
            name="reviewNote"
            required
            minLength={MIN_JUSTIFICATION_LENGTH}
            rows={3}
            placeholder="Ex.: o prazo de pagamento proposto no evento (30 dias) diverge do prazo contratual, que é até o 25º dia, condicionado à nota fiscal e documentos."
            value={approveNote}
            onChange={(e) => setApproveNote(e.target.value)}
          />
        </label>

        {approveClientError ? <p className="text-sm text-destructive">{approveClientError}</p> : null}
        {approveState.error ? <p className="text-sm text-destructive">{approveState.error}</p> : null}

        <Button type="submit" disabled={approvePending}>
          {approvePending ? "Aprovando…" : "Aprovar relação"}
        </Button>
      </form>

      <form
        action={rejectAction}
        onSubmit={guardSubmit(rejectNote, setRejectClientError)}
        className="flex flex-col gap-3 rounded-md border border-destructive/30 p-4"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="reviewAction" value="REJECT" />

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Justificativa da rejeição
          <span className="text-xs font-normal text-muted-foreground">
            Explique por que este evento não se relaciona com esta cláusula.
          </span>
          <Textarea
            name="reviewNote"
            required
            minLength={MIN_JUSTIFICATION_LENGTH}
            rows={3}
            placeholder="Ex.: a cláusula trata de garantia de execução; o evento trata de atraso de entrega de material — não há relação de fato entre os dois."
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
        </label>

        {rejectClientError ? <p className="text-sm text-destructive">{rejectClientError}</p> : null}
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
