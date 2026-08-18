// Ponto único de acesso a dados. getProjects()/getProject()/getUsers()/
// getUser()/getProjectMembers() já consultam o Supabase real; as demais
// funções ainda lêem de @axion/mock-data enquanto seus módulos
// correspondentes não são migrados.
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

export function getDocuments(projectId: string) {
  return documents.filter((d) => d.projectId === projectId);
}

export function getDocument(documentId: string) {
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
      return getDocument(refId)?.title ?? refId;
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
