// Modelo de domínio compartilhado do AXION CONTRACT INTELLIGENCE.
// Consumido por apps/web (e futuramente por apps/api na fase 2).

export type SourceType =
  | "EMAIL"
  | "DIARIO_OBRA"
  | "CONSTRUMANAGER"
  | "CONTRATO"
  | "GOOGLE_DRIVE"
  | "RECEBIDOS_CLIENTE"
  | "EDITAL_RFI_RFP"
  | "CRONOGRAMA"
  | "RELATORIO_SEMANAL"
  | "ERP"
  | "ORCAMENTO";

export interface SourceDefinition {
  type: SourceType;
  label: string;
  description: string;
}

export type ImplicationCategory =
  | "PRAZO"
  | "CUSTO"
  | "ESCOPO"
  | "MULTAS"
  | "PENALIDADES"
  | "MEDICOES"
  | "PAGAMENTOS"
  | "RESPONSABILIDADES"
  | "ALTERACOES_PROJETO"
  | "NOTIFICACOES"
  | "CLAIMS_CHANGE_ORDERS";

export type ProjectStatus = "ATIVO" | "SUSPENSO" | "ENCERRADO";

export interface Project {
  id: string;
  name: string;
  client: string;
  status: ProjectStatus;
  location: string;
  contractNumber: string | null;
  startDate: string; // ISO date
  baselineEndDate: string; // ISO date
}

export type UserOrigin = "AXION_INTERNO" | "TERCEIRO";

export interface User {
  id: string;
  name: string;
  email: string;
  origin: UserOrigin;
  title: string | null;
  avatarInitials: string;
}

export type ProjectPermission = "VIEWER" | "EDITOR" | "ADMIN";

export interface ProjectMembership {
  userId: string;
  projectId: string;
  permission: ProjectPermission;
}

export type DocumentKind =
  | "CONTRATO_BASE"
  | "ADITIVO"
  | "EDITAL"
  | "RFI"
  | "RFP"
  | "ESPECIFICACAO"
  | "DESENHO"
  | "PLANILHA"
  | "CRONOGRAMA_BASELINE"
  | "CRONOGRAMA_REVISAO"
  | "RELATORIO_SEMANAL"
  | "PROPOSTA_AXION"
  | "CLARIFICACAO_CLIENTE";

export interface Document {
  id: string;
  projectId: string;
  kind: DocumentKind;
  title: string;
  sourceType: SourceType;
  version: string;
  date: string; // ISO date
  author: string;
  summary: string;
}

/** Referência à evidência original de um evento (preserva rastreabilidade até a fonte). */
export interface EvidenceRef {
  sourceType: SourceType;
  label: string;
  locator: string; // ex: "Gmail > Assunto: ..." ou "Diário de Obra #123" ou "Construmanager > Revisão R04"
  documentId?: string;
  emailId?: string;
}

export type CrossReferenceKind =
  | "CONTRATO_ADITIVO"
  | "EDITAL_RFI_RFP"
  | "PROPOSTA_AXION"
  | "CRONOGRAMA"
  | "PROJETO_TECNICO"
  | "COMUNICACAO";

export type CrossReferenceType = "DOCUMENT" | "CLAUSE" | "SCHEDULE_ACTIVITY" | "EMAIL";

/** Liga um evento a uma referência confrontável: documento, cláusula, atividade de cronograma ou e-mail. */
export interface CrossReference {
  kind: CrossReferenceKind;
  refType: CrossReferenceType;
  refId: string;
  note: string;
}

/** Cláusula específica de um contrato/aditivo, usada para confronto direto no Event Ledger. */
export interface ContractClause {
  id: string;
  projectId: string;
  documentId: string;
  clauseNumber: string;
  title: string;
  text: string;
}

export type ScheduleActivityStatus = "NO_PRAZO" | "ATRASADA" | "CONCLUIDA";

/** Atividade do cronograma (baseline x atual), usada para confronto de prazo no Event Ledger. */
export interface ScheduleActivity {
  id: string;
  projectId: string;
  name: string;
  baselineStart: string;
  baselineEnd: string;
  currentStart: string;
  currentEnd: string;
  status: ScheduleActivityStatus;
}

/** E-mail fictício usado como evidência original de eventos com sourceType EMAIL. */
export interface Email {
  id: string;
  projectId: string;
  from: string;
  to: string;
  subject: string;
  date: string; // ISO datetime
  snippet: string;
}

export type AiFindingType =
  | "DESVIO"
  | "CONFLITO"
  | "INFORMACAO_NOVA"
  | "IMPACTO_POTENCIAL";

export type AlertSeverity = "BAIXA" | "MEDIA" | "ALTA" | "CRITICA";

/**
 * Achado da IA sobre um evento. Sempre uma sugestão para revisão humana —
 * o sistema nunca decide, apenas aponta possíveis implicações contratuais.
 */
export interface AiAssessment {
  findingType: AiFindingType;
  severity: AlertSeverity;
  summary: string;
  confidence: number; // 0-1
  requiresHumanReview: true;
}

export type EventStatus = "NOVO" | "EM_ANALISE" | "CONFRONTADO" | "RESOLVIDO";

/** Entrada do Event Ledger: um evento relevante correlacionado a possíveis implicações contratuais. */
export interface ContractEvent {
  id: string;
  projectId: string;
  timestamp: string; // ISO datetime
  title: string;
  description: string;
  sourceType: SourceType;
  evidence: EvidenceRef;
  categories: ImplicationCategory[];
  status: EventStatus;
  crossReferences: CrossReference[];
  aiAssessment: AiAssessment | null;
  createdBy: string; // userId ou "sistema"
}

export interface Alert {
  id: string;
  projectId: string;
  eventId: string;
  severity: AlertSeverity;
  category: ImplicationCategory;
  title: string;
  description: string;
  createdAt: string; // ISO datetime
  acknowledged: boolean;
}

export type IntegrationStatus = "CONECTADO" | "PENDENTE" | "ERRO";

export interface IntegrationConfig {
  sourceType: SourceType;
  status: IntegrationStatus;
  lastSyncAt: string | null; // ISO datetime
  detail: string;
}

export interface AuditLogEntry {
  id: string;
  projectId: string;
  timestamp: string; // ISO datetime
  actor: string; // userId ou "sistema"
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
}
