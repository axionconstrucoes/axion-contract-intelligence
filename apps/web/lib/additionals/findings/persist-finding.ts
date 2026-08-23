// Persistência de um finding — sempre dedup-aware (seção 12): mesmo
// fingerprint em estado não-SUPERSEDED nunca gera uma segunda linha,
// devolve a existente. Nunca escreve requires_human_review=false (CHECK
// do banco garante, mas a função nunca tenta enviar outro valor).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpertId, ExpertSeverity } from "../../ai/types";
import { FINDING_COLUMNS, mapFindingRow } from "./map-finding-row";
import type { AiFinding, AiFindingSourceRef } from "./types";

export interface PersistFindingInput {
  projectId: string;
  curationRunId: string | null;
  findingType: string;
  classification?: string | null;
  expertIds: ExpertId[];
  severity: ExpertSeverity;
  confidence: number;
  facts: string[];
  interpretation: string;
  recommendation: string;
  grounding?: unknown;
  sourceRefs: AiFindingSourceRef[];
  conflictingSourceRefs?: AiFindingSourceRef[];
  fingerprint: string;
  createdByUserId?: string;
  /** Data documental/de evento da fonte, quando disponível — ver Start-up ACC (nunca created_at como única referência). */
  effectiveDate?: string | null;
  /** Default "NEW" — Start-up ACC usa "HISTORICAL_PENDING_STARTUP_REVIEW" para findings anteriores a acc_operational_start_date. */
  initialLifecycleStatus?: AiFinding["lifecycleStatus"];
}

export interface PersistFindingResult {
  finding: AiFinding;
  /** false quando um finding com o mesmo fingerprint já existia (não-SUPERSEDED) e foi devolvido sem criar duplicata. */
  created: boolean;
}

export async function persistFinding(supabase: SupabaseClient, input: PersistFindingInput): Promise<PersistFindingResult> {
  const { data: existing, error: existingError } = await supabase
    .from("ai_findings")
    .select(FINDING_COLUMNS)
    .eq("project_id", input.projectId)
    .eq("finding_type", input.findingType)
    .eq("fingerprint", input.fingerprint)
    .neq("lifecycle_status", "SUPERSEDED")
    .maybeSingle();

  if (existingError) throw new Error(`Falha ao verificar finding existente: ${existingError.message}`);
  if (existing) {
    return { finding: mapFindingRow(existing as unknown as Record<string, unknown>), created: false };
  }

  const { data, error } = await supabase
    .from("ai_findings")
    .insert({
      project_id: input.projectId,
      curation_run_id: input.curationRunId,
      finding_type: input.findingType,
      classification: input.classification ?? null,
      expert_ids: input.expertIds,
      severity: input.severity,
      confidence: input.confidence,
      facts: input.facts,
      interpretation: input.interpretation,
      recommendation: input.recommendation,
      grounding: input.grounding ?? null,
      source_refs: input.sourceRefs,
      conflicting_source_refs: input.conflictingSourceRefs ?? [],
      requires_human_review: true,
      lifecycle_status: input.initialLifecycleStatus ?? "NEW",
      fingerprint: input.fingerprint,
      effective_date: input.effectiveDate ?? null,
    })
    .select(FINDING_COLUMNS)
    .single();

  if (error) throw new Error(`Falha ao persistir finding: ${error.message}`);
  return { finding: mapFindingRow(data as unknown as Record<string, unknown>), created: true };
}
