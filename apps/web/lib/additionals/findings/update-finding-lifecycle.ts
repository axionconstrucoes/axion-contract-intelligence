// Transições de lifecycle de um finding — sempre humano (RLS EDITOR).
// IA nunca chama esta função; ela só faz INSERT (persist-finding.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinding } from "./get-findings";
import type { AiFinding } from "./types";

export interface UpdateFindingLifecycleInput {
  findingId: string;
  lifecycleStatus: Extract<AiFinding["lifecycleStatus"], "ACKNOWLEDGED" | "REJECTED" | "RESOLVED">;
  reviewedByUserId: string;
  reviewerNote?: string | null;
}

export async function updateFindingLifecycle(supabase: SupabaseClient, input: UpdateFindingLifecycleInput): Promise<AiFinding> {
  const { error } = await supabase
    .from("ai_findings")
    .update({
      lifecycle_status: input.lifecycleStatus,
      reviewed_by_user_id: input.reviewedByUserId,
      reviewed_at: new Date().toISOString(),
      reviewer_note: input.reviewerNote ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.findingId);

  if (error) throw new Error(`Falha ao atualizar status do finding: ${error.message}`);

  const updated = await getFinding(supabase, input.findingId);
  if (!updated) throw new Error("Finding não encontrado após atualização.");
  return updated;
}

/** Marca um finding antigo como SUPERSEDED por um finding novo (nova evidência material) — nunca apaga o antigo. */
export async function supersedeFinding(supabase: SupabaseClient, oldFindingId: string, newFindingId: string): Promise<void> {
  const { error } = await supabase
    .from("ai_findings")
    .update({ lifecycle_status: "SUPERSEDED", superseded_by_finding_id: newFindingId, updated_at: new Date().toISOString() })
    .eq("id", oldFindingId);
  if (error) throw new Error(`Falha ao marcar finding como substituído: ${error.message}`);
}
