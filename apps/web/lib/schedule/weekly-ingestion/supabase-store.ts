// Adaptador Supabase das portas de store.ts — ÚNICO lugar com SQL/
// Storage desta feature. Sempre usado com client service-role (worker /
// server actions), nunca pelo navegador. Reaproveita:
//   - ingestEmailAttachmentsForMessage (download → SHA-256 → Storage →
//     email_attachments, idempotente) — nenhum segundo caminho de upload;
//   - resolveUserResponsibilityTier (Matriz de responsabilidades e
//     prazos = sla_area_responsibles) — ÚNICA fonte do escalão;
//   - documents/document_versions com o mesmo contrato que
//     linkEmailAttachmentToDocument (mesmo objeto de Storage, nunca
//     re-upload; processing_status AWAITING_PROCESSING = fila do worker
//     MPXJ existente);
//   - a mesma projeção de schedule_activities/relations do Diretor de
//     Planejamento (schedule-context.ts).
//
// Segurança: nenhum token, corpo de e-mail ou dado pessoal além dos
// endereços já persistidos em public.emails é escrito em logs/tabelas.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextScheduleActivity, ContextScheduleRelation } from "../../ai/context/types";
import { ingestEmailAttachmentsForMessage } from "../../email/attachments/ingest-email-attachments";
import { linkEmailAttachmentToDocument } from "../../email/attachments/link-email-attachment-to-document";
import { resolveUserResponsibilityTier, type ResponsibilityMatrixRow } from "../../sla/resolve-user-responsibility-tier";
import type { ScheduleSnapshot } from "./compare-schedule-versions";
import { isMppAttachment } from "./evaluate-weekly-schedule-email";
import type {
  AbsenceAlertRecord,
  AbsenceAlertStore,
  OpenAbsenceAlert,
  AuditEntry,
  ComparisonRecord,
  CreateScheduleDocumentVersionInput,
  EmailClassificationStore,
  EmailToClassify,
  ExistingDocumentVersion,
  IngestedMppAttachment,
  IntakeAwaitingComparison,
  ReviewedIntakeForPromotion,
  ReviewedIntakePromotionStore,
  ScheduleComparisonStore,
  ScheduleVersionState,
  WeeklyReportWorkbookStore,
  WeeklyScheduleIngestionStore,
  WeeklyScheduleIntakeRecord,
  WorkbookCandidateAttachment,
} from "./store";
import { DuplicateDocumentVersionError } from "./store";
import { mppFactsFromComparison, type MppFactsForCrossCheck } from "../s-curve/analyze-s-curve";
import type { OfficialBaselineFacts } from "../weekly-report/analyze-sheets";
import type { WorkbookProcessingContext } from "../weekly-report/process-workbook";
import type { BaselineSheetData, WeeklyReportSheetCategory, WeeklyReportSheetData } from "../weekly-report/types";
import type { ScheduleComparisonMetrics } from "./compare-schedule-versions";
import type {
  AuthorizedTier,
  EmailAttachmentDescriptor,
  ScheduleComparisonType,
  ScheduleRiskDimension,
  ScheduleRiskThreshold,
  SenderProjectStanding,
  SenderResolution,
  WeeklyScheduleEmailCandidate,
  WeeklyScheduleIngestionConfig,
  WeeklyScheduleIntakeStatus,
} from "./types";

export const MPP_MIME_TYPE = "application/vnd.ms-project";
const TARGET_DOCUMENT_TITLE = "Cronograma Semanal (ingestão automática por e-mail)";
const RECEIVED_STATUSES: WeeklyScheduleIntakeStatus[] = ["AUTHORIZED_AUTO", "APPROVED_HUMAN_REVIEW", "PENDING_HUMAN_REVIEW", "RECEIVED_DUPLICATE"];

type ConfigRow = {
  id: string;
  project_id: string;
  enabled: boolean;
  authorized_area: string;
  authorized_tiers: AuthorizedTier[] | null;
  sender_domain: string;
  client_recipient_domains: string[] | null;
  client_recipient_addresses: string[] | null;
  require_client_recipient: boolean;
  cadence: "WEEKLY";
  deadline_weekday: number;
  deadline_time: string;
  timezone: string;
  monitoring_start_at: string | null;
  monitoring_end_at: string | null;
  target_document_id: string | null;
  attachment_name_pattern: string | null;
  alert_recipient_user_ids: string[] | null;
  last_scanned_sent_at: string | null;
};

function fail(prefix: string, error: { message: string } | null): never {
  throw new Error(`${prefix}: ${error?.message ?? "erro desconhecido"}`);
}

/** Janela efetiva: config própria → janela do monitoramento de e-mail do projeto → datas do projeto. */
async function resolveMonitoringWindow(supabase: SupabaseClient, row: ConfigRow): Promise<{ start: string | null; end: string | null }> {
  if (row.monitoring_start_at || row.monitoring_end_at) {
    return { start: row.monitoring_start_at, end: row.monitoring_end_at };
  }
  const { data: emailConfig } = await supabase
    .from("project_email_ingestion_configs")
    .select("window_mode,custom_start_at,custom_end_at,monitoring_started_at")
    .eq("project_id", row.project_id)
    .maybeSingle();
  if (emailConfig) {
    if (emailConfig.window_mode === "CUSTOM") return { start: emailConfig.custom_start_at, end: emailConfig.custom_end_at };
    if (emailConfig.window_mode === "FROM_NOW" && emailConfig.monitoring_started_at) return { start: emailConfig.monitoring_started_at, end: null };
  }
  const { data: project } = await supabase.from("projects").select("start_date").eq("id", row.project_id).maybeSingle();
  return { start: project?.start_date ? `${project.start_date}T00:00:00Z` : null, end: null };
}

async function mapConfigRow(supabase: SupabaseClient, row: ConfigRow): Promise<WeeklyScheduleIngestionConfig> {
  const window = await resolveMonitoringWindow(supabase, row);
  return {
    id: row.id,
    projectId: row.project_id,
    enabled: row.enabled,
    authorizedArea: row.authorized_area,
    authorizedTiers: row.authorized_tiers ?? ["FIRST_TIER", "SECOND_TIER"],
    senderDomain: row.sender_domain,
    clientRecipientDomains: row.client_recipient_domains ?? [],
    clientRecipientAddresses: row.client_recipient_addresses ?? [],
    requireClientRecipient: row.require_client_recipient,
    cadence: row.cadence,
    deadlineWeekday: row.deadline_weekday,
    deadlineTime: row.deadline_time,
    timezone: row.timezone,
    monitoringStartAt: window.start,
    monitoringEndAt: window.end,
    targetDocumentId: row.target_document_id,
    attachmentNamePattern: row.attachment_name_pattern,
    alertRecipientUserIds: row.alert_recipient_user_ids ?? [],
    lastScannedSentAt: row.last_scanned_sent_at,
  };
}

export async function loadWeeklyScheduleIngestionConfigs(
  supabase: SupabaseClient,
  options: { onlyEnabled?: boolean; projectId?: string } = {}
): Promise<WeeklyScheduleIngestionConfig[]> {
  let query = supabase.from("project_weekly_schedule_ingestion_configs").select("*");
  if (options.onlyEnabled ?? true) query = query.eq("enabled", true);
  if (options.projectId) query = query.eq("project_id", options.projectId);
  const { data, error } = await query;
  if (error) fail("Falha ao carregar configurações da ingestão semanal", error);
  const configs: WeeklyScheduleIngestionConfig[] = [];
  for (const row of (data ?? []) as ConfigRow[]) configs.push(await mapConfigRow(supabase, row));
  return configs;
}

async function writeSystemAudit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
  // actor_type='SYSTEM' exige actor_user_id E actor_label nulos (20260822060313).
  const { error } = await supabase.from("audit_log_entries").insert({
    project_id: entry.projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    detail: entry.detail,
  });
  if (error) fail("Falha ao registrar auditoria", error);
}

async function findDocumentVersionBySha(supabase: SupabaseClient, projectId: string, sha256Hash: string): Promise<ExistingDocumentVersion | null> {
  const { data, error } = await supabase
    .from("document_versions")
    .select("id,document_id")
    .eq("project_id", projectId)
    .eq("sha256_hash", sha256Hash)
    .maybeSingle();
  if (error) fail("Falha ao verificar duplicidade por SHA-256", error);
  return data ? { id: data.id as string, documentId: data.document_id as string } : null;
}

async function ensureTargetDocument(supabase: SupabaseClient, config: WeeklyScheduleIngestionConfig): Promise<string> {
  if (config.targetDocumentId) {
    const { data, error } = await supabase
      .from("documents")
      .select("id,deleted_at")
      .eq("id", config.targetDocumentId)
      .eq("project_id", config.projectId)
      .maybeSingle();
    if (error) fail("Falha ao verificar documento alvo", error);
    if (data && !data.deleted_at) return data.id as string;
  }
  const { data: created, error: createError } = await supabase
    .from("documents")
    .insert({ project_id: config.projectId, kind: "CRONOGRAMA_REVISAO", title: TARGET_DOCUMENT_TITLE })
    .select("id")
    .single();
  if (createError) fail("Falha ao criar documento alvo do cronograma semanal", createError);
  const documentId = created.id as string;
  const { error: updateError } = await supabase
    .from("project_weekly_schedule_ingestion_configs")
    .update({ target_document_id: documentId })
    .eq("id", config.id);
  if (updateError) fail("Falha ao gravar documento alvo na configuração", updateError);
  config.targetDocumentId = documentId;
  return documentId;
}

async function createScheduleDocumentVersion(
  supabase: SupabaseClient,
  input: CreateScheduleDocumentVersionInput
): Promise<{ documentVersionId: string; versionIndex: number }> {
  const { data: latest, error: latestError } = await supabase
    .from("document_versions")
    .select("version_index")
    .eq("document_id", input.documentId)
    .order("version_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) fail("Falha ao determinar próxima versão", latestError);
  const versionIndex = ((latest?.version_index as number | undefined) ?? 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .insert({
      document_id: input.documentId,
      version_label: `v${versionIndex}`,
      version_index: versionIndex,
      document_date: input.candidate.sentAt.slice(0, 10),
      source_type: "EMAIL",
      author: input.author,
      summary: `Cronograma semanal recebido por e-mail em ${input.candidate.sentAt} (semana de ${input.weekStart}); mensagem Gmail ${input.candidate.gmailMessageId}; assunto: ${input.candidate.subject}`.slice(0, 2000),
      file_path: input.attachment.storagePath,
      storage_bucket: input.attachment.storageBucket,
      original_file_name: input.attachment.originalFileName,
      mime_type: MPP_MIME_TYPE,
      file_size_bytes: input.attachment.fileSizeBytes,
      sha256_hash: input.attachment.sha256Hash,
      // Fila do worker MPXJ existente — nenhum pipeline novo.
      processing_status: "AWAITING_PROCESSING",
    })
    .select("id")
    .single();

  if (versionError) {
    if (versionError.code === "23505") {
      throw new DuplicateDocumentVersionError(await findDocumentVersionBySha(supabase, input.projectId, input.attachment.sha256Hash));
    }
    fail("Falha ao criar versão do cronograma semanal", versionError);
  }
  const documentVersionId = version.id as string;

  const { error: linkError } = await supabase
    .from("email_attachments")
    .update({ document_version_id: documentVersionId, processing_status: "PROCESSED", processing_error: null })
    .eq("id", input.attachment.id);
  if (linkError) fail("Falha ao vincular anexo à versão criada", linkError);

  return { documentVersionId, versionIndex };
}

function mapIngestedAttachment(row: {
  id: string;
  sha256_hash: string;
  storage_bucket: string;
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
}): IngestedMppAttachment {
  return {
    id: row.id,
    sha256Hash: row.sha256_hash,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
  };
}

/** Download de UM anexo do Gmail — injetado pelo script (nunca importa googleapis aqui). */
export type DownloadGmailAttachment = (input: { gmailMessageId: string; gmailAttachmentId: string }) => Promise<Buffer>;

export function createSupabaseWeeklyScheduleIngestionStore(
  supabase: SupabaseClient,
  downloadGmailAttachment: DownloadGmailAttachment
): WeeklyScheduleIngestionStore {
  return {
    async findIntakeByMessage(projectId, gmailMessageId) {
      const { data, error } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("id,status")
        .eq("project_id", projectId)
        .eq("gmail_message_id", gmailMessageId)
        .maybeSingle();
      if (error) fail("Falha ao verificar intake existente", error);
      return data ? { id: data.id as string, status: data.status as WeeklyScheduleIntakeStatus } : null;
    },

    async resolveSender(_projectId, email, authorizedArea): Promise<SenderResolution> {
      const normalized = email.trim().toLowerCase();
      const { data: profile, error: profileError } = await supabase.from("profiles").select("id").ilike("email", normalized).maybeSingle();
      if (profileError) fail("Falha ao resolver remetente", profileError);
      if (!profile) return { email: normalized, userId: null, standings: [] };
      const userId = profile.id as string;

      const { data: memberships, error: membershipsError } = await supabase
        .from("project_memberships")
        .select("project_id,status,area")
        .eq("user_id", userId);
      if (membershipsError) fail("Falha ao carregar memberships do remetente", membershipsError);

      const projectIds = (memberships ?? []).map((membership) => membership.project_id as string);
      const { data: matrixRows, error: matrixError } = projectIds.length
        ? await supabase
            .from("sla_area_responsibles")
            .select("project_id,responsible_direct_user_id,secondary_responsible_user_id,escalation_1_user_id,escalation_2_user_id,board_user_id")
            .eq("area", authorizedArea)
            .in("project_id", projectIds)
        : { data: [], error: null };
      if (matrixError) fail("Falha ao carregar Matriz de responsabilidades", matrixError);
      const matrixByProject = new Map((matrixRows ?? []).map((row) => [row.project_id as string, row as ResponsibilityMatrixRow]));

      const standings: SenderProjectStanding[] = (memberships ?? []).map((membership) => {
        const tier = resolveUserResponsibilityTier({ userId, matrixRow: matrixByProject.get(membership.project_id as string) ?? null });
        return {
          projectId: membership.project_id as string,
          membershipStatus: membership.status as "ACTIVE" | "INACTIVE",
          area: (membership.area as string | null) ?? null,
          tier: tier.tier,
          tierReason: tier.reason,
        };
      });
      return { email: normalized, userId, standings };
    },

    async ingestAttachment(projectId, candidate, attachment): Promise<IngestedMppAttachment> {
      if (!candidate.emailId) throw new Error("Candidato sem email_id — não é possível ingerir o anexo.");
      const results = await ingestEmailAttachmentsForMessage(supabase, {
        projectId,
        emailId: candidate.emailId,
        gmailMessageId: candidate.gmailMessageId,
        gmailThreadId: candidate.gmailThreadId,
        receivedAt: candidate.sentAt,
        parts: [
          {
            gmailAttachmentId: attachment.gmailAttachmentId,
            originalFileName: attachment.fileName,
            // O bucket project-documents tem allowlist de MIME — Gmail
            // frequentemente rotula .mpp como octet-stream.
            mimeType: isMppAttachment(attachment) ? MPP_MIME_TYPE : attachment.mimeType,
            declaredSizeBytes: attachment.sizeBytes,
          },
        ],
        downloadAttachmentBytes: (part) => downloadGmailAttachment({ gmailMessageId: candidate.gmailMessageId, gmailAttachmentId: part.gmailAttachmentId }),
      });
      const result = results[0];
      if (!result || result.status === "FAILED") {
        throw new Error(`Falha ao ingerir anexo "${attachment.fileName}": ${result?.status === "FAILED" ? result.error : "sem resultado"}`);
      }
      const row = result.attachment;
      return {
        id: row.id,
        sha256Hash: row.sha256Hash,
        storageBucket: row.storageBucket,
        storagePath: row.storagePath,
        originalFileName: row.originalFileName,
        mimeType: row.mimeType,
        fileSizeBytes: row.fileSizeBytes,
      };
    },

    async promoteMeetingMinutesAttachment(attachment, candidate) {
      return linkEmailAttachmentToDocument(supabase, {
        attachmentId: attachment.id,
        kind: "ATA_REUNIAO",
        documentTitle: attachment.originalFileName.replace(/\.[^.]+$/, ""),
        documentDate: candidate.sentAt.slice(0, 10),
        author: candidate.fromAddress,
        summary: `Ata do pacote semanal de Planejamento recebida por e-mail. Assunto: ${candidate.subject}`.slice(0, 2000),
      });
    },

    findDocumentVersionBySha: (projectId, sha) => findDocumentVersionBySha(supabase, projectId, sha),
    ensureTargetDocument: (config) => ensureTargetDocument(supabase, config),
    createScheduleDocumentVersion: (input) => createScheduleDocumentVersion(supabase, input),

    async recordIntake(record: WeeklyScheduleIntakeRecord) {
      const { data, error } = await supabase
        .from("weekly_schedule_email_intakes")
        .insert({
          project_id: record.projectId,
          config_id: record.configId,
          email_id: record.emailId,
          mailbox_address: record.mailboxAddress,
          direction: record.direction,
          sync_source: record.syncSource,
          gmail_message_id: record.gmailMessageId,
          gmail_thread_id: record.gmailThreadId,
          message_id_header: record.messageIdHeader,
          from_address: record.fromAddress,
          to_addresses: record.toAddresses,
          cc_addresses: record.ccAddresses,
          subject: record.subject,
          sent_at: record.sentAt,
          provider_labels: record.providerLabels,
          week_start: record.weekStart,
          work_week_number: record.workWeekNumber,
          work_week_label: record.workWeekLabel,
          work_week_status: record.workWeekStatus,
          attachments: record.attachments,
          sender_user_id: record.senderUserId,
          sender_tier: record.senderTier,
          status: record.status,
          decision_rule: record.decisionRule,
          decision_reasons: record.decisionReasons,
          failure_error: record.failureError,
          selected_email_attachment_id: record.selectedEmailAttachmentId,
          selected_sha256_hash: record.selectedSha256Hash,
          document_version_id: record.documentVersionId,
          duplicate_of_document_version_id: record.duplicateOfDocumentVersionId,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          const existing = await this.findIntakeByMessage(record.projectId, record.gmailMessageId);
          if (existing) return { id: existing.id };
        }
        fail("Falha ao gravar intake do cronograma semanal", error);
      }
      return { id: data.id as string };
    },

    writeAudit: (entry) => writeSystemAudit(supabase, entry),
  };
}

type ActivityRow = {
  id: string;
  name: string;
  baseline_start: string | null;
  baseline_end: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status: string;
  external_task_id: string | null;
  unique_id: string | null;
  wbs: string | null;
  outline_level: number | null;
  parent_task_id: string | null;
  duration_value: number | string | null;
  duration_unit: string | null;
  total_float_value: number | string | null;
  total_float_unit: string | null;
  is_milestone: boolean | null;
  is_summary_task: boolean | null;
  is_critical: boolean | null;
  percent_complete: number | string | null;
  calendar_name: string | null;
};

type RelationRow = {
  predecessor_task_id: string;
  successor_task_id: string;
  relation_type: string;
  lag_value: number | string;
  lag_unit: string;
};

async function findScheduleVersionForDocumentVersion(supabase: SupabaseClient, documentVersionId: string): Promise<ScheduleVersionState | null> {
  const { data, error } = await supabase
    .from("schedule_versions")
    .select("id,extraction_status,status_date")
    .eq("document_version_id", documentVersionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("Falha ao carregar schedule_version", error);
  return data
    ? { id: data.id as string, extractionStatus: data.extraction_status as ScheduleVersionState["extractionStatus"], statusDate: (data.status_date as string | null) ?? null }
    : null;
}

async function loadThresholds(supabase: SupabaseClient, projectId: string): Promise<ScheduleRiskThreshold[]> {
  const { data, error } = await supabase
    .from("project_schedule_risk_thresholds")
    .select("dimension,medium_threshold,high_threshold,critical_threshold")
    .eq("project_id", projectId);
  if (error) fail("Falha ao carregar limites de risco", error);
  return (data ?? []).map((row) => ({
    dimension: row.dimension as ScheduleRiskDimension,
    medium: Number(row.medium_threshold),
    high: Number(row.high_threshold),
    critical: Number(row.critical_threshold),
  }));
}

export async function loadScheduleSnapshot(supabase: SupabaseClient, scheduleVersionId: string): Promise<ScheduleSnapshot> {
  const [{ data: versionRow, error: versionError }, { data: activityRows, error: activityError }, { data: relationRows, error: relationError }] =
    await Promise.all([
      supabase.from("schedule_versions").select("id,status_date").eq("id", scheduleVersionId).maybeSingle(),
      supabase
        .from("schedule_activities")
        .select(
          "id,name,baseline_start,baseline_end,planned_start,planned_end,status,external_task_id,unique_id,wbs,outline_level,parent_task_id,duration_value,duration_unit,total_float_value,total_float_unit,is_milestone,is_summary_task,is_critical,percent_complete,calendar_name"
        )
        .eq("schedule_version_id", scheduleVersionId),
      supabase
        .from("schedule_task_relations")
        .select("predecessor_task_id,successor_task_id,relation_type,lag_value,lag_unit")
        .eq("schedule_version_id", scheduleVersionId),
    ]);
  if (versionError) fail("Falha ao carregar schedule_version", versionError);
  if (activityError) fail("Falha ao carregar atividades", activityError);
  if (relationError) fail("Falha ao carregar relações", relationError);
  if (!versionRow) throw new Error(`schedule_version ${scheduleVersionId} não encontrada.`);

  const activities: ContextScheduleActivity[] = ((activityRows ?? []) as ActivityRow[]).map((row) => ({
    id: row.id,
    externalTaskId: row.external_task_id,
    uniqueId: row.unique_id,
    wbs: row.wbs,
    outlineLevel: row.outline_level,
    parentTaskId: row.parent_task_id,
    name: row.name,
    baselineStart: row.baseline_start,
    baselineEnd: row.baseline_end,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    durationValue: row.duration_value,
    durationUnit: row.duration_unit,
    totalFloatValue: row.total_float_value,
    totalFloatUnit: row.total_float_unit,
    percentComplete: row.percent_complete,
    isMilestone: row.is_milestone,
    isSummaryTask: row.is_summary_task,
    isCritical: row.is_critical,
    calendarName: row.calendar_name,
    status: row.status,
  }));
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const relations: ContextScheduleRelation[] = ((relationRows ?? []) as RelationRow[]).map((row) => ({
    predecessorTaskId: row.predecessor_task_id,
    predecessorUniqueId: byId.get(row.predecessor_task_id)?.uniqueId ?? null,
    predecessorName: byId.get(row.predecessor_task_id)?.name ?? null,
    successorTaskId: row.successor_task_id,
    successorUniqueId: byId.get(row.successor_task_id)?.uniqueId ?? null,
    successorName: byId.get(row.successor_task_id)?.name ?? null,
    relationType: row.relation_type,
    lagValue: row.lag_value,
    lagUnit: row.lag_unit,
  }));
  return { scheduleVersionId, statusDate: (versionRow.status_date as string | null) ?? null, activities, relations };
}

export async function getActiveBaselineScheduleVersionId(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("project_schedule_baselines")
    .select("schedule_version_id")
    .eq("project_id", projectId)
    .is("superseded_at", null)
    .maybeSingle();
  if (error) fail("Falha ao carregar baseline oficial", error);
  return (data?.schedule_version_id as string | undefined) ?? null;
}

export function createSupabaseScheduleComparisonStore(supabase: SupabaseClient): ScheduleComparisonStore {
  return {
    async listIntakesAwaitingComparison(limit): Promise<IntakeAwaitingComparison[]> {
      const { data, error } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("id,project_id,document_version_id,week_start,sent_at")
        .in("status", ["AUTHORIZED_AUTO", "APPROVED_HUMAN_REVIEW"])
        .not("document_version_id", "is", null)
        .is("comparisons_prepared_at", null)
        .order("sent_at", { ascending: true })
        .limit(limit);
      if (error) fail("Falha ao listar intakes aguardando comparação", error);
      return (data ?? []).map((row) => ({
        intakeId: row.id as string,
        projectId: row.project_id as string,
        documentVersionId: row.document_version_id as string,
        weekStart: row.week_start as string,
        sentAt: row.sent_at as string,
      }));
    },

    findScheduleVersionForDocumentVersion: (documentVersionId) => findScheduleVersionForDocumentVersion(supabase, documentVersionId),

    async getDocumentVersionProcessingStatus(documentVersionId) {
      const { data, error } = await supabase.from("document_versions").select("processing_status").eq("id", documentVersionId).maybeSingle();
      if (error) fail("Falha ao carregar processing_status", error);
      return (data?.processing_status as string | undefined) ?? null;
    },

    async findPreviousWeeklyScheduleVersionId(intake) {
      const { data, error } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("document_version_id")
        .eq("project_id", intake.projectId)
        .in("status", ["AUTHORIZED_AUTO", "APPROVED_HUMAN_REVIEW"])
        .not("document_version_id", "is", null)
        .lt("sent_at", intake.sentAt)
        .order("sent_at", { ascending: false })
        .limit(10);
      if (error) fail("Falha ao localizar versão semanal anterior", error);
      for (const row of data ?? []) {
        const state = await findScheduleVersionForDocumentVersion(supabase, row.document_version_id as string);
        if (state?.extractionStatus === "EXTRACTED") return state.id;
      }
      return null;
    },

    getBaselineScheduleVersionId: (projectId) => getActiveBaselineScheduleVersionId(supabase, projectId),

    async findComparison(currentScheduleVersionId, type: ScheduleComparisonType) {
      const { data, error } = await supabase
        .from("schedule_version_comparisons")
        .select("id,status")
        .eq("current_schedule_version_id", currentScheduleVersionId)
        .eq("comparison_type", type)
        .maybeSingle();
      if (error) fail("Falha ao verificar comparação existente", error);
      return data ? { id: data.id as string, status: data.status as ComparisonRecord["status"] } : null;
    },

    async upsertComparison(record: ComparisonRecord) {
      const { error } = await supabase.from("schedule_version_comparisons").upsert(
        {
          project_id: record.projectId,
          current_schedule_version_id: record.currentScheduleVersionId,
          reference_schedule_version_id: record.referenceScheduleVersionId,
          comparison_type: record.comparisonType,
          status: record.status,
          metrics: record.metrics,
          risk_classification: record.riskClassification,
          risk_reasons: record.riskReasons,
          missing_thresholds: record.missingThresholds,
          computed_at: record.computedAt,
          error_message: record.errorMessage,
        },
        { onConflict: "current_schedule_version_id,comparison_type" }
      );
      if (error) fail("Falha ao gravar comparação de cronograma", error);
    },

    loadSnapshot: (scheduleVersionId) => loadScheduleSnapshot(supabase, scheduleVersionId),
    loadThresholds: (projectId) => loadThresholds(supabase, projectId),

    async markIntakeComparisonsPrepared(intakeId) {
      const { error } = await supabase
        .from("weekly_schedule_email_intakes")
        .update({ comparisons_prepared_at: new Date().toISOString() })
        .eq("id", intakeId);
      if (error) fail("Falha ao marcar comparações preparadas", error);
    },

    writeAudit: (entry) => writeSystemAudit(supabase, entry),
  };
}

export function createSupabaseAbsenceAlertStore(supabase: SupabaseClient): AbsenceAlertStore {
  return {
    async hasReceivedScheduleForWeek(projectId, weekStart) {
      const { count, error } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("week_start", weekStart)
        .in("status", RECEIVED_STATUSES);
      if (error) fail("Falha ao verificar recebimento semanal", error);
      return (count ?? 0) > 0;
    },

    async hasSCurveForWeek(projectId, weekStart) {
      const { data: intakes, error: intakesError } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("id")
        .eq("project_id", projectId)
        .eq("week_start", weekStart)
        .in("status", RECEIVED_STATUSES);
      if (intakesError) fail("Falha ao listar intakes da semana", intakesError);
      const ids = (intakes ?? []).map((row) => row.id as string);
      if (ids.length === 0) return false;
      const { data: workbooks, error: workbooksError } = await supabase.from("weekly_report_workbooks").select("id").in("intake_id", ids);
      if (workbooksError) fail("Falha ao listar planilhas da semana", workbooksError);
      const workbookIds = (workbooks ?? []).map((row) => row.id as string);
      if (workbookIds.length === 0) return false;
      const { count, error } = await supabase
        .from("weekly_report_sheets")
        .select("id", { count: "exact", head: true })
        .in("workbook_id", workbookIds)
        .eq("category", "CURVA_S")
        .in("status", ["EXTRACTED", "HUMAN_MAPPED", "HUMAN_VALIDATED", "PENDING_HUMAN_REVIEW"]);
      if (error) fail("Falha ao verificar aba Curva S da semana", error);
      return (count ?? 0) > 0;
    },

    async hasWorkbookForWeek(projectId, weekStart) {
      const { data: intakes, error: intakesError } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("id")
        .eq("project_id", projectId)
        .eq("week_start", weekStart)
        .in("status", RECEIVED_STATUSES);
      if (intakesError) fail("Falha ao listar intakes da semana", intakesError);
      const ids = (intakes ?? []).map((row) => row.id as string);
      if (ids.length === 0) return false;
      // Qualquer status conta como "recebida" (inválida ≠ ausente).
      const { count, error } = await supabase.from("weekly_report_workbooks").select("id", { count: "exact", head: true }).in("intake_id", ids);
      if (error) fail("Falha ao verificar planilha da semana", error);
      return (count ?? 0) > 0;
    },

    async listOpenAbsenceAlerts(projectId) {
      const { data, error } = await supabase
        .from("weekly_schedule_ingestion_alerts")
        .select("id,project_id,kind,week_start")
        .eq("project_id", projectId)
        .is("resolved_at", null)
        .in("kind", ["MISSING_WEEKLY_SCHEDULE", "MISSING_S_CURVE", "MISSING_WEEKLY_REPORT_WORKBOOK"]);
      if (error) fail("Falha ao listar alertas de ausência abertos", error);
      return (data ?? []).map((row) => ({ id: row.id as string, projectId: row.project_id as string, kind: row.kind as OpenAbsenceAlert["kind"], weekStart: row.week_start as string }));
    },

    async resolveAbsenceAlert(alertId, detail) {
      const { data, error } = await supabase
        .from("weekly_schedule_ingestion_alerts")
        .update({ resolved_at: new Date().toISOString(), detail })
        .eq("id", alertId)
        .is("resolved_at", null)
        .select("id");
      if (error) fail("Falha ao resolver alerta de ausência", error);
      return (data ?? []).length > 0;
    },

    async insertAlert(record: AbsenceAlertRecord) {
      const { data, error } = await supabase
        .from("weekly_schedule_ingestion_alerts")
        .insert({
          project_id: record.projectId,
          config_id: record.configId,
          kind: record.kind,
          week_start: record.weekStart,
          deadline_at: record.deadlineAt,
          recipient_user_ids: record.recipientUserIds,
          detail: record.detail,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { created: false, id: null };
        fail("Falha ao criar alerta de ausência", error);
      }
      return { created: true, id: data.id as string };
    },

    writeAudit: (entry) => writeSystemAudit(supabase, entry),
  };
}

export function createSupabaseReviewedIntakePromotionStore(supabase: SupabaseClient): ReviewedIntakePromotionStore {
  return {
    async getIntakeForPromotion(intakeId): Promise<ReviewedIntakeForPromotion | null> {
      const { data, error } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("id,project_id,config_id,email_id,gmail_message_id,subject,from_address,sent_at,week_start,status,selected_email_attachment_id,document_version_id,attachments")
        .eq("id", intakeId)
        .maybeSingle();
      if (error) fail("Falha ao carregar intake", error);
      if (!data) return null;
      return {
        intakeId: data.id as string,
        projectId: data.project_id as string,
        configId: data.config_id as string,
        emailId: (data.email_id as string | null) ?? null,
        gmailMessageId: data.gmail_message_id as string,
        subject: data.subject as string,
        fromAddress: data.from_address as string,
        sentAt: data.sent_at as string,
        weekStart: data.week_start as string,
        status: data.status as WeeklyScheduleIntakeStatus,
        selectedEmailAttachmentId: (data.selected_email_attachment_id as string | null) ?? null,
        documentVersionId: (data.document_version_id as string | null) ?? null,
        attachments: (data.attachments as EmailAttachmentDescriptor[]) ?? [],
      };
    },

    async listIngestedAttachments(emailId) {
      const { data, error } = await supabase
        .from("email_attachments")
        .select("id,sha256_hash,storage_bucket,storage_path,original_file_name,mime_type,file_size_bytes")
        .eq("email_id", emailId);
      if (error) fail("Falha ao listar anexos ingeridos", error);
      return (data ?? []).map(mapIngestedAttachment);
    },

    async getConfig(configId) {
      const { data, error } = await supabase.from("project_weekly_schedule_ingestion_configs").select("*").eq("id", configId).maybeSingle();
      if (error) fail("Falha ao carregar configuração", error);
      return data ? mapConfigRow(supabase, data as ConfigRow) : null;
    },

    findDocumentVersionBySha: (projectId, sha) => findDocumentVersionBySha(supabase, projectId, sha),
    ensureTargetDocument: (config) => ensureTargetDocument(supabase, config),
    createScheduleDocumentVersion: (input) => createScheduleDocumentVersion(supabase, input),

    async updateIntakeAfterPromotion(intakeId, patch) {
      const { data: current, error: currentError } = await supabase
        .from("weekly_schedule_email_intakes")
        .select("decision_reasons")
        .eq("id", intakeId)
        .maybeSingle();
      if (currentError) fail("Falha ao carregar intake", currentError);
      const reasons = [...(((current?.decision_reasons as string[] | null) ?? []) as string[]), patch.decisionReason];
      const { error } = await supabase
        .from("weekly_schedule_email_intakes")
        .update({
          status: patch.status,
          decision_rule: patch.decisionRule,
          decision_reasons: reasons,
          selected_email_attachment_id: patch.selectedEmailAttachmentId,
          selected_sha256_hash: patch.selectedSha256Hash,
          document_version_id: patch.documentVersionId,
          duplicate_of_document_version_id: patch.duplicateOfDocumentVersionId,
          failure_error: patch.failureError,
        })
        .eq("id", intakeId);
      if (error) fail("Falha ao atualizar intake após promoção", error);
    },

    async recordReprocessResult(reviewEventId, result) {
      if (!reviewEventId) return;
      const { error } = await supabase
        .from("email_document_review_events")
        .update({ reprocess_result: result, reprocessed_at: new Date().toISOString() })
        .eq("id", reviewEventId);
      if (error) fail("Falha ao registrar resultado do reprocessamento", error);
    },

    writeAudit: (entry) => writeSystemAudit(supabase, entry),
  };
}

export function createSupabaseEmailClassificationStore(supabase: SupabaseClient): EmailClassificationStore {
  return {
    async listEmailsToClassify(projectId, limit): Promise<EmailToClassify[]> {
      const { data, error } = await supabase
        .from("emails")
        .select("id,project_id,subject,from_address,to_address,direction,classification_status")
        .eq("project_id", projectId)
        .in("classification_status", ["UNCLASSIFIED", "AUTO", "PENDING_HUMAN_REVIEW"])
        .is("classified_at", null)
        .order("sent_at", { ascending: false })
        .limit(limit);
      if (error) fail("Falha ao listar e-mails para classificação", error);
      const emails = data ?? [];
      if (emails.length === 0) return [];
      const { data: attachments, error: attachmentsError } = await supabase
        .from("email_attachments")
        .select("id,email_id,original_file_name,mime_type,confirmed_classification")
        .in("email_id", emails.map((email) => email.id as string));
      if (attachmentsError) fail("Falha ao listar anexos", attachmentsError);
      const byEmail = new Map<string, EmailToClassify["attachments"]>();
      for (const attachment of attachments ?? []) {
        const list = byEmail.get(attachment.email_id as string) ?? [];
        list.push({
          id: attachment.id as string,
          fileName: attachment.original_file_name as string,
          mimeType: attachment.mime_type as string,
          confirmedClassification: (attachment.confirmed_classification as string | null) ?? null,
        });
        byEmail.set(attachment.email_id as string, list);
      }
      return emails.map((email) => ({
        emailId: email.id as string,
        projectId: email.project_id as string,
        subject: email.subject as string,
        fromAddress: email.from_address as string,
        toAddresses: String(email.to_address ?? "").split(/[,;]\s*/).filter(Boolean),
        direction: (email.direction as "INBOUND" | "OUTBOUND" | null) ?? null,
        attachments: byEmail.get(email.id as string) ?? [],
        classificationStatus: email.classification_status as string,
      }));
    },

    async getClientRecipientRules(projectId) {
      const { data: weekly } = await supabase
        .from("project_weekly_schedule_ingestion_configs")
        .select("client_recipient_domains,client_recipient_addresses")
        .eq("project_id", projectId)
        .maybeSingle();
      const { data: emailConfig } = await supabase.from("project_email_ingestion_configs").select("id").eq("project_id", projectId).maybeSingle();
      const { data: domains } = emailConfig
        ? await supabase.from("project_email_ingestion_domains").select("domain").eq("config_id", emailConfig.id).eq("domain_role", "CLIENT").eq("enabled", true)
        : { data: [] };
      const domainSet = new Set<string>([
        ...(((weekly?.client_recipient_domains as string[] | null) ?? []) as string[]),
        ...((domains ?? []).map((row) => row.domain as string)),
      ]);
      return { domains: [...domainSet], addresses: ((weekly?.client_recipient_addresses as string[] | null) ?? []) as string[] };
    },

    async saveEmailClassification(emailId, patch) {
      const { error } = await supabase
        .from("emails")
        .update({
          document_classification: patch.classification,
          classification_status: patch.status,
          classification_confidence: patch.confidence,
          classification_reasons: patch.reasons,
          classified_at: new Date().toISOString(),
          sent_to_client: patch.sentToClient,
          work_week_number: patch.workWeekNumber,
          work_week_label: patch.workWeekLabel,
          work_week_status: patch.workWeekStatus,
        })
        .eq("id", emailId)
        .neq("classification_status", "CONFIRMED");
      if (error) fail("Falha ao gravar classificação do e-mail", error);
    },

    async saveAttachmentClassification(attachmentId, patch) {
      const { error } = await supabase
        .from("email_attachments")
        .update({ suggested_classification: patch.suggested, classification_confidence: patch.confidence, classification_reasons: patch.reasons })
        .eq("id", attachmentId)
        .is("confirmed_classification", null);
      if (error) fail("Falha ao gravar classificação do anexo", error);
    },
  };
}

const SPREADSHEET_MIME_TYPES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "application/vnd.ms-excel.sheet.macroenabled.12"];
const WORKBOOK_SHEET_HUMAN_STATUSES = ["HUMAN_MAPPED", "HUMAN_VALIDATED"];

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadOfficialBaselineFacts(supabase: SupabaseClient, projectId: string): Promise<OfficialBaselineFacts | null> {
  const baselineId = await getActiveBaselineScheduleVersionId(supabase, projectId);
  if (!baselineId) return null;
  const snapshot = await loadScheduleSnapshot(supabase, baselineId);
  const leaves = snapshot.activities.filter((activity) => activity.isSummaryTask !== true);
  const finalPlannedDate = leaves.reduce<string | null>((max, activity) => (activity.plannedEnd && (!max || activity.plannedEnd > max) ? activity.plannedEnd : max), null);
  return {
    scheduleVersionId: baselineId,
    finalPlannedDate,
    milestones: leaves.filter((activity) => activity.isMilestone === true).map((activity) => ({ name: activity.name, plannedEnd: activity.plannedEnd })),
  };
}

export function createSupabaseWeeklyReportWorkbookStore(supabase: SupabaseClient): WeeklyReportWorkbookStore {
  return {
    async listWorkbookCandidates(limit): Promise<WorkbookCandidateAttachment[]> {
      // Planilhas classificadas como relatório semanal + planilhas de
      // e-mails RELATORIO_SEMANAL, ainda sem leitura válida (FAILED reprocessa).
      const [{ data: flagged, error: flaggedError }, { data: weeklyEmails, error: weeklyError }] = await Promise.all([
        supabase
          .from("email_attachments")
          .select("id,email_id,project_id,original_file_name,mime_type,storage_bucket,storage_path,sha256_hash,ingested_at")
          .or("confirmed_classification.eq.RELATORIO_SEMANAL_PLANEJAMENTO,suggested_classification.eq.RELATORIO_SEMANAL_PLANEJAMENTO")
          .order("ingested_at", { ascending: false })
          .limit(limit * 3),
        supabase.from("emails").select("id").eq("document_classification", "RELATORIO_SEMANAL").order("sent_at", { ascending: false }).limit(limit * 3),
      ]);
      if (flaggedError) fail("Falha ao listar planilhas do relatório semanal", flaggedError);
      if (weeklyError) fail("Falha ao listar relatórios semanais", weeklyError);

      const weeklyIds = (weeklyEmails ?? []).map((row) => row.id as string);
      const { data: spreadsheets, error: spreadsheetsError } = weeklyIds.length
        ? await supabase
            .from("email_attachments")
            .select("id,email_id,project_id,original_file_name,mime_type,storage_bucket,storage_path,sha256_hash,ingested_at")
            .in("email_id", weeklyIds)
            .or(`mime_type.in.(${SPREADSHEET_MIME_TYPES.join(",")}),original_file_name.ilike.%.xlsx,original_file_name.ilike.%.xlsm,original_file_name.ilike.%.xls`)
        : { data: [], error: null };
      if (spreadsheetsError) fail("Falha ao listar planilhas de relatórios semanais", spreadsheetsError);

      const rowsById = new Map<string, Record<string, unknown>>();
      for (const row of [...(flagged ?? []), ...(spreadsheets ?? [])]) {
        if (/\.(xlsx|xlsm|xls)$/i.test(String(row.original_file_name))) rowsById.set(row.id as string, row as Record<string, unknown>);
      }
      const rows = [...rowsById.values()];
      if (rows.length === 0) return [];

      const { data: existing, error: existingError } = await supabase
        .from("weekly_report_workbooks")
        .select("id,email_attachment_id,status")
        .in("email_attachment_id", rows.map((row) => row.id as string));
      if (existingError) fail("Falha ao verificar leituras existentes", existingError);
      // Reprocessa quando FAILED ou quando há aba mapeada/validada por humano
      // ainda sem métricas (map_weekly_report_sheet / validate_* zeram métricas).
      const existingIds = (existing ?? []).map((row) => row.id as string);
      const { data: pendingSheets } = existingIds.length
        ? await supabase.from("weekly_report_sheets").select("workbook_id").in("workbook_id", existingIds).in("status", WORKBOOK_SHEET_HUMAN_STATUSES).is("metrics", null)
        : { data: [] };
      const needsRerun = new Set((pendingSheets ?? []).map((row) => row.workbook_id as string));
      const done = new Set((existing ?? []).filter((row) => row.status !== "FAILED" && !needsRerun.has(row.id as string)).map((row) => row.email_attachment_id as string));

      const candidates: WorkbookCandidateAttachment[] = [];
      for (const row of rows) {
        if (done.has(row.id as string)) continue;
        if (candidates.length >= limit) break;
        const emailId = row.email_id as string;
        const [{ data: email }, { data: intake }] = await Promise.all([
          supabase.from("emails").select("work_week_number,work_week_label").eq("id", emailId).maybeSingle(),
          supabase.from("weekly_schedule_email_intakes").select("id,document_version_id").eq("email_id", emailId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const state = intake?.document_version_id ? await findScheduleVersionForDocumentVersion(supabase, intake.document_version_id as string) : null;
        candidates.push({
          attachmentId: row.id as string,
          emailId,
          projectId: row.project_id as string,
          intakeId: (intake?.id as string | undefined) ?? null,
          scheduleVersionId: state?.id ?? null,
          workWeekNumber: (email?.work_week_number as number | null) ?? null,
          workWeekLabel: (email?.work_week_label as string | null) ?? null,
          fileName: row.original_file_name as string,
          mimeType: row.mime_type as string,
          storageBucket: row.storage_bucket as string,
          storagePath: row.storage_path as string,
          sha256Hash: (row.sha256_hash as string | null) ?? null,
        });
      }
      return candidates;
    },

    async downloadAttachment(candidate) {
      const { data, error } = await supabase.storage.from(candidate.storageBucket).download(candidate.storagePath);
      if (error || !data) fail("Falha ao baixar planilha do Storage", error ?? null);
      return Buffer.from(await data.arrayBuffer());
    },

    async computeSha256(buffer) {
      return sha256Hex(buffer);
    },

    async loadProcessingContext(candidate) {
      const [thresholds, officialBaseline] = await Promise.all([loadThresholds(supabase, candidate.projectId), loadOfficialBaselineFacts(supabase, candidate.projectId)]);

      let mppFacts: MppFactsForCrossCheck | null = null;
      let criticalActivityCount: number | null = null;
      if (candidate.scheduleVersionId) {
        const [{ data: comparison }, { data: sv }, { count }] = await Promise.all([
          supabase.from("schedule_version_comparisons").select("metrics").eq("current_schedule_version_id", candidate.scheduleVersionId).eq("comparison_type", "PREVIOUS_WEEKLY").eq("status", "COMPUTED").maybeSingle(),
          supabase.from("schedule_versions").select("status_date").eq("id", candidate.scheduleVersionId).maybeSingle(),
          supabase.from("schedule_activities").select("id", { count: "exact", head: true }).eq("schedule_version_id", candidate.scheduleVersionId).eq("is_critical", true),
        ]);
        mppFacts = mppFactsFromComparison((comparison?.metrics as ScheduleComparisonMetrics | null) ?? null, (sv?.status_date as string | null) ?? null, candidate.workWeekLabel);
        criticalActivityCount = count ?? null;
      }

      // Semana anterior: última planilha do projeto com Curva S/Linha de Base extraída antes desta.
      let previousDeviationPp: number | null = null;
      let previousBaselineSheet: BaselineSheetData | null = null;
      const { data: previousWorkbooks } = await supabase
        .from("weekly_report_workbooks")
        .select("id,created_at,email_attachment_id")
        .eq("project_id", candidate.projectId)
        .neq("email_attachment_id", candidate.attachmentId)
        .in("status", ["EXTRACTED", "PARTIAL", "PENDING_HUMAN_REVIEW"])
        .order("created_at", { ascending: false })
        .limit(3);
      for (const workbook of previousWorkbooks ?? []) {
        const { data: sheets } = await supabase.from("weekly_report_sheets").select("category,status,metrics,data").eq("workbook_id", workbook.id as string);
        const curva = (sheets ?? []).find((sheet) => sheet.category === "CURVA_S" && ["EXTRACTED", "HUMAN_MAPPED", "HUMAN_VALIDATED"].includes(sheet.status as string));
        const base = (sheets ?? []).find((sheet) => sheet.category === "LINHA_BASE" && ["EXTRACTED", "HUMAN_MAPPED", "HUMAN_VALIDATED"].includes(sheet.status as string));
        if (previousDeviationPp === null && curva) previousDeviationPp = ((curva.metrics as { deviationPp?: number | null } | null)?.deviationPp ?? null);
        if (!previousBaselineSheet && base) previousBaselineSheet = base.data as BaselineSheetData;
        if (previousDeviationPp !== null && previousBaselineSheet) break;
      }

      // Decisões humanas já registradas nesta planilha (preservadas na reexecução).
      const humanDecisions: WorkbookProcessingContext["humanDecisions"] = {};
      const { data: current } = await supabase.from("weekly_report_workbooks").select("id").eq("email_attachment_id", candidate.attachmentId).maybeSingle();
      if (current) {
        const { data: humanSheets } = await supabase
          .from("weekly_report_sheets")
          .select("category,status,original_sheet_name,data,cutoff_date")
          .eq("workbook_id", current.id as string)
          .in("status", WORKBOOK_SHEET_HUMAN_STATUSES);
        for (const sheet of humanSheets ?? []) {
          humanDecisions[sheet.category as WeeklyReportSheetCategory] = {
            status: sheet.status as "HUMAN_MAPPED" | "HUMAN_VALIDATED",
            sheetName: (sheet.original_sheet_name as string | null) ?? null,
            data: (sheet.data as WeeklyReportSheetData | null) ?? null,
            cutoffDate: (sheet.cutoff_date as string | null) ?? null,
          };
        }
      }

      return { workWeekLabel: candidate.workWeekLabel, thresholds, mppFacts, officialBaseline, previousDeviationPp, previousBaselineSheet, criticalActivityCount, humanDecisions };
    },

    async saveWorkbook(candidate, input) {
      const { data: workbook, error } = await supabase
        .from("weekly_report_workbooks")
        .upsert(
          {
            project_id: candidate.projectId,
            email_id: candidate.emailId,
            email_attachment_id: candidate.attachmentId,
            intake_id: candidate.intakeId,
            schedule_version_id: candidate.scheduleVersionId,
            work_week_number: candidate.workWeekNumber,
            work_week_label: candidate.workWeekLabel,
            file_sha256: input.sha256,
            file_name: candidate.fileName,
            mime_type: candidate.mimeType,
            file_size_bytes: 0,
            detected_format: input.detectedFormat,
            extraction_method: "xlsx-stored-values-v1",
            extracted_at: new Date().toISOString(),
            sheet_index: input.sheetIndex,
            safety_report: input.safety ?? {},
            status: input.status,
            error_message: input.errorMessage,
            summary: input.summary,
          },
          { onConflict: "email_attachment_id" }
        )
        .select("id")
        .single();
      if (error) fail("Falha ao gravar planilha do relatório semanal", error);
      const workbookId = workbook.id as string;

      for (const sheet of input.sheets) {
        const { error: sheetError } = await supabase.from("weekly_report_sheets").upsert(
          {
            workbook_id: workbookId,
            project_id: candidate.projectId,
            category: sheet.category,
            status: sheet.status,
            original_sheet_name: sheet.originalSheetName,
            sheet_index: sheet.sheetIndex,
            candidate_sheet_names: sheet.candidateSheetNames,
            source_locator: sheet.locator,
            extraction_method: sheet.extractionMethod,
            confidence: sheet.confidence,
            data: sheet.data,
            cutoff_date: sheet.cutoffDate,
            metrics: sheet.metrics,
            cross_check: sheet.crossCheck,
            risk_classification: sheet.riskClassification,
            risk_reasons: sheet.riskReasons,
            alerts: sheet.alerts,
            expert_id: sheet.expertId,
            error_message: sheet.errorMessage,
          },
          { onConflict: "workbook_id,category" }
        );
        if (sheetError) fail(`Falha ao gravar aba ${sheet.category}`, sheetError);
      }
      // Tamanho real do arquivo (a partir do anexo) — evita depender do buffer aqui.
      const { data: attachment } = await supabase.from("email_attachments").select("file_size_bytes").eq("id", candidate.attachmentId).maybeSingle();
      if (attachment) await supabase.from("weekly_report_workbooks").update({ file_size_bytes: attachment.file_size_bytes }).eq("id", workbookId);
      return { id: workbookId };
    },

    writeAudit: (entry) => writeSystemAudit(supabase, entry),
  };
}

export function toCandidateAttachments(
  parts: Array<{ gmailAttachmentId: string; originalFileName: string; mimeType: string; declaredSizeBytes: number }>
): EmailAttachmentDescriptor[] {
  return parts.map((part) => ({
    gmailAttachmentId: part.gmailAttachmentId,
    fileName: part.originalFileName,
    mimeType: part.mimeType,
    sizeBytes: part.declaredSizeBytes,
    sha256Hash: null,
  }));
}

export type { WeeklyScheduleEmailCandidate };
