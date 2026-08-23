"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FeatureInfo } from "@/components/shared/feature-info";
import { updateAdditionalProposalApprovalsAction } from "@/app/[projectId]/adicionais/actions";
import { initialUpdateAdditionalProposalApprovalsState } from "@/app/[projectId]/adicionais/actions-state";
import {
  additionalProposalApprovalStatusLabels,
  additionalProposalScheduleExtensionStatusLabels,
} from "@/lib/labels";
import type { AdditionalProposal } from "@/lib/additionals/types";

const APPROVAL_OPTIONS: AdditionalProposal["scopeApprovalStatus"][] = ["NOT_EVALUATED", "NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"];
const SCHEDULE_OPTIONS: AdditionalProposal["scheduleExtensionStatus"][] = [
  "NOT_EVALUATED",
  "NOT_REQUIRED",
  "TO_BE_REQUESTED",
  "REQUESTED",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "REJECTED",
];
const EXECUTION_OPTIONS: AdditionalProposal["executionStatus"][] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];

/**
 * Os quatro status independentes (seção "APROVAÇÕES INDEPENDENTES") —
 * nunca inferidos uns dos outros. CONTRATADO nunca implica prazo
 * aprovado; por isso este formulário existe separado de "Marcar como
 * CONTRATADO".
 */
export function AdditionalProposalApprovalsForm({ projectId, proposal }: { projectId: string; proposal: AdditionalProposal }) {
  const [state, formAction, pending] = useActionState(updateAdditionalProposalApprovalsAction, initialUpdateAdditionalProposalApprovalsState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposal.id} />
      <p className="text-sm font-medium">Aprovações independentes</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Aprovação de escopo
          <Select name="scopeApprovalStatus" defaultValue={proposal.scopeApprovalStatus}>
            {APPROVAL_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {additionalProposalApprovalStatusLabels[v]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Aprovação comercial
          <Select name="commercialApprovalStatus" defaultValue={proposal.commercialApprovalStatus}>
            {APPROVAL_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {additionalProposalApprovalStatusLabels[v]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium">
          <span className="flex items-center gap-1.5">
            Extensão de prazo
            <FeatureInfo helpId="adicionais-status-prazo" />
          </span>
          <Select name="scheduleExtensionStatus" defaultValue={proposal.scheduleExtensionStatus}>
            {SCHEDULE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {additionalProposalScheduleExtensionStatusLabels[v]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Execução
          <Select name="executionStatus" defaultValue={proposal.executionStatus}>
            {EXECUTION_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v === "NOT_STARTED" ? "Não iniciada" : v === "IN_PROGRESS" ? "Em andamento" : "Concluída"}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Aprovações atualizadas.</p> : null}

      <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
        {pending ? "Salvando…" : "Salvar aprovações"}
      </Button>
    </form>
  );
}
