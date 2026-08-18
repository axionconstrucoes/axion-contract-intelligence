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
import {
  mapDocumentWithVersion,
  pickCurrentVersion,
  type DocumentRow,
  type DocumentVersionRow,
} from "./document-mapper";
import { mapProjectRow, type ProjectRow } from "./project-mapper";
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

export function getClauses(projectId: string) {
  return clauses.filter((c) => c.projectId === projectId);
}

export function getClause(clauseId: string) {
  return clauses.find((c) => c.id === clauseId) ?? null;
}

export function getScheduleActivities(projectId: string) {
  return scheduleActivities.filter((s) => s.projectId === projectId);
}

export function getScheduleActivity(id: string) {
  return scheduleActivities.find((s) => s.id === id) ?? null;
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
      const clause = getClause(refId);
      return clause ? `Cláusula ${clause.clauseNumber} — ${clause.title}` : refId;
    }
    case "SCHEDULE_ACTIVITY":
      return getScheduleActivity(refId)?.name ?? refId;
    case "EMAIL":
      return getEmail(refId)?.subject ?? refId;
    default:
      return refId;
  }
}
