// Portas de persistência da ingestão semanal — interfaces PURAS. Os
// orquestradores (ingest-weekly-schedule-email.ts,
// prepare-schedule-comparisons.ts, create-absence-alerts.ts,
// promote-reviewed-intake.ts, process-weekly-report-workbooks.ts,
// classify-synced-emails.ts)
// dependem só destas interfaces, o que permite:
//   - testá-los com um store em memória (scripts/test-*.mjs) sem tocar
//     o banco nem a API Gmail;
//   - um único adaptador Supabase (supabase-store.ts) concentrar todo
//     o SQL/Storage e reutilizar as funções já existentes
//     (ingestEmailAttachmentsForMessage, resolveUserResponsibilityTier,
//     tabelas de documentos).

import type { EmailAttachmentClassification, EmailDocumentClassification } from "../../email/registry/classify-email-document";
import type { WorkbookProcessingContext } from "../weekly-report/process-workbook";
import type { ExtractedSheet, WeeklyReportWorkbookStatus, WorkbookSafetyReport, WorkbookSheetIndexEntry } from "../weekly-report/types";
import type { ScheduleSnapshot } from "./compare-schedule-versions";
import type {
  EmailAttachmentDescriptor,
  ScheduleComparisonType,
  ScheduleRiskClassification,
  ScheduleRiskDimension,
  ScheduleRiskThreshold,
  SenderResolution,
  UserResponsibilityTier,
  WeeklyScheduleEmailCandidate,
  WeeklyScheduleIngestionConfig,
  WeeklyScheduleIntakeStatus,
} from "./types";

export interface AuditEntry {
  projectId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
}

export interface IngestedMppAttachment {
  /** email_attachments.id */
  id: string;
  sha256Hash: string;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ExistingDocumentVersion {
  id: string;
  documentId: string;
}

export interface CreateScheduleDocumentVersionInput {
  projectId: string;
  documentId: string;
  attachment: IngestedMppAttachment;
  candidate: Pick<WeeklyScheduleEmailCandidate, "sentAt" | "gmailMessageId" | "subject" | "fromAddress">;
  /** Nome/e-mail do remetente para document_versions.author (rastreabilidade). */
  author: string;
  weekStart: string;
}

/** Lançado pelo store quando o índice único (project_id, sha256_hash) rejeita a versão (corrida concorrente). */
export class DuplicateDocumentVersionError extends Error {
  // Sem "parameter properties": este módulo também roda sob o type
  // stripping nativo do Node (scripts/*.mjs), que só aceita sintaxe apagável.
  readonly existing: ExistingDocumentVersion | null;

  constructor(existing: ExistingDocumentVersion | null) {
    super("DUPLICATE_FILE_HASH");
    this.name = "DuplicateDocumentVersionError";
    this.existing = existing;
  }
}

export interface WeeklyScheduleIntakeRecord {
  projectId: string;
  configId: string;
  emailId: string | null;
  mailboxAddress: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  syncSource: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  messageIdHeader: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  sentAt: string;
  providerLabels: string[];
  weekStart: string;
  workWeekNumber: number | null;
  workWeekLabel: string | null;
  workWeekStatus: "IDENTIFIED" | "NOT_IDENTIFIED" | "HUMAN_SET";
  attachments: EmailAttachmentDescriptor[];
  senderUserId: string | null;
  senderTier: UserResponsibilityTier | null;
  status: WeeklyScheduleIntakeStatus;
  decisionRule: string;
  decisionReasons: string[];
  failureError: string | null;
  selectedEmailAttachmentId: string | null;
  selectedSha256Hash: string | null;
  documentVersionId: string | null;
  duplicateOfDocumentVersionId: string | null;
}

export interface WeeklyScheduleIngestionStore {
  findIntakeByMessage(projectId: string, gmailMessageId: string): Promise<{ id: string; status: WeeklyScheduleIntakeStatus } | null>;
  /** Membership + escalão SEGUNDO A MATRIZ (resolveUserResponsibilityTier) em cada projeto do usuário. */
  resolveSender(projectId: string, email: string, authorizedArea: string): Promise<SenderResolution>;
  /** Reaproveita ingestEmailAttachmentsForMessage (idempotente: nunca baixa/grava duas vezes). */
  ingestAttachment(projectId: string, candidate: WeeklyScheduleEmailCandidate, attachment: EmailAttachmentDescriptor): Promise<IngestedMppAttachment>;
  findDocumentVersionBySha(projectId: string, sha256Hash: string): Promise<ExistingDocumentVersion | null>;
  /** Garante o documento CRONOGRAMA_REVISAO alvo (cria na primeira vez e persiste em config.target_document_id). */
  ensureTargetDocument(config: WeeklyScheduleIngestionConfig): Promise<string>;
  createScheduleDocumentVersion(input: CreateScheduleDocumentVersionInput): Promise<{ documentVersionId: string; versionIndex: number }>;
  recordIntake(record: WeeklyScheduleIntakeRecord): Promise<{ id: string }>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export interface IntakeAwaitingComparison {
  intakeId: string;
  projectId: string;
  documentVersionId: string;
  weekStart: string;
  sentAt: string;
}

export interface ScheduleVersionState {
  id: string;
  extractionStatus: "PENDING" | "EXTRACTED" | "FAILED";
  statusDate: string | null;
}

export interface ComparisonRecord {
  projectId: string;
  currentScheduleVersionId: string;
  referenceScheduleVersionId: string | null;
  comparisonType: ScheduleComparisonType;
  status: "PENDING" | "COMPUTED" | "FAILED";
  metrics: unknown | null;
  riskClassification: ScheduleRiskClassification | null;
  riskReasons: string[];
  missingThresholds: ScheduleRiskDimension[];
  computedAt: string | null;
  errorMessage: string | null;
}

export interface ScheduleComparisonStore {
  listIntakesAwaitingComparison(limit: number): Promise<IntakeAwaitingComparison[]>;
  findScheduleVersionForDocumentVersion(documentVersionId: string): Promise<ScheduleVersionState | null>;
  /** processing_status da document_version (para detectar FAILED do worker sem schedule_version). */
  getDocumentVersionProcessingStatus(documentVersionId: string): Promise<string | null>;
  /** Versão semanal EXTRAÍDA imediatamente anterior (por sent_at) do mesmo projeto. */
  findPreviousWeeklyScheduleVersionId(intake: IntakeAwaitingComparison): Promise<string | null>;
  /** Baseline oficial ATIVA (project_schedule_baselines.superseded_at IS NULL). */
  getBaselineScheduleVersionId(projectId: string): Promise<string | null>;
  findComparison(currentScheduleVersionId: string, type: ScheduleComparisonType): Promise<{ id: string; status: ComparisonRecord["status"] } | null>;
  upsertComparison(record: ComparisonRecord): Promise<void>;
  loadSnapshot(scheduleVersionId: string): Promise<ScheduleSnapshot>;
  loadThresholds(projectId: string): Promise<ScheduleRiskThreshold[]>;
  markIntakeComparisonsPrepared(intakeId: string): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export interface AbsenceAlertRecord {
  projectId: string;
  configId: string;
  kind: "MISSING_WEEKLY_SCHEDULE" | "MISSING_S_CURVE" | "S_CURVE_MPP_DIVERGENCE";
  weekStart: string;
  deadlineAt: string;
  recipientUserIds: string[];
  detail: string;
}

export interface AbsenceAlertStore {
  /** true quando existe intake AUTHORIZED_AUTO, APPROVED_HUMAN_REVIEW, PENDING_HUMAN_REVIEW ou RECEIVED_DUPLICATE naquela semana. */
  hasReceivedScheduleForWeek(projectId: string, weekStart: string): Promise<boolean>;
  /** true quando existe aba Curva S (EXTRACTED / HUMAN_MAPPED / HUMAN_VALIDATED / PENDING_HUMAN_REVIEW) de uma planilha ligada a intake daquela semana. */
  hasSCurveForWeek(projectId: string, weekStart: string): Promise<boolean>;
  /** Insere respeitando o UNIQUE (project_id, week_start, kind); devolve created=false quando já existia. */
  insertAlert(record: AbsenceAlertRecord): Promise<{ created: boolean; id: string | null }>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

// ------------------------------------------------------------------
// Promoção após revisão humana (APPROVED_HUMAN_REVIEW → versão)
// ------------------------------------------------------------------

export interface ReviewedIntakeForPromotion {
  intakeId: string;
  projectId: string;
  configId: string;
  emailId: string | null;
  gmailMessageId: string;
  subject: string;
  fromAddress: string;
  sentAt: string;
  weekStart: string;
  status: WeeklyScheduleIntakeStatus;
  selectedEmailAttachmentId: string | null;
  documentVersionId: string | null;
  attachments: EmailAttachmentDescriptor[];
}

export interface ReviewedIntakePromotionStore {
  getIntakeForPromotion(intakeId: string): Promise<ReviewedIntakeForPromotion | null>;
  /** Anexos já ingeridos (email_attachments) deste e-mail — só .mpp são candidatos. */
  listIngestedAttachments(emailId: string): Promise<IngestedMppAttachment[]>;
  getConfig(configId: string): Promise<WeeklyScheduleIngestionConfig | null>;
  findDocumentVersionBySha(projectId: string, sha256Hash: string): Promise<ExistingDocumentVersion | null>;
  ensureTargetDocument(config: WeeklyScheduleIngestionConfig): Promise<string>;
  createScheduleDocumentVersion(input: CreateScheduleDocumentVersionInput): Promise<{ documentVersionId: string; versionIndex: number }>;
  updateIntakeAfterPromotion(
    intakeId: string,
    patch: {
      status: WeeklyScheduleIntakeStatus;
      decisionRule: string;
      decisionReason: string;
      selectedEmailAttachmentId: string | null;
      selectedSha256Hash: string | null;
      documentVersionId: string | null;
      duplicateOfDocumentVersionId: string | null;
      failureError: string | null;
    }
  ): Promise<void>;
  recordReprocessResult(reviewEventId: string | null, result: unknown): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

// ------------------------------------------------------------------
// Classificação determinística de e-mails/anexos já sincronizados
// ------------------------------------------------------------------

export interface EmailToClassify {
  emailId: string;
  projectId: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  direction: "INBOUND" | "OUTBOUND" | null;
  attachments: Array<{ id: string; fileName: string; mimeType: string; confirmedClassification: string | null }>;
  classificationStatus: string;
}

export interface EmailClassificationStore {
  listEmailsToClassify(projectId: string, limit: number): Promise<EmailToClassify[]>;
  getClientRecipientRules(projectId: string): Promise<{ domains: string[]; addresses: string[] }>;
  saveEmailClassification(
    emailId: string,
    patch: {
      classification: EmailDocumentClassification;
      status: "AUTO" | "PENDING_HUMAN_REVIEW" | "UNCLASSIFIED";
      confidence: number;
      reasons: string[];
      sentToClient: boolean;
      workWeekNumber: number | null;
      workWeekLabel: string | null;
      workWeekStatus: "IDENTIFIED" | "NOT_IDENTIFIED";
    }
  ): Promise<void>;
  saveAttachmentClassification(
    attachmentId: string,
    patch: {
      suggested: EmailAttachmentClassification;
      confidence: number;
      reasons: string[];
    }
  ): Promise<void>;
}

// ------------------------------------------------------------------
// Relatório semanal em Excel (planilha inteira + abas)
// ------------------------------------------------------------------

export interface WorkbookCandidateAttachment {
  attachmentId: string;
  emailId: string;
  projectId: string;
  intakeId: string | null;
  scheduleVersionId: string | null;
  workWeekNumber: number | null;
  workWeekLabel: string | null;
  fileName: string;
  mimeType: string;
  storageBucket: string;
  storagePath: string;
  sha256Hash: string | null;
}

export interface WorkbookSaveInput {
  sha256: string;
  detectedFormat: WorkbookSafetyReport["detectedFormat"];
  safety: WorkbookSafetyReport | null;
  sheetIndex: WorkbookSheetIndexEntry[];
  status: WeeklyReportWorkbookStatus;
  errorMessage: string | null;
  summary: unknown | null;
  sheets: ExtractedSheet[];
}

export interface WeeklyReportWorkbookStore {
  /** Planilhas (.xlsx/.xls) de e-mails de relatório semanal ou anexos classificados RELATORIO_SEMANAL_PLANEJAMENTO, sem leitura válida. */
  listWorkbookCandidates(limit: number): Promise<WorkbookCandidateAttachment[]>;
  downloadAttachment(candidate: WorkbookCandidateAttachment): Promise<Buffer>;
  computeSha256(buffer: Buffer): Promise<string>;
  /** Contexto de cruzamento: limites, fatos do MPP, baseline oficial, semana anterior, decisões humanas preservadas. */
  loadProcessingContext(candidate: WorkbookCandidateAttachment): Promise<Omit<WorkbookProcessingContext, "fileName">>;
  /** Upsert do workbook (UNIQUE email_attachment_id) + abas (UNIQUE workbook_id, category), preservando decisões humanas. */
  saveWorkbook(candidate: WorkbookCandidateAttachment, input: WorkbookSaveInput): Promise<{ id: string }>;
  writeAudit(entry: AuditEntry): Promise<void>;
}
