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

export type AiFindingLifecycleStatus =
  | "NEW"
  | "PENDING_HUMAN_REVIEW"
  | "ACKNOWLEDGED"
  | "REJECTED"
  | "RESOLVED"
  | "SUPERSEDED"
  // Seção Start-up ACC — nunca usados fora do fluxo de revisão histórica de go-live.
  | "HISTORICAL_PENDING_STARTUP_REVIEW"
  | "DISMISSED_AT_STARTUP"
  | "RESOLVED_BEFORE_GO_LIVE"
  | "ACTION_CREATED";

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
  /** Data documental/de evento da fonte, quando disponível — nunca createdAt como única referência para decidir se é histórico. */
  effectiveDate: string | null;
  /** Preenchidos só quando lifecycleStatus = RESOLVED_BEFORE_GO_LIVE (Start-up ACC). */
  resolutionDescription: string | null;
  resolutionApproximateDate: string | null;
  resolutionEvidenceNote: string | null;
  createdAt: string;
  updatedAt: string;
}
