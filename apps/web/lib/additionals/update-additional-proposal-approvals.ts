// Atualiza os status independentes (seção "APROVAÇÕES INDEPENDENTES") —
// nunca inferidos uns dos outros nem do status geral da proposta.
// CONTRATADO nunca implica prazo aprovado; cada campo só muda quando
// explicitamente informado.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdditionalProposal } from "./get-additional-proposals";
import type {
  AdditionalProposal,
  AdditionalProposalApprovalStatus,
  AdditionalProposalExecutionStatus,
  AdditionalProposalScheduleExtensionStatus,
} from "./types";

export interface UpdateAdditionalProposalApprovalsInput {
  proposalId: string;
  scopeApprovalStatus?: AdditionalProposalApprovalStatus;
  commercialApprovalStatus?: AdditionalProposalApprovalStatus;
  scheduleExtensionStatus?: AdditionalProposalScheduleExtensionStatus;
  executionStatus?: AdditionalProposalExecutionStatus;
}

export async function updateAdditionalProposalApprovals(
  supabase: SupabaseClient,
  input: UpdateAdditionalProposalApprovalsInput
): Promise<AdditionalProposal> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.scopeApprovalStatus) updates.scope_approval_status = input.scopeApprovalStatus;
  if (input.commercialApprovalStatus) updates.commercial_approval_status = input.commercialApprovalStatus;
  if (input.scheduleExtensionStatus) updates.schedule_extension_status = input.scheduleExtensionStatus;
  if (input.executionStatus) updates.execution_status = input.executionStatus;

  if (Object.keys(updates).length === 1) {
    throw new Error("Nenhum status de aprovação informado para atualizar.");
  }

  const { error } = await supabase.from("project_additional_proposals").update(updates).eq("id", input.proposalId);
  if (error) throw new Error(`Falha ao atualizar aprovações da proposta: ${error.message}`);

  const updated = await getAdditionalProposal(supabase, input.proposalId);
  if (!updated) throw new Error("Proposta não encontrada após atualização.");
  return updated;
}
