// "[JÁ TRATADO / PACIFICADO]" (seção 10) — descrição de como foi
// resolvido, data aproximada opcional, usuário, evidência opcional. Só
// humano (RLS EDITOR). Nunca gera novamente alerta do mesmo fato só
// porque a evidência histórica continua existindo — ver dedup/fingerprint
// já aplicado em persist-finding.ts (seção 16).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinding } from "../additionals/findings/get-findings";
import type { AiFinding } from "../additionals/findings/types";

export interface ResolveHistoricalFindingInput {
  findingId: string;
  description: string;
  approximateDate?: string | null;
  evidenceNote?: string | null;
  reviewedByUserId: string;
}

export async function resolveHistoricalFinding(supabase: SupabaseClient, input: ResolveHistoricalFindingInput): Promise<AiFinding> {
  if (!input.description.trim()) {
    throw new Error("Descrição de como foi resolvido é obrigatória.");
  }

  const { error } = await supabase
    .from("ai_findings")
    .update({
      lifecycle_status: "RESOLVED_BEFORE_GO_LIVE",
      resolution_description: input.description.trim(),
      resolution_approximate_date: input.approximateDate || null,
      resolution_evidence_note: input.evidenceNote?.trim() || null,
      reviewed_by_user_id: input.reviewedByUserId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.findingId);

  if (error) throw new Error(`Falha ao marcar finding como pacificado: ${error.message}`);

  const updated = await getFinding(supabase, input.findingId);
  if (!updated) throw new Error("Finding não encontrado após atualização.");
  return updated;
}
