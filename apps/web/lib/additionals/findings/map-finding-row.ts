// Mapeamento compartilhado linha->AiFinding — única fonte de verdade
// para não deixar persist-finding.ts/get-findings.ts divergirem sobre
// quais colunas existem.

import type { ExpertId, ExpertSeverity } from "../../ai/types";
import type { AiFinding, AiFindingSourceRef } from "./types";

export const FINDING_COLUMNS =
  "id,project_id,curation_run_id,finding_type,classification,expert_ids,severity,confidence,facts,interpretation,recommendation,grounding,source_refs,conflicting_source_refs,requires_human_review,lifecycle_status,superseded_by_finding_id,fingerprint,reviewer_note,reviewed_by_user_id,reviewed_at,effective_date,resolution_description,resolution_approximate_date,resolution_evidence_note,created_at,updated_at";

export function mapFindingRow(row: Record<string, unknown>): AiFinding {
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
    effectiveDate: (row.effective_date as string | null) ?? null,
    resolutionDescription: (row.resolution_description as string | null) ?? null,
    resolutionApproximateDate: (row.resolution_approximate_date as string | null) ?? null,
    resolutionEvidenceNote: (row.resolution_evidence_note as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
