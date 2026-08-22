// Contexto somente-leitura montado a partir do próprio projeto para
// alimentar um AI Expert. Nunca contém conhecimento geral do modelo —
// apenas dados recuperados das fontes autorizadas (contract_events,
// event_evidence, clauses, documents, event_clause_confrontation_candidates,
// emails). Ver build-event-context.ts.

export interface ContextEvent {
  id: string;
  projectId: string;
  title: string;
  description: string;
  occurredAt: string;
  sourceType: string;
  status: string;
}

export interface ContextEvidence {
  id: string;
  sourceType: string;
  label: string;
  locator: string;
  emailId: string | null;
  documentVersionId: string | null;
}

export interface ContextClause {
  id: string;
  clauseNumber: string;
  title: string;
  text: string;
  documentId: string;
  documentKind: string;
  documentTitle: string;
  /** Por que esta cláusula está no contexto: já confrontada (cross-reference) ou candidata pendente/decidida. */
  relation: "CROSS_REFERENCE" | "CONFRONTATION_CANDIDATE";
}

export interface ContextEmail {
  id: string;
  subject: string;
  snippet: string;
  sentAt: string;
  fromAddress: string;
  toAddress: string;
}

export interface ContextConfrontationCandidate {
  id: string;
  clauseId: string;
  status: string;
  findingType: string;
  severity: string;
  confidence: number;
  summary: string;
  eventBasis: string;
  clauseBasis: string;
}

/**
 * Contexto pronto para um AI Expert analisar um evento. Somente leitura —
 * montá-lo nunca cria, altera ou apaga nada no projeto.
 */
export interface EventAnalysisContext {
  projectId: string;
  eventId: string;
  /** Presente somente quando o contexto foi restringido a um único candidato. */
  focusCandidateId: string | null;
  event: ContextEvent;
  evidence: ContextEvidence[];
  relatedClauses: ContextClause[];
  relatedEmails: ContextEmail[];
  confrontationCandidates: ContextConfrontationCandidate[];
}
