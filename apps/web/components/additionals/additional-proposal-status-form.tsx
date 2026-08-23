"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { updateAdditionalProposalStatusAction } from "@/app/[projectId]/adicionais/actions";
import { initialUpdateAdditionalProposalStatusState } from "@/app/[projectId]/adicionais/actions-state";
import { additionalProposalStatusLabels } from "@/lib/labels";
import type { AdditionalProposalStatus } from "@/lib/additionals/types";

const NON_CONTRACTED_STATUSES: Exclude<AdditionalProposalStatus, "CONTRACTED">[] = [
  "POSSIBLE_ADDITIONAL",
  "UNDER_ANALYSIS",
  "IN_NEGOTIATION",
  "NOT_CONTRACTED",
  "CANCELLED",
];

/** Transições que não são "Marcar como CONTRATADO" (ver AdditionalProposalContractedForm, que exige mais campos). */
export function AdditionalProposalStatusForm({
  projectId,
  proposalId,
  currentStatus,
}: {
  projectId: string;
  proposalId: string;
  currentStatus: AdditionalProposalStatus;
}) {
  const [state, formAction, pending] = useActionState(updateAdditionalProposalStatusAction, initialUpdateAdditionalProposalStatusState);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Status
        <Select name="status" defaultValue={currentStatus === "CONTRACTED" ? "UNDER_ANALYSIS" : currentStatus}>
          {NON_CONTRACTED_STATUSES.map((s) => (
            <option key={s} value={s}>
              {additionalProposalStatusLabels[s]}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Salvando…" : "Atualizar status"}
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
