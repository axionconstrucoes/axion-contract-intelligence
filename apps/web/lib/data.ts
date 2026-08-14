// Ponto único de acesso a dados. Nesta fase lê de @axion/mock-data;
// na fase 2 estas funções passam a consultar API/banco reais.
import {
  alerts,
  auditLog,
  clauses,
  documents,
  emails,
  events,
  integrationConfigs,
  projectMemberships,
  projects,
  scheduleActivities,
  sourceDefinitions,
  users,
} from "@axion/mock-data";

export function getProjects() {
  return projects;
}

export function getProject(projectId: string) {
  return projects.find((p) => p.id === projectId) ?? null;
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

export function getUsers() {
  return users;
}

export function getUser(userId: string) {
  return users.find((u) => u.id === userId) ?? null;
}

export function getProjectMembers(projectId: string) {
  return projectMemberships
    .filter((m) => m.projectId === projectId)
    .map((m) => ({ ...m, user: getUser(m.userId) }))
    .filter((m) => m.user !== null);
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
