// Tipos de domínio da Matriz de Criticidade, SLA e Escalonamento. Puro,
// sem I/O — deliberadamente sem "server-only" para ser testável tanto
// pelo bundler do Next.js quanto por um script Node standalone (mesmo
// padrão de apps/web/lib/esg/types.ts e apps/web/lib/timeline-export/**).

export type SlaRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Timezone/expediente configurados por projeto (correção de timezone) — default institucional AXION (America/Sao_Paulo, 08:00–18:00). */
export interface SlaProjectSettings {
  projectId: string;
  timezone: string;
  businessDayStartHour: number;
  businessDayEndHour: number;
  updatedAt: string;
}

export type SlaArea =
  | "DIRETORIA"
  | "ADMINISTRATIVO"
  | "COMERCIAL"
  | "FINANCEIRO"
  | "ENGENHARIA"
  | "ORCAMENTO"
  | "JURIDICO"
  | "PLANEJAMENTO"
  | "ESG_SSMA";

/** Unidade de contagem de tempo (seção 20) — sem calendário corporativo completo, ver docs/sla-escalation.md "Limitações". */
export type SlaTimeUnit = "BUSINESS_HOURS" | "CLOCK_HOURS" | "BUSINESS_DAYS" | "CALENDAR_DAYS";

/** RESPONSÁVEL → 1º ESCALÃO → 2º ESCALÃO → DIRETORIA (seção 4 do requisito). */
export type SlaEscalationLevel = "RESPONSAVEL" | "ESCALAO_1" | "ESCALAO_2" | "DIRETORIA";

export type SlaActionStatus =
  | "PENDING"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "OVERDUE"
  | "ESCALATED"
  | "CANCELLED";

export type SlaActionOrigin =
  | "MANUAL"
  | "EXPERT_RECOMMENDATION"
  | "ESG_OBLIGATION"
  | "EVENT"
  | "ACTION_REQUEST"
  | "OTHER";

export type SlaEscalationReason =
  | "NO_ACKNOWLEDGMENT"
  | "NOT_RESPONDED"
  | "NOT_COMPLETED"
  | "CONTRACTUAL_DEADLINE_NEAR"
  | "CONTRACTUAL_DEADLINE_MISSED"
  | "NEW_EVIDENCE_INCREASED_RISK";

/** Responsáveis por área e escalão (seção 4) — cada nível é opcional. */
export interface SlaAreaResponsibles {
  id: string;
  projectId: string;
  area: SlaArea;
  responsibleDirectUserId: string | null;
  responsibleDirectName: string | null;
  escalation1UserId: string | null;
  escalation1Name: string | null;
  escalation2UserId: string | null;
  escalation2Name: string | null;
  boardUserId: string | null;
  boardName: string | null;
  updatedAt: string;
}

/** Uma linha da matriz configurável (seção 2/5) — risco (+ área opcional) → prazos. */
export interface SlaMatrixRule {
  id: string;
  projectId: string;
  riskLevel: SlaRiskLevel;
  area: SlaArea | null;
  timeUnit: SlaTimeUnit;
  assumeDeadlineValue: number;
  respondDeadlineValue: number | null;
  completeDeadlineValue: number | null;
  escalation2AfterValue: number;
  boardAfterValue: number;
  notifyByEmail: boolean;
  requiresAcknowledgmentConfirmation: boolean;
  requiresDelayJustification: boolean;
  isDefault: boolean;
  active: boolean;
}

export interface SlaAction {
  id: string;
  projectId: string;
  origin: SlaActionOrigin;
  originExpertId: string | null;
  title: string;
  description: string;
  riskLevel: SlaRiskLevel;
  area: SlaArea;
  responsibleUserId: string | null;
  responsibleName: string | null;
  status: SlaActionStatus;
  currentEscalationLevel: SlaEscalationLevel;
  contractualDeadline: string | null;
  assumeDueAt: string;
  respondDueAt: string | null;
  completeDueAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  completedAt: string | null;
  completedByUserId: string | null;
  completionNote: string | null;
  relatedEventId: string | null;
  relatedDocumentVersionId: string | null;
  relatedEsgObligationSubmissionId: string | null;
  relatedActionRequestId: string | null;
  createdByType: "SYSTEM" | "USER";
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SlaActionEscalation {
  id: string;
  actionId: string;
  projectId: string;
  fromLevel: SlaEscalationLevel;
  toLevel: SlaEscalationLevel;
  reason: SlaEscalationReason;
  notifiedUserId: string | null;
  escalatedAt: string;
}
