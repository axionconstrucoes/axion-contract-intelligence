import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpertId, ExpertSeverity } from "../../ai/types";
import type { AiFinding, AiFindingSourceRef } from "./types";

const FINDING_COLUMNS =
  "id,project_id,curation_run_id,finding_type,classification,expert_ids,severity,confidence,facts,interpretation,recommendation,grounding,source_refs,conflicting_source_refs,requires_human_review,lifecycle_status,superseded_by_finding_id,fingerprint,reviewer_note,reviewed_by_user_id,reviewed_at,created_at,updated_at";

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

export async function getFindingsForProject(supabase: SupabaseClient, projectId: string): Promise<AiFinding[]> {
  const { data, error } = await supabase
    .from("ai_findings")
    .select(FINDING_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Falha ao carregar findings: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapRow);
}

export async function getFinding(supabase: SupabaseClient, findingId: string): Promise<AiFinding | null> {
  const { data, error } = await supabase.from("ai_findings").select(FINDING_COLUMNS).eq("id", findingId).maybeSingle();
  if (error) throw new Error(`Falha ao carregar finding: ${error.message}`);
  return data ? mapRow(data as unknown as Record<string, unknown>) : null;
}
