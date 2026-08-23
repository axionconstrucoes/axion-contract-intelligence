// "Marcar como CONTRATADO" — seção "BOTÃO CONTRATADO" do requisito.
// Somente humano autenticado (RLS EDITOR, ver migration); esta função
// nunca é chamada por nenhum Expert IA. Não exige aditivo contratual —
// qualquer forma de formalização listada é aceita, inclusive
// NAO_IDENTIFICADO (a realidade operacional nunca é bloqueada
// artificialmente).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdditionalProposal } from "./get-additional-proposals";
import type { AdditionalProposal, AdditionalProposalDocumentalState, AdditionalProposalFormalizationType } from "./types";

export interface MarkAdditionalProposalContractedInput {
  proposalId: string;
  contractedAt: string;
  contractedValue?: number | null;
  formalizationType: AdditionalProposalFormalizationType;
  approvalEvidenceNote?: string | null;
  executionStarted: boolean;
  contractedNote?: string | null;
  documentalState: AdditionalProposalDocumentalState;
  /** Preenchidos só quando documentalState = CONTRATADO_FORMALIZACAO_COM_RESSALVA (ver seção "RESSALVA JURÍDICA"). */
  reservationConflictingClause?: string | null;
  reservationRisk?: string | null;
  reservationRecommendation?: string | null;
}

export async function markAdditionalProposalContracted(
  supabase: SupabaseClient,
  input: MarkAdditionalProposalContractedInput
): Promise<AdditionalProposal> {
  if (!input.contractedAt) {
    throw new Error("Data da contratação é obrigatória.");
  }
  if (input.documentalState === "CONTRATADO_FORMALIZACAO_COM_RESSALVA" && !input.reservationRisk?.trim()) {
    throw new Error("CONTRATADO — FORMALIZAÇÃO COM RESSALVA exige o risco identificado pelo Consultor Jurídico IA/humano.");
  }

  const { error } = await supabase
    .from("project_additional_proposals")
    .update({
      status: "CONTRACTED",
      contracted_at: input.contractedAt,
      contracted_value: input.contractedValue ?? null,
      formalization_type: input.formalizationType,
      approval_evidence_note: input.approvalEvidenceNote?.trim() || null,
      execution_started: input.executionStarted,
      contracted_note: input.contractedNote?.trim() || null,
      documental_state: input.documentalState,
      reservation_conflicting_clause: input.reservationConflictingClause?.trim() || null,
      reservation_risk: input.reservationRisk?.trim() || null,
      reservation_recommendation: input.reservationRecommendation?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.proposalId);

  if (error) throw new Error(`Falha ao marcar proposta como contratada: ${error.message}`);

  const updated = await getAdditionalProposal(supabase, input.proposalId);
  if (!updated) throw new Error("Proposta não encontrada após atualização.");
  return updated;
}
