"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { esgObligationStatusLabels, type EsgObligationStatus } from "@/lib/labels";
import { reviewEsgObligationSubmissionAction } from "@/app/[projectId]/esg/actions";
import { initialReviewEsgSubmissionState } from "@/app/[projectId]/esg/actions-state";

const STATUS_OPTIONS = Object.keys(esgObligationStatusLabels) as EsgObligationStatus[];

export function EsgReviewForm({
  projectId,
  submissionId,
  currentStatus,
}: {
  projectId: string;
  submissionId: string;
  currentStatus: EsgObligationStatus;
}) {
  const [state, formAction, pending] = useActionState(
    reviewEsgObligationSubmissionAction,
    initialReviewEsgSubmissionState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="submissionId" value={submissionId} />

      <p className="text-xs font-medium text-muted-foreground">Revisar/ajustar status (ADMIN)</p>

      <div className="flex flex-wrap items-end gap-2">
        <Select name="newStatus" defaultValue={currentStatus} className="max-w-[220px]">
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {esgObligationStatusLabels[s]}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "Salvando…" : "Confirmar revisão"}
        </Button>
      </div>

      <Textarea name="reviewNote" rows={2} placeholder="Observação da revisão (obrigatória para Não aplicável/Dispensado)" />

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">Revisão registrada.</p> : null}
    </form>
  );
}
