// Persistência de um finding — sempre dedup-aware (seção 12): mesmo
// fingerprint em estado não-SUPERSEDED nunca gera uma segunda linha,
// devolve a existente. Nunca escreve requires_human_review=false (CHECK
// do banco garante, mas a função nunca tenta enviar outro valor).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpertId, ExpertSeverity } from "../../ai/types";
import type { AiFinding, AiFindingSourceRef } from "./types";

function mapRow(row: Record<string, unknown>): AiFinding {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    curationRunId: (row.curation_run_id as string | null) ?? null,
    findingType: row.finding_type as string,
    classification: (row.classification as string | null) ?? null,
    expertIds: (row.expert_ids as ExpertId[]) ?? [],
    severity: row.severity as ExpertSeverity,
    confidence: row.confidence as number,
    facts: (row.facts as string[]) ?? [],
    interpretation: row.interpretation as string,
    recommendation: row.recommendation as string,
    grounding: row.grounding ?? null,
    sourceRefs: (row.source_refs as AiFindingSourceRef[]) ?? [],
    conflictingSourceRefs: (row.conflicting_source_refs as AiFindingSourceRef[]) ?? [],
    requiresHumanReview: true,
    lifecycleStatus: row.lifecycle_status as AiFinding["lifecycleStatus"],
    supersededByFindingId: (row.superseded_by_finding_id as string | null) ?? null,
    fingerprint: row.fingerprint as string,
    reviewerNote: (row.reviewer_note as string | null) ?? null,
    reviewedByUserId: (row.reviewed_by_user_id as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const FINDING_COLUMNS =
  "id,project_id,curation_run_id,finding_type,classification,expert_ids,severity,confidence,facts,interpretation,recommendation,grounding,source_refs,conflicting_source_refs,requires_human_review,lifecycle_status,superseded_by_finding_id,fingerprint,reviewer_note,reviewed_by_user_id,reviewed_at,created_at,updated_at";

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
    return { finding: mapRow(existing as unknown as Record<string, unknown>), created: false };
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
      lifecycle_status: "NEW",
      fingerprint: input.fingerprint,
    })
    .select(FINDING_COLUMNS)
    .single();

  if (error) throw new Error(`Falha ao persistir finding: ${error.message}`);
  return { finding: mapRow(data as unknown as Record<string, unknown>), created: true };
}
