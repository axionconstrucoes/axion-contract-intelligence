// Cria uma proposta de adicional — três origens (seção B do requisito):
// DRIVE, MANUAL, EXISTING. RLS garante que só um EDITOR autenticado
// consegue inserir (ver migration); esta função nunca usa service-role.
// Sempre insere via o client recebido — nunca decide de qual client usar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { linkAdditionalProposalSource } from "./link-additional-proposal-source";
import type { AdditionalProposal, AdditionalProposalSourceType } from "./types";
import { getAdditionalProposal } from "./get-additional-proposals";

export interface CreateAdditionalProposalInput {
  projectId: string;
  createdByUserId: string;
  proposalNumber: string;
  title: string;
  description?: string;
  sourceType: AdditionalProposalSourceType;
  /** Obrigatório quando sourceType = DRIVE (URL ou ID — ao menos um). */
  driveUrl?: string | null;
  driveFileId?: string | null;
  proposalDate?: string | null;
  proposedValue?: number | null;
  note?: string | null;
  /** Obrigatório quando sourceType = EXISTING (Fonte C) — exatamente uma referência. */
  origin?: {
    documentVersionId?: string;
    emailId?: string;
    emailAttachmentId?: string;
    eventId?: string;
    note?: string;
  };
}

export async function createAdditionalProposal(
  supabase: SupabaseClient,
  input: CreateAdditionalProposalInput
): Promise<AdditionalProposal> {
  const proposalNumber = input.proposalNumber.trim();
  const title = input.title.trim();
  if (!proposalNumber) throw new Error("Número da proposta é obrigatório.");
  if (!title) throw new Error("Título é obrigatório.");

  if (input.sourceType === "DRIVE" && !input.driveUrl?.trim() && !input.driveFileId?.trim()) {
    throw new Error("Origem Drive exige URL da pasta/arquivo ou Drive ID.");
  }

  if (input.sourceType === "EXISTING") {
    const origin = input.origin;
    const refCount = [origin?.documentVersionId, origin?.emailId, origin?.emailAttachmentId, origin?.eventId].filter(
      (v) => v != null && v !== ""
    ).length;
    if (refCount !== 1) {
      throw new Error("Origem 'fonte já existente' exige exatamente uma referência: documento, e-mail, anexo ou evento.");
    }
  }

  const { data, error } = await supabase
    .from("project_additional_proposals")
    .insert({
      project_id: input.projectId,
      proposal_number: proposalNumber,
      title,
      description: input.description?.trim() ?? "",
      source_type: input.sourceType,
      drive_url: input.sourceType === "DRIVE" ? (input.driveUrl?.trim() || null) : null,
      drive_file_id: input.sourceType === "DRIVE" ? (input.driveFileId?.trim() || null) : null,
      proposal_date: input.proposalDate || null,
      proposed_value: input.proposedValue ?? null,
      note: input.note?.trim() || null,
      created_by_type: "USER",
      created_by_user_id: input.createdByUserId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao criar proposta de adicional: ${error.message}`);

  if (input.sourceType === "EXISTING" && input.origin) {
    await linkAdditionalProposalSource(supabase, {
      proposalId: data.id,
      linkRole: "ORIGIN_SOURCE",
      createdByUserId: input.createdByUserId,
      documentVersionId: input.origin.documentVersionId,
      emailId: input.origin.emailId,
      emailAttachmentId: input.origin.emailAttachmentId,
      eventId: input.origin.eventId,
      note: input.origin.note,
    });
  }

  const created = await getAdditionalProposal(supabase, data.id);
  if (!created) throw new Error("Proposta criada, mas não foi possível recarregá-la.");
  return created;
}
