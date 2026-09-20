// Tipos puros da ingestão automática do cronograma semanal (.mpp) por
// e-mail. Sem I/O — dual-runtime (bundler do Next.js e scripts Node
// standalone via scripts/ts-module-resolver.mjs), mesmo padrão de
// apps/web/lib/email/attachments/types.ts.
//
// Espelham 1:1 as tabelas da migration
// 20260920120000_weekly_schedule_email_ingestion_foundation.sql.
//
// ESCALÃO: vem exclusivamente da Matriz de responsabilidades e prazos
// (apps/web/lib/sla/resolve-user-responsibility-tier.ts). A configuração
// do projeto só diz QUAIS escalões podem enviar (authorizedTiers).

import type { UserResponsibilityTier } from "../../sla/resolve-user-responsibility-tier";

export type { UserResponsibilityTier };

export type AuthorizedTier = "FIRST_TIER" | "SECOND_TIER";

export type WeeklyScheduleIntakeStatus =
  | "AUTHORIZED_AUTO"
  | "PENDING_HUMAN_REVIEW"
  | "APPROVED_HUMAN_REVIEW"
  | "REJECTED_HUMAN_REVIEW"
  | "REJECTED_UNAUTHORIZED_SENDER"
  | "REJECTED_RECIPIENT_MISMATCH"
  | "IGNORED_NO_MPP"
  | "IGNORED_OUTSIDE_WINDOW"
  /** Envio válido cujo .mpp (SHA-256) já era conhecido: conta como recebimento semanal, sem versão nova. */
  | "RECEIVED_DUPLICATE"
  | "FAILED";

/**
 * Códigos estáveis da regra que decidiu — gravados em
 * weekly_schedule_email_intakes.decision_rule para rastreabilidade
 * (fato: "esta regra foi aplicada"; nunca texto livre).
 */
export type WeeklyScheduleDecisionRule =
  | "AUTHORIZED_PLANNER_TIER"
  | "PLANNER_WITHOUT_PROJECT_LINK"
  | "MATRIX_NOT_CONFIGURED"
  | "MATRIX_AMBIGUOUS"
  | "AMBIGUOUS_MPP_ATTACHMENTS"
  | "SENDER_DOMAIN_NOT_CORPORATE"
  | "SENDER_NOT_REGISTERED"
  | "SENDER_NOT_PROJECT_MEMBER"
  | "SENDER_MEMBERSHIP_NOT_ACTIVE"
  | "SENDER_AREA_NOT_AUTHORIZED"
  | "SENDER_TIER_NOT_AUTHORIZED"
  | "NO_CLIENT_RECIPIENT"
  | "NO_MPP_ATTACHMENT"
  | "OUTSIDE_MONITORING_WINDOW"
  | "DUPLICATE_SHA256"
  | "HUMAN_REVIEW_APPROVED"
  | "INGESTION_FAILURE";

export interface WeeklyScheduleIngestionConfig {
  id: string;
  projectId: string;
  enabled: boolean;
  authorizedArea: string;
  /** Escalões da Matriz habilitados a enviar (habilita/bloqueia; nunca redefine o escalão). */
  authorizedTiers: AuthorizedTier[];
  /** Domínio corporativo exigido do remetente (sem "@", minúsculo). */
  senderDomain: string;
  clientRecipientDomains: string[];
  clientRecipientAddresses: string[];
  requireClientRecipient: boolean;
  cadence: "WEEKLY";
  /** ISO: 1 = segunda … 7 = domingo. */
  deadlineWeekday: number;
  /** "HH:MM" ou "HH:MM:SS" no fuso `timezone`. */
  deadlineTime: string;
  timezone: string;
  /** Janela efetiva já resolvida (config própria → e-mail do projeto → projeto). */
  monitoringStartAt: string | null;
  monitoringEndAt: string | null;
  targetDocumentId: string | null;
  attachmentNamePattern: string | null;
  alertRecipientUserIds: string[];
  lastScannedSentAt: string | null;
}

export interface EmailAttachmentDescriptor {
  gmailAttachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Só conhecido depois do download (nunca antes). */
  sha256Hash?: string | null;
}

/** Mensagem normalizada — nunca o objeto bruto da API Gmail. */
export interface WeeklyScheduleEmailCandidate {
  /** Linha em public.emails (null se a mensagem ainda não foi sincronizada). */
  emailId: string | null;
  gmailMessageId: string;
  gmailThreadId: string | null;
  messageIdHeader: string | null;
  /** Caixa monitorada de onde a mensagem foi lida (proveniência). */
  mailboxAddress: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  providerLabels: string[];
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  /** ISO datetime. */
  sentAt: string;
  attachments: EmailAttachmentDescriptor[];
}

/**
 * Situação do remetente em UM projeto — membership (status/area) +
 * escalão resolvido pela Matriz de responsabilidades para a área
 * autorizada (resolveUserResponsibilityTier). Nenhuma outra fonte.
 */
export interface SenderProjectStanding {
  projectId: string;
  membershipStatus: "ACTIVE" | "INACTIVE";
  area: string | null;
  tier: UserResponsibilityTier;
  tierReason: string;
}

export interface SenderResolution {
  email: string;
  /** null = nenhum profile com este e-mail. */
  userId: string | null;
  standings: SenderProjectStanding[];
}

export type SenderAuthorizationOutcome =
  | { kind: "AUTHORIZED"; userId: string; tier: AuthorizedTier }
  | {
      kind: "REVIEW";
      userId: string;
      tier: UserResponsibilityTier | null;
      rule: "PLANNER_WITHOUT_PROJECT_LINK" | "MATRIX_NOT_CONFIGURED" | "MATRIX_AMBIGUOUS";
      reasons: string[];
    }
  | {
      kind: "REJECTED";
      userId: string | null;
      tier: UserResponsibilityTier | null;
      rule:
        | "SENDER_DOMAIN_NOT_CORPORATE"
        | "SENDER_NOT_REGISTERED"
        | "SENDER_NOT_PROJECT_MEMBER"
        | "SENDER_MEMBERSHIP_NOT_ACTIVE"
        | "SENDER_AREA_NOT_AUTHORIZED"
        | "SENDER_TIER_NOT_AUTHORIZED";
      reasons: string[];
    };

export type MppAttachmentSelection =
  | { kind: "NONE" }
  | { kind: "SELECTED"; attachment: EmailAttachmentDescriptor; candidates: EmailAttachmentDescriptor[]; how: "ONLY_MPP" | "NAME_PATTERN" }
  | { kind: "AMBIGUOUS"; candidates: EmailAttachmentDescriptor[]; reasons: string[] };

export interface WeeklyScheduleEmailDecision {
  status: Extract<
    WeeklyScheduleIntakeStatus,
    "AUTHORIZED_AUTO" | "PENDING_HUMAN_REVIEW" | "REJECTED_UNAUTHORIZED_SENDER" | "REJECTED_RECIPIENT_MISMATCH" | "IGNORED_NO_MPP" | "IGNORED_OUTSIDE_WINDOW"
  >;
  rule: WeeklyScheduleDecisionRule;
  reasons: string[];
  senderUserId: string | null;
  /** Escalão segundo a Matriz (fato registrado como evidência). */
  senderTier: UserResponsibilityTier | null;
  /** Só presente quando AUTHORIZED_AUTO (identificação inequívoca). */
  selectedAttachment: EmailAttachmentDescriptor | null;
  /** Todos os .mpp vistos (para evidência mesmo quando ambíguo). */
  mppCandidates: EmailAttachmentDescriptor[];
}

export type ScheduleRiskDimension =
  | "FINAL_DATE_SLIP_DAYS"
  | "CONTRACT_MILESTONE_SLIP_DAYS"
  | "CRITICAL_PATH_CHANGED_COUNT"
  | "MIN_TOTAL_FLOAT_DAYS"
  | "OVERDUE_ACTIVITIES_COUNT"
  | "ADDED_REMOVED_ACTIVITIES_COUNT"
  | "DURATION_CHANGE_PERCENT"
  | "RELATION_CHANGES_COUNT"
  | "PHYSICAL_PROGRESS_SHORTFALL_PERCENT"
  | "DELAY_AGGRAVATION_DAYS"
  | "S_CURVE_DEVIATION_PP"
  | "S_CURVE_FULFILLMENT_PERCENT"
  | "S_CURVE_AGGRAVATION_PP"
  | "S_CURVE_MPP_DIVERGENCE_PP"
  | "FINANCIAL_DEVIATION_PERCENT"
  | "HISTOGRAM_SHORTFALL_PERCENT"
  | "BASELINE_SHEET_DIVERGENCE_DAYS";

export interface ScheduleRiskThreshold {
  dimension: ScheduleRiskDimension;
  medium: number;
  high: number;
  critical: number;
}

export type ScheduleRiskClassification = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "REVIEW_REQUIRED";

export type ScheduleComparisonType = "PREVIOUS_WEEKLY" | "OFFICIAL_BASELINE";
