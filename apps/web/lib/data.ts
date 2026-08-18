// Ponto único de acesso a dados. getProjects()/getProject()/getUsers()/
// getUser()/getProjectMembers()/getDocuments()/getDocument() já consultam
// o Supabase real; as demais funções ainda lêem de @axion/mock-data
// enquanto seus módulos correspondentes não são migrados.
import {
  alerts,
  auditLog,
  clauses,
  documents,
  emails,
  events,
  integrationConfigs,
  scheduleActivities,
  sourceDefinitions,
} from "@axion/mock-data";
import { createSupabaseServerClient } from "@axion/db/server";
import { mapClauseRow, type ClauseRow, type ClauseVersionParent } from "./clause-mapper";
import {
  mapDocumentWithVersion,
  pickCurrentVersion,
  type DocumentRow,
  type DocumentVersionRow,
} from "./document-mapper";
import { mapProjectRow, type ProjectRow } from "./project-mapper";
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

export function getEvents(projectId: string) {
  return events
    .filter((e) => e.projectId === projectId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getEvent(eventId: string) {
  return events.find((e) => e.id === eventId) ?? null;
}

export function getAlerts(projectId: string) {
  return alerts
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    throw documentError;
  }

  if (!documentRow) {
    return null;
  }

  const { data: versionRows, error: versionsError } = await supabase
    .from("document_versions")
    .select(DOCUMENT_VERSION_COLUMNS)
    .eq("document_id", (documentRow as DocumentRow).id);

  if (versionsError) {
    throw versionsError;
  }

  return mapDocumentWithVersion(
    documentRow as DocumentRow,
    pickCurrentVersion(versionRows as DocumentVersionRow[])
  );
}

// TEMPORARY MOCK SEAM: remove when Event Ledger / EvidenceRef migrate to
// real document UUIDs. EvidenceRef/ContractEvent hoje referenciam IDs mock
// (ex.: "doc-arena-contrato"), que não correspondem aos UUIDs reais de
// `documents` no Supabase — não fazer tradução runtime entre os dois.
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

  return (clauseRows as ClauseRow[]).map((row) =>
    mapClauseRow(row, parentByVersionId.get(row.document_version_id))
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
    throw clauseError;
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
    throw versionError;
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
    throw documentError;
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

// TEMPORARY MOCK SEAM: remove when Event Ledger / CrossReference migrate to
// real clause UUIDs. CrossReference (refType "CLAUSE") ainda referencia IDs
// mock (ex.: "cls-arena-01"), que não correspondem às UUIDs reais de
// `clauses` no Supabase — não fazer tradução runtime entre os dois.
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
    throw activityError;
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
    throw scheduleVersionError;
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
    throw documentVersionError;
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
    throw documentError;
  }

  if (!documentRow) {
    throw new Error(
      `Inconsistência estrutural: schedule_activity (id=${activityId}) → document_version (id=${documentVersion.id}) → document (id=${documentVersion.document_id}) não encontrado.`
    );
  }

  const document = documentRow as { id: string; project_id: string };

  return mapScheduleActivityRow(row, { projectId: document.project_id });
}

// TEMPORARY MOCK SEAM: remove when Event Ledger / CrossReference migrate to
// real schedule activity UUIDs. CrossReference (refType "SCHEDULE_ACTIVITY")
// ainda referencia IDs mock (ex.: "sch-arena-01"), que não correspondem às
// UUIDs reais de `schedule_activities` no Supabase — não fazer tradução
// runtime entre os dois.
export function getMockScheduleActivity(activityId: string) {
  return scheduleActivities.find((s) => s.id === activityId) ?? null;
}

export function getEmails(projectId: string) {
  return emails.filter((e) => e.projectId === projectId);
}

export function getEmail(emailId: string) {
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
    throw error;
  }

  return data ? mapUserRow(data as UserRow) : null;
}

export async function getProjectMembers(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("project_memberships")
    .select(`project_id, user_id, permission, profiles(${PROFILE_COLUMNS})`)
    .eq("project_id", projectId);

  if (error) {
    throw error;
  }

  return (data as MembershipWithProfileRow[]).map(mapMembershipRow);
}

export function getAuditLog(projectId: string) {
  return auditLog
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getSourceDefinitions() {
  return sourceDefinitions;
}

export function getIntegrationConfigs() {
  return integrationConfigs;
}

/** Resolve uma referência cruzada de evento para um rótulo legível e uma rota, quando aplicável. */
export function resolveCrossReferenceLabel(refType: string, refId: string): string {
  switch (refType) {
    case "DOCUMENT":
      // Event Ledger/CrossReference ainda são mock (IDs tipo "doc-arena-contrato"),
      // por isso usa a seam mock, não o getDocument real (ver getMockDocument acima).
      return getMockDocument(refId)?.title ?? refId;
    case "CLAUSE": {
      // Event Ledger/CrossReference ainda são mock (IDs tipo "cls-arena-01"),
      // por isso usa a seam mock, não o getClause real (ver getMockClause acima).
      const clause = getMockClause(refId);
      return clause ? `Cláusula ${clause.clauseNumber} — ${clause.title}` : refId;
    }
    case "SCHEDULE_ACTIVITY":
      // Event Ledger/CrossReference ainda são mock (IDs tipo "sch-arena-01"),
      // por isso usa a seam mock, não o getScheduleActivity real (ver getMockScheduleActivity acima).
      return getMockScheduleActivity(refId)?.name ?? refId;
    case "EMAIL":
      return getEmail(refId)?.subject ?? refId;
    default:
      return refId;
  }
}
