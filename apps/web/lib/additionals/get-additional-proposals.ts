// Leitura somente-leitura de propostas de adicionais + seus vínculos.
// Nenhuma escrita acontece aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdditionalProposal, AdditionalProposalLink } from "./types";

const PROPOSAL_COLUMNS =
  "id,project_id,proposal_number,title,description,source_type,drive_url,drive_file_id,proposal_date,proposed_value,note,status,scope_approval_status,commercial_approval_status,schedule_extension_status,execution_status,contracted_at,contracted_value,formalization_type,approval_evidence_note,execution_started,contracted_note,documental_state,reservation_conflicting_clause,reservation_risk,reservation_recommendation,created_by_type,created_by_user_id,created_by_label,created_at,updated_at";

const LINK_COLUMNS =
  "id,proposal_id,link_role,document_version_id,email_id,email_attachment_id,event_id,not_applicable,not_applicable_justification,note,created_by_type,created_by_user_id,created_by_label,created_at";

function mapProposalRow(row: Record<string, unknown>): AdditionalProposal {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    proposalNumber: row.proposal_number as string,
    title: row.title as string,
    description: row.description as string,
    sourceType: row.source_type as AdditionalProposal["sourceType"],
    driveUrl: (row.drive_url as string | null) ?? null,
    driveFileId: (row.drive_file_id as string | null) ?? null,
    proposalDate: (row.proposal_date as string | null) ?? null,
    proposedValue: (row.proposed_value as number | null) ?? null,
    note: (row.note as string | null) ?? null,
    status: row.status as AdditionalProposal["status"],
    scopeApprovalStatus: row.scope_approval_status as AdditionalProposal["scopeApprovalStatus"],
    commercialApprovalStatus: row.commercial_approval_status as AdditionalProposal["commercialApprovalStatus"],
    scheduleExtensionStatus: row.schedule_extension_status as AdditionalProposal["scheduleExtensionStatus"],
    executionStatus: row.execution_status as AdditionalProposal["executionStatus"],
    contractedAt: (row.contracted_at as string | null) ?? null,
    contractedValue: (row.contracted_value as number | null) ?? null,
    formalizationType: (row.formalization_type as AdditionalProposal["formalizationType"]) ?? null,
    approvalEvidenceNote: (row.approval_evidence_note as string | null) ?? null,
    executionStarted: (row.execution_started as boolean | null) ?? null,
    contractedNote: (row.contracted_note as string | null) ?? null,
    documentalState: (row.documental_state as AdditionalProposal["documentalState"]) ?? null,
    reservationConflictingClause: (row.reservation_conflicting_clause as string | null) ?? null,
    reservationRisk: (row.reservation_risk as string | null) ?? null,
    reservationRecommendation: (row.reservation_recommendation as string | null) ?? null,
    createdByType: row.created_by_type as AdditionalProposal["createdByType"],
    createdByUserId: (row.created_by_user_id as string | null) ?? null,
    createdByLabel: (row.created_by_label as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapLinkRow(row: Record<string, unknown>): AdditionalProposalLink {
  return {
    id: row.id as string,
    proposalId: row.proposal_id as string,
    linkRole: row.link_role as AdditionalProposalLink["linkRole"],
    documentVersionId: (row.document_version_id as string | null) ?? null,
    emailId: (row.email_id as string | null) ?? null,
    emailAttachmentId: (row.email_attachment_id as string | null) ?? null,
    eventId: (row.event_id as string | null) ?? null,
    notApplicable: row.not_applicable as boolean,
    notApplicableJustification: (row.not_applicable_justification as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdByType: row.created_by_type as AdditionalProposalLink["createdByType"],
    createdByUserId: (row.created_by_user_id as string | null) ?? null,
    createdByLabel: (row.created_by_label as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export async function getAdditionalProposals(supabase: SupabaseClient, projectId: string): Promise<AdditionalProposal[]> {
  const { data, error } = await supabase
    .from("project_additional_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao carregar propostas de adicionais: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapProposalRow);
}

export async function getAdditionalProposal(supabase: SupabaseClient, proposalId: string): Promise<AdditionalProposal | null> {
  const { data, error } = await supabase
    .from("project_additional_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("id", proposalId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar proposta de adicional: ${error.message}`);
  return data ? mapProposalRow(data as unknown as Record<string, unknown>) : null;
}

export async function getAdditionalProposalLinks(supabase: SupabaseClient, proposalId: string): Promise<AdditionalProposalLink[]> {
  const { data, error } = await supabase
    .from("project_additional_proposal_links")
    .select(LINK_COLUMNS)
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Falha ao carregar vínculos da proposta: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapLinkRow);
}
