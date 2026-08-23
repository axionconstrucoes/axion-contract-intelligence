// Transições de status que NÃO envolvem contratação (ver
// mark-additional-proposal-contracted.ts para CONTRACTED, que exige
// campos adicionais e nunca é feito por aqui).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdditionalProposal } from "./get-additional-proposals";
import type { AdditionalProposal, AdditionalProposalStatus } from "./types";

const NON_CONTRACTED_STATUSES: Exclude<AdditionalProposalStatus, "CONTRACTED">[] = [
  "POSSIBLE_ADDITIONAL",
  "UNDER_ANALYSIS",
  "IN_NEGOTIATION",
  "NOT_CONTRACTED",
  "CANCELLED",
];

export async function updateAdditionalProposalStatus(
  supabase: SupabaseClient,
  input: { proposalId: string; status: Exclude<AdditionalProposalStatus, "CONTRACTED"> }
): Promise<AdditionalProposal> {
  if (!NON_CONTRACTED_STATUSES.includes(input.status)) {
    throw new Error(`Status inválido: "${input.status}". Use markAdditionalProposalContracted para marcar CONTRATADO.`);
  }

  const { error } = await supabase
    .from("project_additional_proposals")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.proposalId);

  if (error) throw new Error(`Falha ao atualizar status da proposta: ${error.message}`);

  const updated = await getAdditionalProposal(supabase, input.proposalId);
  if (!updated) throw new Error("Proposta não encontrada após atualização.");
  return updated;
}
