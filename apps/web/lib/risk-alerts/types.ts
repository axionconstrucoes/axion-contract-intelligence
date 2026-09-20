// Tipos do motor de alertas de risco (puro, sem I/O, sem "server-only").
//
// Política de entrega (piloto):
//   LOW / MEDIUM  -> nunca individual; um único consolidado semanal por
//                    destinatário, quarta-feira 07:00 no timezone do projeto.
//   HIGH / CRITICAL -> imediato na criação ou quando o risco sobe para esse
//                    nível; escalonamento Nível 1 -> Nível 2 -> Nível 3 pelos
//                    prazos da Matriz (motor computeEscalation existente).
// Allowlist do piloto POR user_id: qualquer destinatário fora dela é
// registrado como PILOT_RECIPIENT_SUPPRESSED, nunca enviado.

import type { SlaArea, SlaEscalationLevel, SlaRiskLevel } from "@/lib/sla/types";
import type { MatrixPolicy } from "@/lib/sla/resolve-matrix-policy";

export type RiskCaseSourceType = "SCHEDULE_COMPARISON" | "WEEKLY_REPORT_SHEET" | "INGESTION_ALERT";
export type RiskCaseLevel = SlaRiskLevel | "REVIEW_REQUIRED";
export type RiskNotificationType = "IMMEDIATE" | "ESCALATION" | "DIGEST" | "FORWARD" | "RETURNED" | "EXPERT_ANSWER" | "ACTION_CONFIRMATION";
export type RiskOutboxOrigin = "AUTOMATIC" | "MANUAL" | "EMAIL_REPLY" | "WEB_ACTION";
export type RiskOutboxStatus = "PENDING" | "SENT" | "FAILED" | "SUPPRESSED" | "SKIPPED";

export type RiskSuppressionReason =
  | "PILOT_RECIPIENT_SUPPRESSED"
  | "PILOT_ALLOWLIST_MISSING"
  | "USER_NOT_ACTIVE"
  | "EMAIL_MISSING"
  | "EMAIL_NOT_CORPORATE"
  | "MATRIX_AMBIGUOUS"
  | "CONFIGURATION_REVIEW_REQUIRED"
  | "NOTIFY_BY_EMAIL_DISABLED"
  | "FEATURE_DISABLED"
  | "PROJECT_DISABLED"
  | "PROVIDER_NOT_CONFIGURED"
  | "DRY_RUN"
  | "PILOT_PROJECT_NOT_CONFIRMED"
  | "MATRIX_RULES_NOT_EXPLICIT"
  | "SEVERITY_MAP_NOT_CONFIGURED"
  | "REPLY_MAILBOX_NOT_CONFIGURED"
  | "RISK_CASE_REQUIRED"
  | "TOP_LEVEL_REACHED";

export const DIGEST_WEEKDAY = 3; // quarta-feira (0 = domingo)
export const DIGEST_HOUR_LOCAL = 7; // 07:00 no timezone do projeto
export const DEFAULT_PROJECT_TIMEZONE = "America/Sao_Paulo";
export const MAX_SEND_ATTEMPTS = 3;

/** Caso de risco normalizado a partir de uma fonte do módulo semanal. */
export interface RiskCaseInput {
  sourceType: RiskCaseSourceType;
  sourceId: string;
  area: SlaArea;
  riskLevel: RiskCaseLevel;
  title: string;
  summary: string;
  impact: string;
  recommendation: string | null;
  /** Hash determinístico do estado relevante — muda => risco alterado. */
  fingerprint: string;
  /** Caminho relativo no ACC (sem host) da evidência/origem. */
  originPath: string;
  /** true quando a fonte já foi superada/resolvida (encerra o caso). */
  closed: boolean;
  /** Referência humana (WNN, categoria, tipo) para ordenação/exibição. */
  reference: string;
}

/** Caso já persistido (risk_alert_cases). */
export interface RiskCaseRecord {
  id: string;
  sourceType: RiskCaseSourceType;
  sourceId: string;
  area: SlaArea;
  riskLevel: RiskCaseLevel;
  previousRiskLevel: RiskCaseLevel | null;
  fingerprint: string;
  status: "OPEN" | "CLOSED";
  slaActionId: string | null;
  lastDigestWindow: string | null;
  firstSeenAt: string;
  lastChangedAt: string;
  closedAt: string | null;
  title: string;
  summary: string;
  impact: string;
  recommendation: string | null;
  originPath: string;
  reference: string;
  state: AlertState;
  currentLevel: SlaEscalationLevel;
  currentResponsibleUserId: string | null;
  previousResponsibleUserId: string | null;
  /** Limite de escalonamento já registrado (uma única vez; sem novo e-mail). */
  topLevelReachedAt: string | null;
  visibleCode: string;
}

/** Estado da ação SLA vinculada (sla_actions) — verdade sobre assumir/tratar/concluir. */
export interface LinkedSlaActionState {
  id: string;
  status: "PENDING" | "ACKNOWLEDGED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "ESCALATED" | "CANCELLED";
  currentEscalationLevel: SlaEscalationLevel;
  assumeDueAt: string;
  respondDueAt: string | null;
  completeDueAt: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  contractualDeadline: string | null;
  responsibleUserId: string | null;
}

export interface RecipientProfile {
  userId: string;
  name: string | null;
  email: string | null;
  membershipStatus: "ACTIVE" | "INACTIVE" | string | null;
}

export interface RiskAlertProjectConfig {
  enabled: boolean;
  riskAlertsEnabled: boolean;
  /** null/[] = allowlist não configurada => nenhum envio. */
  pilotRecipientAllowlistUserIds: string[] | null;
  senderDomain: string | null;
  /** Severidade por tipo de alerta de ausência — null = não configurado. */
  severityMap: IngestionAlertSeverityMap | null;
  /** Confirmação humana do projeto piloto real. */
  pilotProjectConfirmedAt: string | null;
}

export interface PlannedRecipient {
  userId: string;
  email: string | null;
  name: string | null;
  status: "PENDING" | "SUPPRESSED";
  suppressionReason: RiskSuppressionReason | null;
}

export interface PlannedOutboxEntry {
  idempotencyKey: string;
  notificationType: RiskNotificationType;
  escalationLevel: SlaEscalationLevel | null;
  riskLevel: SlaRiskLevel | "DIGEST";
  /** Chave do caso: id persistido ou (sourceType:sourceId) quando ainda não existe. */
  caseKey: string | null;
  slaActionId: string | null;
  recipient: PlannedRecipient;
  scheduledFor: string;
  digestWindow: string | null;
  matrixRuleSnapshot: Record<string, unknown>;
  payloadSummary: Record<string, unknown>;
  /** Conteúdo para montar o e-mail (nunca persistido integralmente). */
  content: ImmediateAlertContent | DigestContent;
}

export interface ImmediateAlertContent {
  kind: "IMMEDIATE" | "ESCALATION";
  caseTitle: string;
  reference: string;
  riskLevel: SlaRiskLevel;
  area: SlaArea;
  summary: string;
  impact: string;
  recommendation: string | null;
  originPath: string;
  slaActionId: string | null;
  levelLabel: string;
  previousLevelLabel: string | null;
  responsibleName: string | null;
  deadlineLabel: string;
  deadlineAt: string | null;
  requiresAcknowledgment: boolean;
  requiresJustification: boolean;
  escalationReason: string | null;
  changed: boolean;
}

export interface DigestItem {
  caseKey: string;
  riskLevel: "LOW" | "MEDIUM";
  area: SlaArea;
  title: string;
  reference: string;
  summary: string;
  deadlineAt: string | null;
  responsibleName: string | null;
  originPath: string;
  slaActionId: string | null;
  state: "NEW" | "CHANGED" | "OPEN" | "CLOSED";
}

export interface DigestContent {
  kind: "DIGEST";
  window: string;
  mediumItems: DigestItem[];
  lowItems: DigestItem[];
  closedItems: DigestItem[];
}

export interface PlannedSlaActionCreate {
  caseKey: string;
  title: string;
  description: string;
  area: SlaArea;
  riskLevel: SlaRiskLevel;
  responsibleUserId: string | null;
  assumeDueAt: string;
  respondDueAt: string | null;
  completeDueAt: string | null;
}

export interface PlannedEscalation {
  slaActionId: string;
  caseKey: string;
  expectedCurrentLevel: SlaEscalationLevel;
  newLevel: SlaEscalationLevel;
  reason: string;
  reasons: string[];
}

export interface PlannedCaseUpsert {
  caseKey: string;
  existingId: string | null;
  input: RiskCaseInput;
  change: "NEW" | "CHANGED" | "RAISED" | "LOWERED" | "CLOSED" | "UNCHANGED" | "REOPENED";
  policy: MatrixPolicy | null;
  lastDigestWindow: string | null;
}

export interface PlannedAuditEvent {
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
}

/** Prazo da Diretoria (boardAfterValue) vencido: registrar TOP_LEVEL_REACHED uma única vez — sem destinatário, sem e-mail. */
export interface PlannedTopLevelReached {
  caseKey: string;
  slaActionId: string;
  reasons: string[];
}

export interface RiskAlertPlan {
  blockedReason: RiskSuppressionReason | null;
  caseUpserts: PlannedCaseUpsert[];
  slaActionCreates: PlannedSlaActionCreate[];
  escalations: PlannedEscalation[];
  topLevelReached: PlannedTopLevelReached[];
  outbox: PlannedOutboxEntry[];
  audit: PlannedAuditEvent[];
  digestWindow: { key: string; isOpen: boolean } | null;
}

// ------------------------------------------------------------------
// Consolidação: ações formais, máquina de estados, encaminhamento,
// respostas por e-mail, prontidão do piloto.
// ------------------------------------------------------------------

export type AlertState =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "FORWARDED"
  | "AWAITING_RECIPIENT_ACTION"
  | "RETURNED_TO_SENDER"
  | "EXPERT_CONSULTATION_PENDING"
  | "EXPERT_ANSWERED"
  | "RESOLUTION_PROPOSED"
  | "RESOLVED"
  | "REVIEW_REQUIRED"
  | "TOP_LEVEL_REACHED";

/** As cinco opções formais do alerta (+ confirmação da resolução proposta). */
export type AlertActionType = "RESOLVED" | "TAKING_ACTION" | "FORWARD" | "EXPERT_CONSULTATION" | "OTHER" | "RESOLUTION_CONFIRMED";

export type AlertActionOrigin = "WEB" | "EMAIL" | "SYSTEM";

export type AlertEventType =
  | AlertActionType
  | "RESOLUTION_PROPOSED"
  | "EXPERT_ANSWERED"
  | "IMMEDIATE_ESCALATION"
  | "SCHEDULED_ESCALATION"
  | "TOP_LEVEL_REACHED"
  | "FORWARD_TIMEOUT"
  | "RETURNED_TO_SENDER"
  | "REPLY_RECEIVED"
  | "REPLY_REVIEW_REQUIRED"
  | "UNAUTHORIZED_REPLY";

export const ALERT_ACTION_LABELS: Record<AlertActionType, string> = {
  RESOLVED: "RESOLVIDO",
  TAKING_ACTION: "TOMANDO PROVIDÊNCIAS",
  FORWARD: "ENVIAR P/",
  EXPERT_CONSULTATION: "ESPECIALISTA",
  OTHER: "OUTRO",
  RESOLUTION_CONFIRMED: "CONFIRMAR RESOLUÇÃO",
};

export const ALERT_STATE_LABELS: Record<AlertState, string> = {
  OPEN: "Aberto",
  ACKNOWLEDGED: "Ciência registrada",
  IN_PROGRESS: "Tomando providências",
  FORWARDED: "Encaminhado",
  AWAITING_RECIPIENT_ACTION: "Aguardando ação do encaminhado",
  RETURNED_TO_SENDER: "Devolvido ao responsável anterior",
  EXPERT_CONSULTATION_PENDING: "Consulta ao Expert pendente",
  EXPERT_ANSWERED: "Expert respondeu",
  RESOLUTION_PROPOSED: "Resolução proposta (revisão humana)",
  RESOLVED: "Resolvido",
  REVIEW_REQUIRED: "Revisão humana necessária",
  TOP_LEVEL_REACHED: "Limite de escalonamento atingido",
};

export type ExpertId = "planning-director" | "commercial-director" | "esg-director" | "legal-consultant" | "ceo";

export type ReplyClassification =
  | "ACKNOWLEDGEMENT"
  | "JUSTIFICATION"
  | "DECISION"
  | "QUESTION_TO_EXPERT"
  | "REQUEST_MORE_INFORMATION"
  | "DISAGREEMENT"
  | "STATUS_UPDATE"
  | "UNCLASSIFIED";

export type ReplyCorrelationMethod = "IN_REPLY_TO" | "REFERENCES" | "REPLY_TO_TOKEN" | "VISIBLE_CODE" | "NONE";

export type ReplyMessageStatus =
  | "SENT"
  | "RECEIVED"
  | "PROCESSED"
  | "IGNORED_AUTO_REPLY"
  | "IGNORED_BOUNCE"
  | "IGNORED_SELF"
  | "IGNORED_LOOP"
  | "PENDING_HUMAN_REVIEW"
  | "EXPERT_SELECTION_REVIEW_REQUIRED"
  | "UNAUTHORIZED_REPLY"
  | "REVIEW_REQUIRED";

/** Severidade configurável por projeto para os alertas de ausência/divergência. */
export type IngestionAlertSeverityMap = Partial<Record<string, SlaRiskLevel>>;

export interface PilotReadinessInput {
  featureEnabled: boolean;
  config: RiskAlertProjectConfig | null;
  providerConfigured: boolean;
  /** Regras explícitas gravadas (sla_matrix_rules) por nível de risco (genéricas ou por área). */
  explicitRuleLevels: SlaRiskLevel[];
  /** Status da Matriz para as áreas em uso. */
  matrixStatuses: Array<{ area: SlaArea; status: "OK" | "CONFIGURATION_REVIEW_REQUIRED"; missing: string[] }>;
  allowlistValid: boolean;
  projectConfirmed: boolean;
  workspaceConfigured: boolean;
  severityMapConfigured: boolean;
  /** Caixa inbound oficial (GOOGLE_GMAIL_INBOUND_MAILBOX) configurada — sem ela não há Reply-To nem resposta por e-mail. */
  replyMailboxConfigured: boolean;
}

export type PilotReadinessBlocker =
  | "FEATURE_DISABLED"
  | "PROJECT_DISABLED"
  | "PROVIDER_NOT_CONFIGURED"
  | "MATRIX_RULES_NOT_EXPLICIT"
  | "CONFIGURATION_REVIEW_REQUIRED"
  | "PILOT_ALLOWLIST_MISSING"
  | "PILOT_PROJECT_NOT_CONFIRMED"
  | "WORKSPACE_NOT_CONFIGURED"
  | "SEVERITY_MAP_NOT_CONFIGURED"
  | "REPLY_MAILBOX_NOT_CONFIGURED";
