// Atualiza os status independentes (seção "APROVAÇÕES INDEPENDENTES") —
// nunca inferidos uns dos outros nem do status geral da proposta.
// CONTRATADO nunca implica prazo aprovado; cada campo só muda quando
// explicitamente informado.
//
// GAP CONHECIDO (governança de rejeição de recomendações relevantes,
// ver apps/web/lib/governance/reject-relevant-recommendation.ts):
// project_additional_proposals NÃO possui nenhuma coluna de severidade
// compatível com o enum LOW/MEDIUM/HIGH/CRITICAL usado por
// ai_findings.severity/sla_actions.risk_level (reservation_risk é texto
// livre, não um enum controlado) — portanto a política "ALTO/CRÍTICO +
// REJECTED exige justificativa + escalonamento" não pode ser aplicada
// objetivamente a scopeApprovalStatus/commercialApprovalStatus/
// scheduleExtensionStatus hoje, sem inventar uma classificação de risco
// que não existe no schema. Nenhuma mudança de comportamento foi feita
// aqui por esse motivo — ver relatório da implementação para o registro
// completo da lacuna.

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
