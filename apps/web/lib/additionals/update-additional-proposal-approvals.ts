// Atualiza os status independentes (seção "APROVAÇÕES INDEPENDENTES") —
// nunca inferidos uns dos outros nem do status geral da proposta.
// CONTRATADO nunca implica prazo aprovado; cada campo só muda quando
// explicitamente informado.
//
// GAP CONHECIDO (governança de rejeição de recomendações relevantes,
// ver apps/web/lib/governance/reject-relevant-recommendation.ts) —
// investigado a fundo, não presumido:
//
// project_additional_proposals NÃO possui nenhuma coluna de severidade
// compatível com o enum LOW/MEDIUM/HIGH/CRITICAL usado por
// ai_findings.severity/sla_actions.risk_level (reservation_risk é texto
// livre, não um enum controlado). Relações reais verificadas e
// descartadas como fonte canônica:
//   - project_additional_proposal_links pode apontar a um contract_event
//     (link_role='ORIGIN_SOURCE') cujo aiAssessment.severity existe —
//     mas o vínculo é opcional, esparso (só quando source_type=
//     'EXISTING'), e aiAssessment em si é nullable; não é uma
//     classificação da PROPOSTA, é uma classificação eventual de uma
//     fonte de origem que a proposta pode ou não ter.
//   - computeScheduleFormalizationAlert (schedule-formalization-alert.ts)
//     e computeClosingGateAssessment (closing-gate.ts) calculam
//     indicadores próprios (severity/cumulativeImpactStatus), mas
//     disparados por condições completamente diferentes (CONTRATADO +
//     prazo pendente; risco cumulativo de OUTRAS propostas do projeto) —
//     nunca representam "a severidade desta rejeição".
//   - Nenhuma FK liga project_additional_proposals a ai_findings ou
//     sla_actions como classificação própria.
//
// Conclusão: NÃO existe fonte canônica de severidade para esta
// entidade — a política ALTO/CRÍTICO não pode ser aplicada
// objetivamente a scopeApprovalStatus/commercialApprovalStatus/
// scheduleExtensionStatus sem inventar uma classificação de risco que
// não existe no schema. Nenhuma mudança de comportamento foi feita
// aqui por esse motivo.
//
// Evolução mínima de schema que resolveria isto (NÃO implementada
// nesta etapa, sem necessidade demonstrada): uma coluna própria, ex.
// `risk_severity text check (risk_severity in ('LOW','MEDIUM','HIGH',
// 'CRITICAL'))`, nullable, preenchida por decisão humana explícita (ou
// por um futuro Expert) no momento da rejeição — só então
// updateAdditionalProposalApprovals poderia rotear REJECTED de
// severidade ALTO/CRÍTICO para o mesmo reject_relevant_finding()/
// mecanismo central, sem duplicar a regra.

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
