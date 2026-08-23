// Vincula uma proposta de adicional a uma fonte já existente no ACC
// (documento/e-mail/anexo/evento) — usado tanto para a origem da
// proposta (ORIGIN_SOURCE, seção "Fonte C") quanto para o checklist
// documental exigido ao marcar CONTRATADO (seção "DOCUMENTAÇÃO DO
// ADICIONAL CONTRATADO"). Mesma função para os dois casos — nunca duas
// implementações paralelas do mesmo vínculo polimórfico.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdditionalProposalLink, AdditionalProposalLinkRole } from "./types";

export interface LinkAdditionalProposalSourceInput {
  proposalId: string;
  linkRole: AdditionalProposalLinkRole;
  createdByUserId: string;
  documentVersionId?: string;
  emailId?: string;
  emailAttachmentId?: string;
  eventId?: string;
  /** Só válido para itens de checklist (nunca ORIGIN_SOURCE) — exige notApplicableJustification. */
  notApplicable?: boolean;
  notApplicableJustification?: string;
  note?: string;
}

export async function linkAdditionalProposalSource(
  supabase: SupabaseClient,
  input: LinkAdditionalProposalSourceInput
): Promise<AdditionalProposalLink> {
  const notApplicable = input.notApplicable ?? false;

  if (notApplicable && input.linkRole === "ORIGIN_SOURCE") {
    throw new Error("A origem da proposta (ORIGIN_SOURCE) nunca pode ser marcada como não aplicável.");
  }

  if (notApplicable && !input.notApplicableJustification?.trim()) {
    throw new Error("Justificativa é obrigatória ao marcar um item do checklist como não aplicável.");
  }

  const refCount = [input.documentVersionId, input.emailId, input.emailAttachmentId, input.eventId].filter(
    (v) => v != null && v !== ""
  ).length;

  if (notApplicable && refCount > 0) {
    throw new Error("Um vínculo não aplicável não pode referenciar nenhuma fonte.");
  }
  if (!notApplicable && refCount !== 1) {
    throw new Error("Um vínculo exige exatamente uma referência: documento, e-mail, anexo ou evento.");
  }

  const { data, error } = await supabase
    .from("project_additional_proposal_links")
    .insert({
      proposal_id: input.proposalId,
      link_role: input.linkRole,
      document_version_id: input.documentVersionId || null,
      email_id: input.emailId || null,
      email_attachment_id: input.emailAttachmentId || null,
      event_id: input.eventId || null,
      not_applicable: notApplicable,
      not_applicable_justification: notApplicable ? input.notApplicableJustification!.trim() : null,
      note: input.note?.trim() || null,
      created_by_type: "USER",
      created_by_user_id: input.createdByUserId,
    })
    .select(
      "id,proposal_id,link_role,document_version_id,email_id,email_attachment_id,event_id,not_applicable,not_applicable_justification,note,created_by_type,created_by_user_id,created_by_label,created_at"
    )
    .single();

  if (error) throw new Error(`Falha ao vincular fonte à proposta: ${error.message}`);

  return {
    id: data.id,
    proposalId: data.proposal_id,
    linkRole: data.link_role,
    documentVersionId: data.document_version_id,
    emailId: data.email_id,
    emailAttachmentId: data.email_attachment_id,
    eventId: data.event_id,
    notApplicable: data.not_applicable,
    notApplicableJustification: data.not_applicable_justification,
    note: data.note,
    createdByType: data.created_by_type,
    createdByUserId: data.created_by_user_id,
    createdByLabel: data.created_by_label,
    createdAt: data.created_at,
  };
}
