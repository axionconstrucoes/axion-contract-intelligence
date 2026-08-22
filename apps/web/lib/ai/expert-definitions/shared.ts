// Catálogos compartilhados entre Experts — evita duplicar a mesma fonte/
// regra em cinco lugares. Puro, sem I/O.

import type { AuthorizedSourceRef, ExpertCollaborationRule, ExpertEscalationRule, OfficialExpertId } from "./types";

// ============================================================
// Seção 9 do requisito — catálogo formal de fontes.
// Cruzado com o que já foi mapeado em docs/ai/experts.md, seção 18 —
// nunca reafirmado de memória, sempre a mesma fonte de verdade.
// ============================================================

export const SOURCE_CONTRACT_EVENTS: AuthorizedSourceRef = {
  sourceId: "contract_events",
  label: "Event Ledger (eventos contratuais)",
  status: "AVAILABLE",
  note: "Já consumido pelo context builder (build-event-context.ts/build-project-context.ts).",
};
export const SOURCE_EVENT_EVIDENCE: AuthorizedSourceRef = {
  sourceId: "event_evidence",
  label: "Evidências vinculadas a um evento",
  status: "AVAILABLE",
  note: "Já consumido pelo context builder.",
};
export const SOURCE_EVENT_NOTES: AuthorizedSourceRef = {
  sourceId: "event_notes",
  label: "Anotações do Evento (informação declarada, nunca fato documental)",
  status: "AVAILABLE",
  note: "Já consumido como ContextEventNote (sourceType=USER_NOTE, evidentialStatus=DECLARED_CONTEXT).",
};
export const SOURCE_CLAUSES: AuthorizedSourceRef = {
  sourceId: "clauses",
  label: "Cláusulas contratuais",
  status: "AVAILABLE",
  note: "Já consumido via event_clause_confrontation_candidates/event_cross_references.",
};
export const SOURCE_DOCUMENTS: AuthorizedSourceRef = {
  sourceId: "document_versions",
  label: "Contrato, aditivos, anexos, edital, RFI/RFP, propostas e demais documentos do projeto",
  status: "AVAILABLE",
  note: "Já consumido pelo context builder (documento-fonte de cláusulas/evidências).",
};
export const SOURCE_EMAILS: AuthorizedSourceRef = {
  sourceId: "emails",
  label: "E-mails",
  status: "AVAILABLE",
  note: "Já consumido pelo context builder.",
};
export const SOURCE_TIMELINE: AuthorizedSourceRef = {
  sourceId: "timeline_export",
  label: "Timeline Contratual/Jurídico",
  status: "AVAILABLE",
  note: "Implementado (docs/timeline-export.md) — ainda não conectado como fonte de contexto de um Expert, mas real e consultável.",
};
export const SOURCE_ESG_OBLIGATIONS: AuthorizedSourceRef = {
  sourceId: "esg_obligations",
  label: "Obrigações ESG/SSMA contratuais",
  status: "AVAILABLE",
  note: "Implementado (docs/esg-obligations.md); já consumido por ProjectAnalysisContext.esgObligations.",
};
export const SOURCE_ESG_EVIDENCE: AuthorizedSourceRef = {
  sourceId: "esg_obligation_evidence",
  label: "Evidências de comprovação ESG/SSMA (fotos, DDS, documentos)",
  status: "AVAILABLE",
  note: "Implementado — contagem já resumida em ContextEsgObligationSummary.latestSubmissionEvidenceCount.",
};
export const SOURCE_SCHEDULE_ACTIVITIES: AuthorizedSourceRef = {
  sourceId: "schedule_activities",
  label: "Cronograma (atividades, baseline x atual)",
  status: "AVAILABLE",
  note: "Tabela real, consumida em apps/web/lib/data.ts — ainda não incluída no context builder de nenhum Expert.",
};
export const SOURCE_CONTRACT_CHANGES: AuthorizedSourceRef = {
  sourceId: "contract_changes",
  label: "Change Orders / alterações contratuais",
  status: "AVAILABLE",
  note: "Tabela real (contract_changes) — ainda não conectada ao context builder de nenhum Expert.",
};
export const SOURCE_SLA_ACTIONS: AuthorizedSourceRef = {
  sourceId: "sla_actions",
  label: "Ações e Escalonamentos (risco, status, nível de escalonamento)",
  status: "AVAILABLE",
  note: "Implementado (docs/sla-escalation.md) — fonte principal do futuro CEO IA (seção 14 do requisito).",
};
export const SOURCE_LEGAL_CORPUS: AuthorizedSourceRef = {
  sourceId: "legal_sources",
  label: "Fontes legais oficiais (ex.: Código Civil brasileiro)",
  status: "FUTURE_SOURCE",
  note: "Nenhum corpus normativo está versionado/ingerido — ver apps/web/lib/ai/legal/types.ts. baseLegal sempre [] até existir.",
};
export const SOURCE_MEETING_MINUTES: AuthorizedSourceRef = {
  sourceId: "meeting_minutes",
  label: "Atas de reunião",
  status: "FUTURE_SOURCE",
  note: "Sem tabela dedicada — hoje só existiriam como Document/e-mail genérico, sem estrutura própria.",
};
export const SOURCE_DIARIO_OBRA: AuthorizedSourceRef = {
  sourceId: "diario_obra",
  label: "Diário de Obra",
  status: "FUTURE_SOURCE",
  note: "SourceType inclui DIARIO_OBRA, mas não há ingestão/tabela própria implementada.",
};
export const SOURCE_CONSTRUMANAGER: AuthorizedSourceRef = {
  sourceId: "construmanager",
  label: "Construmanager",
  status: "FUTURE_SOURCE",
  note: "SourceType inclui CONSTRUMANAGER, sem integração real implementada.",
};
export const SOURCE_WEEKLY_REPORTS: AuthorizedSourceRef = {
  sourceId: "relatorios_semanais",
  label: "Relatórios semanais",
  status: "FUTURE_SOURCE",
  note: "DocumentKind inclui RELATORIO_SEMANAL, sem estrutura própria além de documento genérico.",
};
export const SOURCE_FORMAL_NOTIFICATIONS: AuthorizedSourceRef = {
  sourceId: "formal_notifications",
  label: "Notificações e respostas a notificações formais",
  status: "FUTURE_SOURCE",
  note: "Não modeladas como entidade própria, distinta de Email/ActionRequest.",
};

export const SHARED_SOURCE_CATALOG: AuthorizedSourceRef[] = [
  SOURCE_CONTRACT_EVENTS,
  SOURCE_EVENT_EVIDENCE,
  SOURCE_EVENT_NOTES,
  SOURCE_CLAUSES,
  SOURCE_DOCUMENTS,
  SOURCE_EMAILS,
  SOURCE_TIMELINE,
  SOURCE_ESG_OBLIGATIONS,
  SOURCE_ESG_EVIDENCE,
  SOURCE_SCHEDULE_ACTIVITIES,
  SOURCE_CONTRACT_CHANGES,
  SOURCE_SLA_ACTIONS,
  SOURCE_LEGAL_CORPUS,
  SOURCE_MEETING_MINUTES,
  SOURCE_DIARIO_OBRA,
  SOURCE_CONSTRUMANAGER,
  SOURCE_WEEKLY_REPORTS,
  SOURCE_FORMAL_NOTIFICATIONS,
];

// ============================================================
// Seção 13 do requisito — situações que exigem "DECISÃO HUMANA
// NECESSÁRIA". Núcleo comum a todos os Experts; cada definição pode
// adicionar situações específicas.
// ============================================================

export const CORE_ESCALATION_RULES: ExpertEscalationRule[] = [
  { situation: "Informação insuficiente para concluir", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Conflito entre documentos/fontes", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Valor econômico não disponível nas fontes", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Decisão que gera obrigação para a AXION", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Concessão comercial", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Envio de qualquer comunicação", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Interpretação jurídica crítica", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Risco classificado como ALTO ou CRÍTICO", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
  { situation: "Ação já escalada à Diretoria (ver Matriz de SLA)", requiredDeclaration: "DECISÃO HUMANA NECESSÁRIA" },
];

// ============================================================
// Seção 12 do requisito — TEMA → EXPERT PRINCIPAL → EXPERTS AUXILIARES.
// Matriz mestre única; cada ExpertDefinition só referencia as linhas em
// que participa (ver getCollaborationRulesForExpert em definitions.ts).
// ============================================================

export const EXPERT_COLLABORATION_MATRIX: ExpertCollaborationRule[] = [
  {
    topic: "NEGOCIAÇÃO",
    primaryExpertId: "commercial-director",
    supportingExpertIds: ["legal-consultant"],
    condition: "quando houver risco legal",
  },
  {
    topic: "DISPUTA",
    primaryExpertId: "legal-consultant",
    supportingExpertIds: ["commercial-director", "planning-director"],
    condition: "Diretor de Planejamento IA quando houver prazo envolvido",
  },
  {
    topic: "ATRASO COM MULTA",
    primaryExpertId: "planning-director",
    supportingExpertIds: ["legal-consultant", "commercial-director"],
    condition: null,
  },
  {
    topic: "SSMA COM PENALIDADE",
    primaryExpertId: "esg-director",
    supportingExpertIds: ["legal-consultant"],
    condition: null,
  },
  {
    topic: "DECISÃO EXECUTIVA",
    primaryExpertId: "ceo",
    supportingExpertIds: ["commercial-director", "legal-consultant", "planning-director", "esg-director"],
    condition: "consulta somente os Experts necessários ao tema da decisão",
  },
];

export function getCollaborationRulesForExpert(expertId: OfficialExpertId): ExpertCollaborationRule[] {
  return EXPERT_COLLABORATION_MATRIX.filter(
    (rule) => rule.primaryExpertId === expertId || rule.supportingExpertIds.includes(expertId)
  );
}
