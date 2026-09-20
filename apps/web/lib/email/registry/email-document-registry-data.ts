// Leitura do REGISTRO DOCUMENTAL POR E-MAIL — sempre pelo client de
// sessão (createSupabaseServerClient): a RLS de emails/email_attachments/
// intakes/comparações/Curva S garante que usuário sem acesso ao projeto
// não vê nada. Busca/filtros/paginação são server-side via a função SQL
// search_email_document_registry (SECURITY INVOKER — mesma RLS).

import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { assertWeeklyReportsEnabled, isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import type { EmailDocumentClassification } from "./classify-email-document";
import type { RegistrySearchParams } from "./email-document-registry-shared";

export {
  EMAIL_CLASSIFICATION_LABELS,
  REGISTRY_CLASSIFICATION_OPTIONS,
  parseRegistrySearchParams,
  type RegistryClassificationFilter,
  type RegistrySearchParams,
} from "./email-document-registry-shared";

export interface RegistryRow {
  emailId: string;
  subject: string;
  fromAddress: string;
  toAddress: string;
  sentAt: string;
  direction: string | null;
  mailboxAddress: string | null;
  classification: EmailDocumentClassification | null;
  classificationStatus: string;
  classificationConfidence: number | null;
  workWeekNumber: number | null;
  workWeekLabel: string | null;
  workWeekStatus: string;
  sentToClient: boolean;
  attachmentCount: number;
  intakeId: string | null;
  intakeStatus: string | null;
  riskClassification: string | null;
}

export interface RegistryPage {
  rows: RegistryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function searchEmailDocumentRegistry(projectId: string, params: RegistrySearchParams): Promise<RegistryPage> {
  assertWeeklyReportsEnabled();
  const supabase = await createSupabaseServerClient();

  let classification: string | null = null;
  let sentToClient: boolean | null = null;
  let classificationStatus: string | null = null;
  switch (params.classification) {
    case "ALL":
      break;
    case "SENT_TO_CLIENT":
      sentToClient = true;
      break;
    case "PENDING_REVIEW":
      classificationStatus = "PENDING_HUMAN_REVIEW";
      break;
    default:
      classification = params.classification;
  }

  const { data, error } = await supabase.rpc("search_email_document_registry", {
    p_project_id: projectId,
    p_query: params.query || null,
    p_classification: classification,
    p_sent_to_client: sentToClient,
    p_direction: params.direction,
    p_from: params.from ? `${params.from}T00:00:00Z` : null,
    p_to: params.to ? `${params.to}T23:59:59Z` : null,
    p_sender: params.sender,
    p_recipient: params.recipient,
    p_work_week: params.workWeek,
    p_classification_status: classificationStatus,
    p_intake_status: params.intakeStatus,
    p_risk: params.risk,
    p_limit: params.pageSize,
    p_offset: (params.page - 1) * params.pageSize,
  });

  if (error) {
    // Migration ainda não aplicada (função inexistente) => registro vazio,
    // nunca erro de aplicação (mesmo padrão de fallback pré-migration
    // usado em getSlaAreaResponsibles).
    if (error.code === "42883" || error.code === "PGRST202") return { rows: [], total: 0, page: params.page, pageSize: params.pageSize };
    throw new Error(`Falha ao buscar registro documental por e-mail: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    rows: rows.map((row) => ({
      emailId: row.email_id as string,
      subject: row.subject as string,
      fromAddress: row.from_address as string,
      toAddress: row.to_address as string,
      sentAt: row.sent_at as string,
      direction: (row.direction as string | null) ?? null,
      mailboxAddress: (row.mailbox_address as string | null) ?? null,
      classification: (row.document_classification as EmailDocumentClassification | null) ?? null,
      classificationStatus: (row.classification_status as string) ?? "UNCLASSIFIED",
      classificationConfidence: row.classification_confidence === null ? null : Number(row.classification_confidence),
      workWeekNumber: (row.work_week_number as number | null) ?? null,
      workWeekLabel: (row.work_week_label as string | null) ?? null,
      workWeekStatus: (row.work_week_status as string) ?? "NOT_IDENTIFIED",
      sentToClient: Boolean(row.sent_to_client),
      attachmentCount: Number(row.attachment_count ?? 0),
      intakeId: (row.intake_id as string | null) ?? null,
      intakeStatus: (row.intake_status as string | null) ?? null,
      riskClassification: (row.risk_classification as string | null) ?? null,
    })),
    total: rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

// ------------------------------------------------------------------
// Detalhe de um e-mail (pacote documental)
// ------------------------------------------------------------------

export interface RegistryAttachment {
  id: string;
  fileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  storageBucket: string;
  storagePath: string;
  processingStatus: string;
  documentVersionId: string | null;
  suggestedClassification: string | null;
  confirmedClassification: string | null;
  classificationConfidence: number | null;
  driveSyncStatus: string;
}

export interface RegistryIntake {
  id: string;
  status: string;
  decisionRule: string;
  decisionReasons: string[];
  senderTier: string | null;
  weekStart: string;
  workWeekLabel: string | null;
  workWeekStatus: string;
  selectedEmailAttachmentId: string | null;
  documentVersionId: string | null;
  duplicateOfDocumentVersionId: string | null;
  failureError: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  attachmentsEvidence: unknown;
}

export interface RegistryComparison {
  comparisonType: string;
  status: string;
  referenceScheduleVersionId: string | null;
  riskClassification: string | null;
  riskReasons: string[];
  missingThresholds: string[];
  metrics: Record<string, unknown> | null;
  computedAt: string | null;
}

export interface RegistryWorkbookSheet {
  id: string;
  category: "CURVA_S" | "LINHA_BASE" | "FINANCEIRO" | "HISTOGRAMA" | "SSMA";
  status: string;
  originalSheetName: string | null;
  sheetIndex: number | null;
  candidateSheetNames: string[];
  sourceLocator: Record<string, unknown>;
  extractionMethod: string;
  confidence: number | null;
  data: Record<string, unknown>;
  cutoffDate: string | null;
  metrics: Record<string, unknown> | null;
  crossCheck: Record<string, unknown> | null;
  riskClassification: string | null;
  riskReasons: string[];
  alerts: Array<{ code: string; detail: string; severity: string }>;
  expertId: string;
  errorMessage: string | null;
  mappedAt: string | null;
}

/** Planilha Excel do relatório semanal (unidade documental) + abas extraídas. */
export interface RegistryWorkbook {
  id: string;
  emailAttachmentId: string;
  fileName: string;
  fileSha256: string;
  detectedFormat: string;
  status: string;
  extractionMethod: string;
  extractedAt: string | null;
  sheetIndex: Array<{ index: number; name: string; hidden: boolean; rowCount: number }>;
  safetyReport: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  errorMessage: string | null;
  sheets: RegistryWorkbookSheet[];
}

export interface RegistryReviewEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  field: string | null;
  previousValue: unknown;
  newValue: unknown;
  justification: string;
  decidedByUserId: string;
  decidedByName: string | null;
  decidedAt: string;
  reprocessResult: unknown;
}

export interface RegistryEmailDetail {
  email: {
    id: string;
    projectId: string;
    subject: string;
    fromAddress: string;
    toAddress: string;
    sentAt: string;
    snippet: string;
    direction: string | null;
    mailboxAddress: string | null;
    providerMessageId: string | null;
    providerThreadId: string | null;
    messageIdHeader: string | null;
    providerLabels: string[];
    classification: EmailDocumentClassification | null;
    classificationStatus: string;
    classificationConfidence: number | null;
    classificationReasons: string[];
    workWeekNumber: number | null;
    workWeekLabel: string | null;
    workWeekStatus: string;
    sentToClient: boolean;
  };
  attachments: RegistryAttachment[];
  intake: RegistryIntake | null;
  scheduleVersion: { id: string; extractionStatus: string; statusDate: string | null; activityCount: number } | null;
  comparisons: RegistryComparison[];
  workbooks: RegistryWorkbook[];
  reviewEvents: RegistryReviewEvent[];
  activeBaseline: { scheduleVersionId: string; effectiveFrom: string; justification: string } | null;
  /** Versões extraídas do projeto (para o seletor de baseline). */
  extractedScheduleVersions: Array<{ id: string; label: string; extractedAt: string | null }>;
  otherSendsSameWeek: Array<{ emailId: string; sentAt: string; intakeStatus: string | null }>;
}

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]{1,6})$/i.exec(fileName.trim());
  return match ? match[1].toUpperCase() : "";
}

export async function getEmailDocumentDetail(projectId: string, emailId: string): Promise<RegistryEmailDetail | null> {
  if (!isWeeklyReportsEnabled()) return null;
  const supabase = await createSupabaseServerClient();

  const { data: email, error: emailError } = await supabase.from("emails").select("*").eq("id", emailId).eq("project_id", projectId).maybeSingle();
  if (emailError) throw new Error(`Falha ao carregar e-mail: ${emailError.message}`);
  if (!email) return null;

  const [{ data: attachments }, { data: intake }, { data: reviewRows }, { data: baseline }] = await Promise.all([
    supabase.from("email_attachments").select("*").eq("email_id", emailId).order("original_file_name"),
    supabase.from("weekly_schedule_email_intakes").select("*").eq("email_id", emailId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("email_document_review_events").select("*").eq("project_id", projectId).order("decided_at", { ascending: false }).limit(200),
    supabase.from("project_schedule_baselines").select("schedule_version_id,effective_from,justification").eq("project_id", projectId).is("superseded_at", null).maybeSingle(),
  ]);

  const attachmentIds = (attachments ?? []).map((row) => row.id as string);
  const { data: workbookRows } = attachmentIds.length
    ? await supabase.from("weekly_report_workbooks").select("*").in("email_attachment_id", attachmentIds)
    : { data: [] };
  const workbookIds = (workbookRows ?? []).map((row) => row.id as string);
  const { data: sheetRows } = workbookIds.length
    ? await supabase.from("weekly_report_sheets").select("*").in("workbook_id", workbookIds).order("category")
    : { data: [] };

  let scheduleVersion: RegistryEmailDetail["scheduleVersion"] = null;
  let comparisons: RegistryComparison[] = [];
  if (intake?.document_version_id) {
    const { data: sv } = await supabase
      .from("schedule_versions")
      .select("id,extraction_status,status_date")
      .eq("document_version_id", intake.document_version_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sv) {
      const [{ count }, { data: comparisonRows }] = await Promise.all([
        supabase.from("schedule_activities").select("id", { count: "exact", head: true }).eq("schedule_version_id", sv.id),
        supabase.from("schedule_version_comparisons").select("*").eq("current_schedule_version_id", sv.id),
      ]);
      scheduleVersion = { id: sv.id, extractionStatus: sv.extraction_status, statusDate: sv.status_date, activityCount: count ?? 0 };
      comparisons = (comparisonRows ?? []).map((row) => ({
        comparisonType: row.comparison_type,
        status: row.status,
        referenceScheduleVersionId: row.reference_schedule_version_id,
        riskClassification: row.risk_classification,
        riskReasons: (row.risk_reasons as string[]) ?? [],
        missingThresholds: (row.missing_thresholds as string[]) ?? [],
        metrics: (row.metrics as Record<string, unknown> | null) ?? null,
        computedAt: row.computed_at,
      }));
    }
  }

  const { data: extractedVersions } = await supabase
    .from("schedule_versions")
    .select("id,extracted_at,version_type,document_versions!inner(project_id,version_label,original_file_name,document_date)")
    .eq("extraction_status", "EXTRACTED")
    .eq("document_versions.project_id", projectId)
    .order("extracted_at", { ascending: false })
    .limit(50);

  const entityIds = new Set<string>([emailId, ...attachmentIds, ...(intake ? [intake.id as string] : []), ...((sheetRows ?? []).map((row) => row.id as string))]);
  const relevantEvents = (reviewRows ?? []).filter((row) => entityIds.has(row.entity_id as string) || row.entity_type === "SCHEDULE_BASELINE");
  const userIds = [...new Set(relevantEvents.map((row) => row.decided_by_user_id as string))];
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("id,name").in("id", userIds) : { data: [] };
  const nameById = new Map((profiles ?? []).map((row) => [row.id as string, row.name as string]));

  const workWeekNumber = (email.work_week_number as number | null) ?? null;
  const { data: sameWeek } = workWeekNumber
    ? await supabase.from("emails").select("id,sent_at").eq("project_id", projectId).eq("work_week_number", workWeekNumber).neq("id", emailId).order("sent_at", { ascending: false })
    : { data: [] };

  return {
    email: {
      id: email.id,
      projectId: email.project_id,
      subject: email.subject,
      fromAddress: email.from_address,
      toAddress: email.to_address,
      sentAt: email.sent_at,
      snippet: email.snippet,
      direction: email.direction,
      mailboxAddress: email.mailbox_address,
      providerMessageId: email.provider_message_id,
      providerThreadId: email.provider_thread_id,
      messageIdHeader: email.message_id_header,
      providerLabels: (email.provider_labels as string[] | null) ?? [],
      classification: (email.document_classification as EmailDocumentClassification | null) ?? null,
      classificationStatus: (email.classification_status as string) ?? "UNCLASSIFIED",
      classificationConfidence: email.classification_confidence === null || email.classification_confidence === undefined ? null : Number(email.classification_confidence),
      classificationReasons: (email.classification_reasons as string[] | null) ?? [],
      workWeekNumber,
      workWeekLabel: (email.work_week_label as string | null) ?? null,
      workWeekStatus: (email.work_week_status as string) ?? "NOT_IDENTIFIED",
      sentToClient: Boolean(email.sent_to_client),
    },
    attachments: (attachments ?? []).map((row) => ({
      id: row.id,
      fileName: row.original_file_name,
      extension: extensionOf(row.original_file_name),
      mimeType: row.mime_type,
      sizeBytes: Number(row.file_size_bytes),
      sha256Hash: row.sha256_hash,
      storageBucket: row.storage_bucket,
      storagePath: row.storage_path,
      processingStatus: row.processing_status,
      documentVersionId: row.document_version_id,
      suggestedClassification: row.suggested_classification ?? null,
      confirmedClassification: row.confirmed_classification ?? null,
      classificationConfidence: row.classification_confidence === null || row.classification_confidence === undefined ? null : Number(row.classification_confidence),
      driveSyncStatus: row.drive_sync_status,
    })),
    intake: intake
      ? {
          id: intake.id,
          status: intake.status,
          decisionRule: intake.decision_rule,
          decisionReasons: (intake.decision_reasons as string[]) ?? [],
          senderTier: intake.sender_tier ?? null,
          weekStart: intake.week_start,
          workWeekLabel: intake.work_week_label ?? null,
          workWeekStatus: intake.work_week_status ?? "NOT_IDENTIFIED",
          selectedEmailAttachmentId: intake.selected_email_attachment_id,
          documentVersionId: intake.document_version_id,
          duplicateOfDocumentVersionId: intake.duplicate_of_document_version_id,
          failureError: intake.failure_error,
          reviewedAt: intake.reviewed_at,
          reviewNote: intake.review_note,
          attachmentsEvidence: intake.attachments,
        }
      : null,
    scheduleVersion,
    comparisons,
    workbooks: (workbookRows ?? []).map((row) => ({
      id: row.id,
      emailAttachmentId: row.email_attachment_id,
      fileName: row.file_name,
      fileSha256: row.file_sha256,
      detectedFormat: row.detected_format,
      status: row.status,
      extractionMethod: row.extraction_method,
      extractedAt: row.extracted_at,
      sheetIndex: (row.sheet_index as RegistryWorkbook["sheetIndex"]) ?? [],
      safetyReport: (row.safety_report as Record<string, unknown>) ?? {},
      summary: (row.summary as Record<string, unknown> | null) ?? null,
      errorMessage: row.error_message,
      sheets: (sheetRows ?? [])
        .filter((sheet) => sheet.workbook_id === row.id)
        .map((sheet) => ({
          id: sheet.id,
          category: sheet.category,
          status: sheet.status,
          originalSheetName: sheet.original_sheet_name,
          sheetIndex: sheet.sheet_index,
          candidateSheetNames: (sheet.candidate_sheet_names as string[]) ?? [],
          sourceLocator: (sheet.source_locator as Record<string, unknown>) ?? {},
          extractionMethod: sheet.extraction_method,
          confidence: sheet.confidence === null ? null : Number(sheet.confidence),
          data: (sheet.data as Record<string, unknown>) ?? {},
          cutoffDate: sheet.cutoff_date,
          metrics: (sheet.metrics as Record<string, unknown> | null) ?? null,
          crossCheck: (sheet.cross_check as Record<string, unknown> | null) ?? null,
          riskClassification: sheet.risk_classification,
          riskReasons: (sheet.risk_reasons as string[]) ?? [],
          alerts: (sheet.alerts as RegistryWorkbookSheet["alerts"]) ?? [],
          expertId: sheet.expert_id,
          errorMessage: sheet.error_message,
          mappedAt: sheet.mapped_at,
        })),
    })),
    reviewEvents: relevantEvents.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      field: row.field,
      previousValue: row.previous_value,
      newValue: row.new_value,
      justification: row.justification,
      decidedByUserId: row.decided_by_user_id,
      decidedByName: nameById.get(row.decided_by_user_id as string) ?? null,
      decidedAt: row.decided_at,
      reprocessResult: row.reprocess_result,
    })),
    activeBaseline: baseline
      ? { scheduleVersionId: baseline.schedule_version_id, effectiveFrom: baseline.effective_from, justification: baseline.justification }
      : null,
    extractedScheduleVersions: ((extractedVersions ?? []) as Array<Record<string, unknown>>).map((row) => {
      const dv = row.document_versions as { version_label?: string; original_file_name?: string | null; document_date?: string } | null;
      return {
        id: row.id as string,
        label: `${dv?.original_file_name ?? "cronograma"} · ${dv?.version_label ?? ""} · ${dv?.document_date ?? ""} (${row.version_type as string})`,
        extractedAt: (row.extracted_at as string | null) ?? null,
      };
    }),
    otherSendsSameWeek: (sameWeek ?? []).map((row) => ({ emailId: row.id as string, sentAt: row.sent_at as string, intakeStatus: null })),
  };
}
