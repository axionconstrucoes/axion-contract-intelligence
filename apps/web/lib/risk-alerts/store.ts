// Portas do motor de alertas de risco — interfaces puras. Implementação
// real em supabase-store.ts (worker, service role); implementações em
// memória nos testes (scripts/test-pilot-risk-alerts.mjs).

import type { SlaAreaResponsibles, SlaMatrixRule, SlaProjectSettings } from "@/lib/sla/types";

import type { ActiveForward, AlertCaseSnapshot, AlertTransition } from "./alert-state-machine";
import type { CorrelationIndex, InboundHeaders } from "./replies/reply-pipeline";
import type {
  AlertActionType,
  ExpertId,
  LinkedSlaActionState,
  PlannedAuditEvent,
  PlannedEscalation,
  PlannedOutboxEntry,
  PlannedSlaActionCreate,
  RecipientProfile,
  ReplyClassification,
  ReplyCorrelationMethod,
  ReplyMessageStatus,
  RiskAlertProjectConfig,
  RiskCaseInput,
  RiskCaseRecord,
} from "./types";

export interface RiskAlertProjectSnapshot {
  projectId: string;
  projectName: string;
  config: RiskAlertProjectConfig | null;
  matrixRules: SlaMatrixRule[];
  areaResponsibles: SlaAreaResponsibles[];
  settings: SlaProjectSettings | null;
  cases: RiskCaseInput[];
  existingCases: RiskCaseRecord[];
  linkedActions: Map<string, LinkedSlaActionState>;
  recipients: Map<string, RecipientProfile>;
  existingIdempotencyKeys: Set<string>;
  previousDigestSentAt: string | null;
  /** Mailbox remetente configurada (Google Workspace) — null = não configurado. */
  senderMailbox: string | null;
  /** Caixa inbound OFICIAL monitorada (GOOGLE_GMAIL_INBOUND_MAILBOX) — base do Reply-To; null = sem resposta por e-mail => bloqueio. */
  replyMailbox: string | null;
}

export interface PersistedOutboxEntry {
  id: string;
  entry: PlannedOutboxEntry;
  caseId: string | null;
}

/** Entrada PENDING de outra origem/ciclo (manual, ação humana, retry) — conteúdo reconstruído do caso. */
export interface PendingOutboxRow {
  id: string;
  caseId: string | null;
  slaActionId: string | null;
  notificationType: string;
  escalationLevel: string | null;
  riskLevel: string;
  recipientUserId: string;
  idempotencyKey: string;
  payloadSummary: Record<string, unknown>;
  origin: string;
  attemptCount: number;
}

export interface OutboundMessageRecord {
  projectId: string;
  caseId: string | null;
  conversationId: string | null;
  outboxId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId: string | null;
  messageIdHeader: string;
  inReplyTo: string | null;
  references: string[];
  replyTokenHash: string | null;
  recipients: string[];
  subject: string;
  sentAt: string;
}

export interface InboundMessageRow {
  id: string;
  projectId: string;
  providerMessageId: string;
  headers: InboundHeaders;
  bodyOriginal: string;
  receivedAt: string;
}

export interface PendingExpertConsultation {
  eventId: string;
  caseId: string;
  projectId: string;
  expertId: ExpertId;
  question: string;
  askedByUserId: string | null;
  createdAt: string;
}

export interface RiskAlertStore {
  listEnabledProjectIds(): Promise<string[]>;
  loadProjectSnapshot(projectId: string): Promise<RiskAlertProjectSnapshot>;
  upsertCases(projectId: string, upserts: Array<{ caseKey: string; existingId: string | null; input: RiskCaseInput; change: string; policyStatus: string; policyMissing: string[]; previousRiskLevel: string | null; now: string }>): Promise<Map<string, string>>;
  createSlaActions(projectId: string, creates: PlannedSlaActionCreate[], caseIds: Map<string, string>): Promise<Map<string, string>>;
  applyEscalations(projectId: string, escalations: PlannedEscalation[]): Promise<{ applied: number; skipped: number }>;
  enqueue(projectId: string, entries: PlannedOutboxEntry[], caseIds: Map<string, string>, slaActionIds: Map<string, string>): Promise<PersistedOutboxEntry[]>;
  /** PENDING com tentativas restantes que NÃO foram planejadas neste ciclo (manual, ação, retry órfão). */
  listPendingRows(projectId: string): Promise<PendingOutboxRow[]>;
  loadCaseRecord(caseId: string): Promise<RiskCaseRecord | null>;
  markSent(id: string, result: { recipientEmail: string; provider: string; providerMessageId: string; emailId: string | null; sentAt: string; messageIdHeader: string; conversationId: string | null }): Promise<void>;
  markFailed(id: string, sanitizedError: string): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  markDigestWindow(caseIds: string[], window: string): Promise<void>;
  recordEmail(projectId: string, input: { from: string; to: string; subject: string; sentAt: string; snippet: string }): Promise<string | null>;
  audit(projectId: string, events: PlannedAuditEvent[]): Promise<void>;

  // ---- conversa / mensagens ----
  ensureConversation(projectId: string, caseId: string): Promise<{ id: string; rootMessageIdHeader: string | null; providerThreadId: string | null; replyTokenHash: string | null }>;
  setConversationRoot(conversationId: string, rootMessageIdHeader: string, providerThreadId: string | null): Promise<void>;
  recordOutboundMessage(record: OutboundMessageRecord): Promise<void>;
  loadCorrelationIndex(projectId: string): Promise<CorrelationIndex & { seenMessageIds: Set<string> }>;
  listInboundToProcess(projectId: string): Promise<InboundMessageRow[]>;
  updateInboundMessage(id: string, patch: { caseId?: string | null; conversationId?: string | null; senderUserId?: string | null; bodyClean?: string; quotedText?: string; signatureText?: string; classification?: ReplyClassification | null; confidence?: number | null; correlationMethod?: ReplyCorrelationMethod; requiresHumanReview?: boolean; expertId?: string | null; expertRouting?: Record<string, unknown> | null; status: ReplyMessageStatus; statusReason?: string | null }): Promise<void>;

  // ---- ações / estados ----
  loadCaseSnapshotForAction(caseId: string): Promise<{ snapshot: AlertCaseSnapshot; record: RiskCaseRecord; alertRecipientUserIds: string[] } | null>;
  applyTransition(caseId: string, transition: AlertTransition, actorUserId: string | null, options?: { actionLinkTokenHash?: string | null }): Promise<{ state: string; escalationId: string | null }>;
  listActiveForwards(projectId: string): Promise<Array<ActiveForward & { caseId: string }>>;
  listPendingExpertConsultations(projectId: string): Promise<PendingExpertConsultation[]>;
  recordExpertAnswer(input: { projectId: string; caseId: string; eventId: string; expertId: ExpertId; answerText: string; confidence: number; requiresHumanReview: boolean; askedByUserId: string | null }): Promise<void>;
  createActionLinks(projectId: string, caseId: string, recipientUserId: string, links: Array<{ action: AlertActionType; tokenHash: string; expiresAt: string }>): Promise<void>;
}
