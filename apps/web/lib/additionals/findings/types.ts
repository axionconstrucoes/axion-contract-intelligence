// Tipos da fundação de persistência de findings de curadoria IA —
// espelham 1:1 public.ai_curation_runs / public.ai_findings (ver
// supabase/migrations/20260823080000_client_source_confrontation_and_findings.sql).
// Reutilizável além de "Propostas de Adicionais" (nunca acoplado só a
// project_additional_proposals).

import type { ExpertId, ExpertSeverity } from "../../ai/types";

export type AiCurationSourceType =
  | "DOCUMENT_VERSION"
  | "EMAIL"
  | "EMAIL_ATTACHMENT"
  | "SCHEDULE"
  | "ADDITIONAL_PROPOSAL_DRIVE_SOURCE"
  | "EVIDENCE"
  | "MANUAL";

export type AiCurationRunStatus = "RUNNING" | "COMPLETED" | "FAILED_PENDING_RETRY";

export interface AiCurationRun {
  id: string;
  projectId: string;
  sourceType: AiCurationSourceType;
  sourceId: string;
  sourceFingerprint: string;
  triggerType: "AUTOMATIC" | "MANUAL";
  status: AiCurationRunStatus;
  routedExpertIds: ExpertId[];
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdByType: "SYSTEM" | "USER" | "LEGACY";
  createdByUserId: string | null;
  createdByLabel: string | null;
  createdAt: string;
}

export type AiFindingLifecycleStatus = "NEW" | "PENDING_HUMAN_REVIEW" | "ACKNOWLEDGED" | "REJECTED" | "RESOLVED" | "SUPERSEDED";

export interface AiFindingSourceRef {
  type: string;
  id: string;
}

export interface AiFinding {
  id: string;
  projectId: string;
  curationRunId: string | null;
  findingType: string;
  classification: string | null;
  expertIds: ExpertId[];
  severity: ExpertSeverity;
  confidence: number;
  facts: string[];
  interpretation: string;
  recommendation: string;
  grounding: unknown | null;
  sourceRefs: AiFindingSourceRef[];
  conflictingSourceRefs: AiFindingSourceRef[];
  requiresHumanReview: true;
  lifecycleStatus: AiFindingLifecycleStatus;
  supersededByFindingId: string | null;
  fingerprint: string;
  reviewerNote: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
