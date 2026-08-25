// Ponto único de acesso a dados. getProjects()/getProject()/getUsers()/
// getUser()/getProjectMembers()/getDocuments()/getDocument()/getClauses()/
// getClause()/getScheduleActivities()/getScheduleActivity()/getEmails()/
// getEmail()/getEvents()/getEvent()/getContractChanges()/getContractChange()
// já consultam o Supabase real; as demais funções ainda lêem de
// @axion/mock-data enquanto seus módulos correspondentes não são migrados.
import {
  clauses,
  documents,
  emails,
  scheduleActivities,
  sourceDefinitions,
} from "@axion/mock-data";
import type { Alert } from "@axion/types";
import { createSupabaseServerClient } from "@axion/db/server";
import {
  mapActionRequestAssigneeRow,
  mapActionRequestResponseRow,
  mapActionRequestRow,
  type ActionRequestAssigneeRow,
  type ActionRequestResponseRow,
  type ActionRequestRow,
} from "./action-request-mapper";
import { mapClauseRow, type ClauseRow, type ClauseVersionParent } from "./clause-mapper";
import { mapContractChangeRow, type ContractChangeRow } from "./contract-change-mapper";
import {
  mapNotificationEmailDeliveryRow,
  mapNotificationRecipientRow,
  mapNotificationRow,
  type NotificationEmailDeliveryRow,
  type NotificationRecipientRow,
  type NotificationRow,
} from "./notification-mapper";
import {
  mapDocumentVersionRow,
  mapDocumentWithVersion,
  pickCurrentVersion,
  type DocumentRow,
  type DocumentVersionRow,
} from "./document-mapper";
import {
  mapContractEventRow,
  type ContractEventRow,
  type EventAiAssessmentRow,
  type EventCategoryRow,
  type EventCrossReferenceRow,
  type EventEvidenceRow,
} from "./event-mapper";
import { mapProjectRow, type ProjectRow } from "./project-mapper";
import { mapProjectPackageRow, type ProjectPackageRow } from "./project-package-mapper";
import { mapScheduleActivityRow, type ScheduleActivityRow } from "./schedule-mapper";
import {
  mapMembershipRow,
  mapUserRow,
  type MembershipWithProfileRow,
  type UserRow,
} from "./user-mapper";

const PROJECT_COLUMNS =
  "id, code, name, client, status, location, contract_number, start_date, baseline_end_date";

const PROFILE_COLUMNS = "id, name, email, origin, title, avatar_initials";

const DOCUMENT_COLUMNS = "id, project_id, kind, title, created_at";

const DOCUMENT_VERSION_COLUMNS =
  "id, document_id, version_label, version_index, document_date, source_type, author, summary, file_path, uploaded_by, uploaded_at, notes";

const CLAUSE_COLUMNS = "id, document_version_id, clause_number, title, text, created_at";

const SCHEDULE_ACTIVITY_COLUMNS =
  "id, schedule_version_id, name, baseline_start, baseline_end, planned_start, planned_end, status, created_at";

const EMAIL_COLUMNS = "id, project_id, from_address, to_address, subject, sent_at, snippet";

const CONTRACT_EVENT_COLUMNS =
  "id, project_id, occurred_at, title, description, source_type, status, created_by_type, created_by_user_id, created_by_label, created_at";

const EVENT_CATEGORY_COLUMNS = "event_id, category";

const EVENT_EVIDENCE_COLUMNS =
  "id, event_id, source_type, label, locator, document_version_id, email_id, created_at";

const EVENT_AI_ASSESSMENT_COLUMNS =
  "id, event_id, finding_type, severity, summary, confidence, requires_human_review, created_at";

const EVENT_CROSS_REFERENCE_COLUMNS =
  "id, event_id, kind, document_id, clause_id, schedule_activity_id, email_id, note, created_at";

const CONTRACT_CHANGE_COLUMNS =
  "id, project_id, code, title, description, status, identified_at, created_by_type, created_by_user_id, created_by_label, client_formalization_status, schedule_impact_status, technical_additional_days, created_at";

const ACTION_REQUEST_COLUMNS =
  "id, project_id, title, description, status, requested_at, due_at, closed_at, created_by_type, created_by_user_id, created_by_label, created_at";

const ACTION_REQUEST_ASSIGNEE_COLUMNS = "action_request_id, project_id, user_id, created_at";

const ACTION_REQUEST_RESPONSE_COLUMNS =
  "id, action_request_id, project_id, channel, responder_user_id, email_id, content, responded_at, created_at";

const NOTIFICATION_COLUMNS =
  "id, project_id, action_request_id, kind, status, subject, body, created_by_type, created_by_user_id, created_by_label, created_at, sent_at";

const NOTIFICATION_RECIPIENT_COLUMNS =
  "notification_id, project_id, recipient_type, recipient_user_id, recipient_email, created_at";

const NOTIFICATION_EMAIL_DELIVERY_COLUMNS =
  "id, notification_id, project_id, recipient_email, direction, status, email_id, correlation_id, provider, provider_message_id, provider_thread_id, message_id_header, reply_to_delivery_id, sent_at, received_at, created_at";

type EmailRow = {
  id: string;
  project_id: string;
  from_address: string;
  to_address: string;
  subject: string;
  sent_at: string;
  snippet: string;
};

function mapEmailRow(row: EmailRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    from: row.from_address,
    to: row.to_address,
    subject: row.subject,
    date: row.sent_at,
    snippet: row.snippet,
  };
}

export async function getProjects() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data as ProjectRow[]).map(mapProjectRow);
}

export async function getProject(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") {
      return null;
    }
    throw error;
  }

  return data ? mapProjectRow(data as ProjectRow) : null;
}

export async function getEvents(projectId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: eventRows, error: eventsError } = await supabase
    .from("contract_events")
    .select(CONTRACT_EVENT_COLUMNS)
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false });

  if (eventsError) {
    if (eventsError.code === "22P02") {
      return [];
    }
    throw eventsError;
  }

  const rows = eventRows as ContractEventRow[];
  if (rows.length === 0) {
    return [];
  }

  const eventIds = rows.map((row) => row.id);

  const [categoriesResult, evidenceResult, aiAssessmentsResult, crossReferencesResult] = await Promise.all([
    supabase.from("event_categories").select(EVENT_CATEGORY_COLUMNS).in("event_id", eventIds),
    supabase.from("event_evidence").select(EVENT_EVIDENCE_COLUMNS).in("event_id", eventIds),
    supabase.from("event_ai_assessments").select(EVENT_AI_ASSESSMENT_COLUMNS).in("event_id", eventIds),
    supabase.from("event_cross_references").select(EVENT_CROSS_REFERENCE_COLUMNS).in("event_id", eventIds),
  ]);

  if (categoriesResult.error) {
    throw categoriesResult.error;
  }
  if (evidenceResult.error) {
    throw evidenceResult.error;
  }
  if (aiAssessmentsResult.error) {
    throw aiAssessmentsResult.error;
  }
  if (crossReferencesResult.error) {
    throw crossReferencesResult.error;
  }

  const categoriesByEventId = new Map<string, EventCategoryRow[]>();
  for (const category of categoriesResult.data as EventCategoryRow[]) {
    const list = categoriesByEventId.get(category.event_id) ?? [];
    list.push(category);
    categoriesByEventId.set(category.event_id, list);
  }

  const evidenceByEventId = new Map<string, EventEvidenceRow[]>();
  for (const evidence of evidenceResult.data as EventEvidenceRow[]) {
    const list = evidenceByEventId.get(evidence.event_id) ?? [];
    list.push(evidence);
    evidenceByEventId.set(evidence.event_id, list);
  }

  const aiAssessmentsByEventId = new Map<string, EventAiAssessmentRow[]>();
  for (const assessment of aiAssessmentsResult.data as EventAiAssessmentRow[]) {
    const list = aiAssessmentsByEventId.get(assessment.event_id) ?? [];
    list.push(assessment);
    aiAssessmentsByEventId.set(assessment.event_id, list);
  }

  const crossReferencesByEventId = new Map<string, EventCrossReferenceRow[]>();
  for (const crossReference of crossReferencesResult.data as EventCrossReferenceRow[]) {
    const list = crossReferencesByEventId.get(crossReference.event_id) ?? [];
    list.push(crossReference);
    crossReferencesByEventId.set(crossReference.event_id, list);
  }

  return rows.map((row) =>
    mapContractEventRow(
      row,
      categoriesByEventId.get(row.id) ?? [],
      evidenceByEventId.get(row.id) ?? [],
      aiAssessmentsByEventId.get(row.id) ?? [],
      crossReferencesByEventId.get(row.id) ?? []
    )
  );
}

export async function getEvent(eventId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: eventRow, error: eventError } = await supabase
    .from("contract_events")
    .select(CONTRACT_EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    if (eventError.code === "22P02") {
      return null;
    }
    throw new Error(`Falha ao carregar evento: ${eventError.message}`);
  }

  if (!eventRow) {
    return null;
  }

  const row = eventRow as ContractEventRow;

  const [categoriesResult, evidenceResult, aiAssessmentsResult, crossReferencesResult] = await Promise.all([
    supabase.from("event_categories").select(EVENT_CATEGORY_COLUMNS).eq("event_id", row.id),
    supabase.from("event_evidence").select(EVENT_EVIDENCE_COLUMNS).eq("event_id", row.id),
    supabase.from("event_ai_assessments").select(EVENT_AI_ASSESSMENT_COLUMNS).eq("event_id", row.id),
    supabase.from("event_cross_references").select(EVENT_CROSS_REFERENCE_COLUMNS).eq("event_id", row.id),
  ]);

  if (categoriesResult.error) {
    throw new Error(`Falha ao carregar categorias do evento: ${categoriesResult.error.message}`);
  }
  if (evidenceResult.error) {
    throw new Error(`Falha ao carregar evidências do evento: ${evidenceResult.error.message}`);
  }
  if (aiAssessmentsResult.error) {
    throw new Error(`Falha ao carregar achados de IA do evento: ${aiAssessmentsResult.error.message}`);
  }
  if (crossReferencesResult.error) {
    throw new Error(`Falha ao carregar referências cruzadas do evento: ${crossReferencesResult.error.message}`);
  }

  return mapContractEventRow(
    row,
    categoriesResult.data as EventCategoryRow[],
    evidenceResult.data as EventEvidenceRow[],
    aiAssessmentsResult.data as EventAiAssessmentRow[],
    crossReferencesResult.data as EventCrossReferenceRow[]
  );
}

// Ainda não existe tabela real de Alert no banco — retorna vazio em vez de
// dado fictício (o dashboard já trata lista vazia como estado real via
// EmptyState). Substituir por consulta Supabase quando Alert for modelado.
export function getAlerts(projectId: string): Alert[] {
  void projectId;
  return [];
}

export async function getProjectPackages(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: packageRows, error: packagesError } = await supabase
    .from("project_packages")
    .select("id, project_id, code, title, description, package_type, status, created_at")
    .eq("project_id", projectId)
    .order("code", { ascending: true });

  if (packagesError) {
    if (packagesError.code === "22P02") {
      return [];
    }
    throw packagesError;
  }

  return (packageRows as ProjectPackageRow[]).map(mapProjectPackageRow);
}

export async function getDocuments(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: documentRows, error: documentsError } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("project_id", projectId);

  if (documentsError) {
    if (documentsError.code === "22P02") {
      return [];
    }
    throw documentsError;
  }

  const rows = documentRows as DocumentRow[];
  if (rows.length === 0) {
    return [];
  }

  const { data: versionRows, error: versionsError } = await supabase
    .from("document_versions")
    .select(DOCUMENT_VERSION_COLUMNS)
    .in(
      "document_id",
      rows.map((row) => row.id)
    );

  if (versionsError) {
    throw versionsError;
  }

  const versionsByDocumentId = new Map<string, DocumentVersionRow[]>();
  for (const version of versionRows as DocumentVersionRow[]) {
    const list = versionsByDocumentId.get(version.document_id) ?? [];
    list.push(version);
    versionsByDocumentId.set(version.document_id, list);
  }

  return rows.map((row) =>
    mapDocumentWithVersion(row, pickCurrentVersion(versionsByDocumentId.get(row.id) ?? []))
  );
}

export async function getDocument(documentId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: documentRow, error: documentError } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .maybeSingle();

  if (documentError) {
    if (documentError.code === "22P02") {
      return null;
    }
    throw new Error(`Falha ao carregar documento: ${documentError.message}`);
  }

  if (!documentRow) {
    return null;
  }

  const { data: versionRows, error: versionsError } = await supabase
    .from("document_versions")
    .select(DOCUMENT_VERSION_COLUMNS)
    .eq("document_id", (documentRow as DocumentRow).id);

  if (versionsError) {
    throw new Error(`Falha ao carregar versões do documento: ${versionsError.message}`);
  }

  return mapDocumentWithVersion(
    documentRow as DocumentRow,
    pickCurrentVersion(versionRows as DocumentVersionRow[])
  );
}

export async function getDocumentVersion(documentVersionId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: versionRow, error: versionError } = await supabase
    .from("document_versions")
    .select(DOCUMENT_VERSION_COLUMNS)
    .eq("id", documentVersionId)
    .maybeSingle();

  if (versionError) {
    if (versionError.code === "22P02") {
      return null;
    }
    throw new Error(`Falha ao carregar versão do documento: ${versionError.message}`);
  }

  return versionRow ? mapDocumentVersionRow(versionRow as DocumentVersionRow) : null;
}

// TEMPORARY MOCK SEAM: usada apenas por resolveCrossReferenceLabel, que ficou
// órfã de consumidores reais depois que Event Ledger/CrossReferenceList
// passaram a resolver DOCUMENT via getDocument real. Mantida só para não
// quebrar a compilação enquanto resolveCrossReferenceLabel não é removida.
export function getMockDocument(documentId: string) {
  return documents.find((d) => d.id === documentId) ?? null;
}

export async function getClauses(projectId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: documentRows, error: documentsError } = await supabase
    .from("documents")
    .select("id, project_id")
    .eq("project_id", projectId);

  if (documentsError) {
    if (documentsError.code === "22P02") {
      return [];
    }
    throw documentsError;
  }

  const docs = documentRows as { id: string; project_id: string }[];
  if (docs.length === 0) {
    return [];
  }

  const { data: versionRows, error: versionsError } = await supabase
    .from("document_versions")
    .select("id, document_id")
    .in(
      "document_id",
      docs.map((d) => d.id)
    );

  if (versionsError) {
    throw versionsError;
  }

  const versions = versionRows as { id: string; document_id: string }[];
  if (versions.length === 0) {
    return [];
  }

  const { data: clauseRows, error: clausesError } = await supabase
    .from("clauses")
    .select(CLAUSE_COLUMNS)
    .in(
      "document_version_id",
      versions.map((v) => v.id)
    );

  if (clausesError) {
    throw clausesError;
  }

  const projectIdByDocumentId = new Map(docs.map((d) => [d.id, d.project_id]));
  const parentByVersionId = new Map<string, ClauseVersionParent>();
  for (const version of versions) {
    const parentProjectId = projectIdByDocumentId.get(version.document_id);
    if (parentProjectId) {
      parentByVersionId.set(version.id, {
        documentId: version.document_id,
        projectId: parentProjectId,
      });
    }
  }

  return (clauseRows as ClauseRow[])
    .map((row) =>
      mapClauseRow(row, parentByVersionId.get(row.document_version_id))
    )
    .sort((a, b) =>
      a.clauseNumber.localeCompare(b.clauseNumber, "pt-BR", {
        numeric: true,
        sensitivity: "base",
      })
    );
}

export async function getClause(clauseId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: clauseRow, error: clauseError } = await supabase
    .from("clauses")
    .select(CLAUSE_COLUMNS)
    .eq("id", clauseId)
    .maybeSingle();

  if (clauseError) {
    if (clauseError.code === "22P02") {
      return null;
    }
    throw new Error(`Falha ao carregar cláusula: ${clauseError.message}`);
  }

  if (!clauseRow) {
    return null;
  }

  const row = clauseRow as ClauseRow;

  const { data: versionRow, error: versionError } = await supabase
    .from("document_versions")
    .select("id, document_id")
    .eq("id", row.document_version_id)
    .maybeSingle();

  if (versionError) {
    throw new Error(`Falha ao carregar versão do documento da cláusula: ${versionError.message}`);
  }

  if (!versionRow) {
    throw new Error(
      `Inconsistência estrutural: clause (id=${clauseId}) referencia document_version_id=${row.document_version_id} não encontrado.`
    );
  }

  const version = versionRow as { id: string; document_id: string };

  const { data: documentRow, error: documentError } = await supabase
    .from("documents")
    .select("id, project_id")
    .eq("id", version.document_id)
    .maybeSingle();

  if (documentError) {
    throw new Error(`Falha ao carregar documento da cláusula: ${documentError.message}`);
  }

  if (!documentRow) {
    throw new Error(
      `Inconsistência estrutural: clause (id=${clauseId}) → document_version (id=${version.id}) → document (id=${version.document_id}) não encontrado.`
    );
  }

  const document = documentRow as { id: string; project_id: string };

  return mapClauseRow(row, {
    documentId: version.document_id,
    projectId: document.project_id,
  });
}

// TEMPORARY MOCK SEAM: usada apenas por resolveCrossReferenceLabel, que ficou
// órfã de consumidores reais depois que Event Ledger/CrossReferenceList
// passaram a resolver CLAUSE via getClause real. Mantida só para não quebrar
// a compilação enquanto resolveCrossReferenceLabel não é removida.
export function getMockClause(clauseId: string) {
  return clauses.find((c) => c.id === clauseId) ?? null;
}

export async function getScheduleActivities(projectId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: documentRows, error: documentsError } = await supabase
    .from("documents")
    .select("id, project_id")
    .eq("project_id", projectId);

  if (documentsError) {
    if (documentsError.code === "22P02") {
      return [];
    }
    throw documentsError;
  }

  const docs = documentRows as { id: string; project_id: string }[];
  if (docs.length === 0) {
    return [];
  }

  const { data: versionRows, error: versionsError } = await supabase
    .from("document_versions")
    .select("id, document_id")
    .in(
      "document_id",
      docs.map((d) => d.id)
    );

  if (versionsError) {
    throw versionsError;
  }

  const versions = versionRows as { id: string; document_id: string }[];
  if (versions.length === 0) {
    return [];
  }

  const { data: scheduleVersionRows, error: scheduleVersionsError } = await supabase
    .from("schedule_versions")
    .select("id, document_version_id, lifecycle_status")
    .in(
      "document_version_id",
      versions.map((v) => v.id)
    );

  if (scheduleVersionsError) {
    throw scheduleVersionsError;
  }

  // Versão operacional = lifecycle_status 'ISSUED', exclusivamente (decisão
  // 2.5G3G). DRAFT/SUPERSEDED/ARCHIVED nunca contam como cronograma
  // operacional. Nunca escolher por max(created_at), version_type ou
  // client_formalization_status — ISSUED é um status técnico de
  // Planejamento, distinto de formalização do cliente/aditivo/entitlement.
  const issuedScheduleVersions = (
    scheduleVersionRows as { id: string; document_version_id: string; lifecycle_status: string }[]
  ).filter((sv) => sv.lifecycle_status === "ISSUED");

  if (issuedScheduleVersions.length === 0) {
    return [];
  }

  if (issuedScheduleVersions.length > 1) {
    throw new Error(
      `Inconsistência estrutural: projeto (id=${projectId}) possui ${issuedScheduleVersions.length} ScheduleVersions com lifecycle_status='ISSUED'; deveria haver no máximo 1 versão operacional vigente por projeto.`
    );
  }

  const scheduleVersion = issuedScheduleVersions[0];

  const { data: activityRows, error: activitiesError } = await supabase
    .from("schedule_activities")
    .select(SCHEDULE_ACTIVITY_COLUMNS)
    .eq("schedule_version_id", scheduleVersion.id);

  if (activitiesError) {
    throw activitiesError;
  }

  return (activityRows as ScheduleActivityRow[]).map((row) =>
    mapScheduleActivityRow(row, { projectId })
  );
}

export async function getScheduleActivity(activityId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: activityRow, error: activityError } = await supabase
    .from("schedule_activities")
    .select(SCHEDULE_ACTIVITY_COLUMNS)
    .eq("id", activityId)
    .maybeSingle();

  if (activityError) {
    if (activityError.code === "22P02") {
      return null;
    }
    throw new Error(`Falha ao carregar atividade do cronograma: ${activityError.message}`);
  }

  if (!activityRow) {
    return null;
  }

  const row = activityRow as ScheduleActivityRow;

  const { data: scheduleVersionRow, error: scheduleVersionError } = await supabase
    .from("schedule_versions")
    .select("id, document_version_id")
    .eq("id", row.schedule_version_id)
    .maybeSingle();

  if (scheduleVersionError) {
    throw new Error(`Falha ao carregar versão do cronograma: ${scheduleVersionError.message}`);
  }

  if (!scheduleVersionRow) {
    throw new Error(
      `Inconsistência estrutural: schedule_activity (id=${activityId}) referencia schedule_version_id=${row.schedule_version_id} não encontrado.`
    );
  }

  const scheduleVersion = scheduleVersionRow as { id: string; document_version_id: string };

  const { data: documentVersionRow, error: documentVersionError } = await supabase
    .from("document_versions")
    .select("id, document_id")
    .eq("id", scheduleVersion.document_version_id)
    .maybeSingle();

  if (documentVersionError) {
    throw new Error(`Falha ao carregar versão do documento do cronograma: ${documentVersionError.message}`);
  }

  if (!documentVersionRow) {
    throw new Error(
      `Inconsistência estrutural: schedule_activity (id=${activityId}) → schedule_version (id=${scheduleVersion.id}) → document_version (id=${scheduleVersion.document_version_id}) não encontrado.`
    );
  }

  const documentVersion = documentVersionRow as { id: string; document_id: string };

  const { data: documentRow, error: documentError } = await supabase
    .from("documents")
    .select("id, project_id")
    .eq("id", documentVersion.document_id)
    .maybeSingle();

  if (documentError) {
    throw new Error(`Falha ao carregar documento do cronograma: ${documentError.message}`);
  }

  if (!documentRow) {
    throw new Error(
      `Inconsistência estrutural: schedule_activity (id=${activityId}) → document_version (id=${documentVersion.id}) → document (id=${documentVersion.document_id}) não encontrado.`
    );
  }

  const document = documentRow as { id: string; project_id: string };

  return mapScheduleActivityRow(row, { projectId: document.project_id });
}

// TEMPORARY MOCK SEAM: usada apenas por resolveCrossReferenceLabel, que ficou
// órfã de consumidores reais depois que Event Ledger/CrossReferenceList
// passaram a resolver SCHEDULE_ACTIVITY via getScheduleActivity real. Mantida
// só para não quebrar a compilação enquanto resolveCrossReferenceLabel não é
// removida.
export function getMockScheduleActivity(activityId: string) {
  return scheduleActivities.find((s) => s.id === activityId) ?? null;
}

export async function getEmails(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("emails")
    .select(EMAIL_COLUMNS)
    .eq("project_id", projectId)
    .order("sent_at", { ascending: false });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as EmailRow[]).map(mapEmailRow);
}

export async function getEmail(emailId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("emails")
    .select(EMAIL_COLUMNS)
    .eq("id", emailId)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") {
      return null;
    }
    throw new Error(`Falha ao carregar e-mail: ${error.message}`);
  }

  return data ? mapEmailRow(data as EmailRow) : null;
}

// TEMPORARY MOCK SEAM: usada apenas por resolveCrossReferenceLabel, que ficou
// órfã de consumidores reais depois que Event Ledger/CrossReferenceList
// passaram a resolver EMAIL via getEmail real. Mantida só para não quebrar a
// compilação enquanto resolveCrossReferenceLabel não é removida.
export function getMockEmail(emailId: string) {
  return emails.find((e) => e.id === emailId) ?? null;
}

// Retorna somente os profiles visíveis sob RLS ao usuário autenticado
// (ele mesmo + colegas de projeto) — NÃO representa "todos os usuários
// da AXION". Um diretório corporativo global exigiria desenho próprio
// de autorização/RLS, não este caminho.
export async function getUsers() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data as UserRow[]).map(mapUserRow);
}

export async function getUser(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") {
      return null;
    }
    throw new Error(`Falha ao carregar usuário: ${error.message}`);
  }

  return data ? mapUserRow(data as UserRow) : null;
}

export async function getProjectMembers(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("project_memberships")
    .select(`project_id, user_id, permission, status, area, created_at, profiles(${PROFILE_COLUMNS})`)
    .eq("project_id", projectId);

  if (error) {
    throw error;
  }

  return (data as MembershipWithProfileRow[]).map(mapMembershipRow);
}

export async function getAuditLog(projectId: string) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("audit_log_entries")
    .select(
      "id, project_id, occurred_at, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail"
    )
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }

    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    timestamp: row.occurred_at,

    actor:
      row.actor_type === "SYSTEM"
        ? "sistema"
        : row.actor_user_id ?? row.actor_label ?? "desconhecido",

    actorType: row.actor_type,
    actorLabel: row.actor_label,

    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail,
  }));
}

export async function getContractChanges(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_changes")
    .select(CONTRACT_CHANGE_COLUMNS)
    .eq("project_id", projectId)
    .order("identified_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as ContractChangeRow[]).map(mapContractChangeRow);
}

export async function getContractChange(contractChangeId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contract_changes")
    .select(CONTRACT_CHANGE_COLUMNS)
    .eq("id", contractChangeId)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") {
      return null;
    }
    throw error;
  }

  return data ? mapContractChangeRow(data as ContractChangeRow) : null;
}

export async function getActionRequests(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("action_requests")
    .select(ACTION_REQUEST_COLUMNS)
    .eq("project_id", projectId)
    .order("requested_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as ActionRequestRow[]).map(mapActionRequestRow);
}

export async function getActionRequest(actionRequestId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("action_requests")
    .select(ACTION_REQUEST_COLUMNS)
    .eq("id", actionRequestId)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") {
      return null;
    }
    throw error;
  }

  return data ? mapActionRequestRow(data as ActionRequestRow) : null;
}

export async function getActionRequestAssignees(actionRequestId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("action_request_assignees")
    .select(ACTION_REQUEST_ASSIGNEE_COLUMNS)
    .eq("action_request_id", actionRequestId)
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as ActionRequestAssigneeRow[]).map(mapActionRequestAssigneeRow);
}

export async function getActionRequestResponses(actionRequestId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("action_request_responses")
    .select(ACTION_REQUEST_RESPONSE_COLUMNS)
    .eq("action_request_id", actionRequestId)
    .order("responded_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as ActionRequestResponseRow[]).map(mapActionRequestResponseRow);
}

export async function getNotificationsForActionRequest(actionRequestId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("action_request_id", actionRequestId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as NotificationRow[]).map(mapNotificationRow);
}

export async function getNotifications(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as NotificationRow[]).map(mapNotificationRow);
}

export async function getNotification(notificationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("id", notificationId)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") {
      return null;
    }
    throw error;
  }

  return data ? mapNotificationRow(data as NotificationRow) : null;
}

export async function getNotificationRecipients(notificationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .select(NOTIFICATION_RECIPIENT_COLUMNS)
    .eq("notification_id", notificationId)
    .order("created_at", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as NotificationRecipientRow[]).map(mapNotificationRecipientRow);
}

export async function getNotificationEmailDeliveries(notificationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notification_email_deliveries")
    .select(NOTIFICATION_EMAIL_DELIVERY_COLUMNS)
    .eq("notification_id", notificationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }
    throw error;
  }

  return (data as NotificationEmailDeliveryRow[]).map(mapNotificationEmailDeliveryRow);
}

export function getSourceDefinitions() {
  return sourceDefinitions;
}

export async function getIntegrationConfigs(projectId: string) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("project_integrations")
    .select(
      "source_type, status, last_sync_at, detail, external_system_reference, external_project_reference, account_reference, folder_reference, file_reference, responsible_reference, drive_type"
    )
    .eq("project_id", projectId)
    .order("source_type", { ascending: true });

  if (error) {
    if (error.code === "22P02") {
      return [];
    }

    throw error;
  }

  return data.map((row) => ({
    sourceType: row.source_type,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    detail: row.detail,
    externalSystemReference: row.external_system_reference,
    externalProjectReference: row.external_project_reference,
    accountReference: row.account_reference,
    folderReference: row.folder_reference,
    fileReference: row.file_reference,
    responsibleReference: row.responsible_reference,
    driveType: row.drive_type,
  }));
}

/**
 * Resolve uma referência cruzada de evento para um rótulo legível e uma rota,
 * quando aplicável. LEGADO: órfã desde que Event Ledger/CrossReferenceList
 * passaram a resolver referências reais de forma assíncrona (getDocument/
 * getClause/getScheduleActivity/getEmail). Nenhum consumidor real deveria
 * chamar esta função — mantida apenas por não haver decisão de remoção ainda.
 */
export function resolveCrossReferenceLabel(refType: string, refId: string): string {
  switch (refType) {
    case "DOCUMENT":
      // getDocument agora é real/async; esta função legada usa a seam mock.
      return getMockDocument(refId)?.title ?? refId;
    case "CLAUSE": {
      // getClause agora é real/async; esta função legada usa a seam mock.
      const clause = getMockClause(refId);
      return clause ? `Cláusula ${clause.clauseNumber} — ${clause.title}` : refId;
    }
    case "SCHEDULE_ACTIVITY":
      // getScheduleActivity agora é real/async; esta função legada usa a seam mock.
      return getMockScheduleActivity(refId)?.name ?? refId;
    case "EMAIL":
      // getEmail agora é real/async; esta função legada usa a seam mock.
      return getMockEmail(refId)?.subject ?? refId;
    default:
      return refId;
  }
}
