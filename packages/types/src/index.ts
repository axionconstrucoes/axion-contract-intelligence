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
  | "ORCAMENTO"
  | "ESG_SSMA";

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
  code: string;
  name: string;
  client: string;
  status: ProjectStatus;
  location: string;
  contractNumber: string | null;
  startDate: string; // ISO date
  baselineEndDate: string; // ISO date
}

// package_type e texto livre — a taxonomia real de tipos de pacote ainda
// nao foi definida, entao nao fixamos um union aqui (mesma decisao da
// migration 20260821142906).
export interface ProjectPackage {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description: string | null;
  packageType: string;
  status: ProjectStatus;
  createdAt: string; // ISO datetime
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

// 4 papéis reais do ACC (migration 20260824090000 — "Fechamento do
// módulo Usuários e Permissões"). ADMINISTRADOR = leitura + escrita/
// administração; GESTOR/COLABORADOR/LEITURA = somente leitura
// (migration 20260824232516 — enforce_admin_only_write).
export type ProjectPermission = "ADMINISTRADOR" | "GESTOR" | "COLABORADOR" | "LEITURA";

export type MembershipStatus = "ACTIVE" | "INACTIVE";

// Valores exatos do CHECK constraint de project_memberships.area
// (migration 20260824090000) — inclui acentos, nunca normalizar.
export type MembershipArea =
  | "DIRETORIA"
  | "ADMINISTRATIVO"
  | "COMERCIAL"
  | "FINANCEIRO"
  | "ENGENHARIA"
  | "ORÇAMENTO"
  | "JURÍDICO"
  | "PLANEJAMENTO";

export interface ProjectMembership {
  userId: string;
  status: MembershipStatus;
  area: MembershipArea | null;
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

/** Revisão de um Project Document. Um Document sempre tem >= 1 versão. */
export interface DocumentVersion {
  id: string;
  documentId: string;
  versionLabel: string;
  versionIndex: number;
  documentDate: string; // ISO date
  sourceType: SourceType;
  author: string;
  summary: string;
  filePath: string | null;
  uploadedBy: string | null;
  uploadedAt: string; // ISO datetime
  notes: string | null;
}

/** Referência à evidência original de um evento (preserva rastreabilidade até a fonte). */
export interface EvidenceRef {
  id?: string;
  sourceType: SourceType;
  label: string;
  locator: string; // ex: "Gmail > Assunto: ..." ou "Diário de Obra #123" ou "Construmanager > Revisão R04"
  documentId?: string;
  documentVersionId?: string;
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
  evidence: EvidenceRef[];
  categories: ImplicationCategory[];
  status: EventStatus;
  crossReferences: CrossReference[];
  aiAssessment: AiAssessment | null;
  createdBy: string; // userId, "sistema" ou label de autoria histórica (LEGACY)
  createdByType?: "SYSTEM" | "USER" | "LEGACY";
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

export type IntegrationStatus = "CONECTADO" | "PENDENTE" | "ATENCAO" | "ERRO";

export type DriveType = "MEU_DRIVE" | "DRIVE_COMPARTILHADO" | "PASTA_COMPARTILHADA";

export interface IntegrationConfig {
  sourceType: SourceType;
  status: IntegrationStatus;
  lastSyncAt: string | null; // ISO datetime
  detail: string;
  // Origem da fonte — sempre preenchida por humano, nunca inferida.
  // null/ausente => "Origem ainda não definida" na UI.
  externalSystemReference: string | null;
  externalProjectReference: string | null;
  accountReference: string | null;
  folderReference: string | null;
  fileReference: string | null;
  responsibleReference: string | null;
  driveType: DriveType | null;
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

export type ContractChangeStatus = "OPEN" | "CLOSED" | "CANCELLED";

/** Estado de formalização da alteração perante o cliente — mesmo conjunto usado em ScheduleVersion, nunca um sexto estado. */
export type ClientFormalizationStatus =
  | "NOT_SUBMITTED"
  | "PENDING"
  | "FORMALIZED"
  | "REJECTED"
  | "UNCLEAR";

/** Impacto técnico de prazo, distinto de entitlement contratual à extensão (não modelado ainda). */
export type ScheduleImpactStatus =
  | "PENDING_ASSESSMENT"
  | "NO_IMPACT"
  | "ABSORBABLE_WITHIN_CONTRACT_TERM"
  | "EXTENSION_REQUIRED";

export type ContractChangeCreatedByType = "SYSTEM" | "USER" | "LEGACY";

/**
 * Alteração contratual identificada, entidade própria — distinta de
 * aprovação do cliente, aditivo formal, entitlement e claim (ver
 * docs/ai/specialist-framework.md). Relações N:N com ContractEvent e
 * EventEvidence não entram embutidas aqui; serão carregadas separadamente
 * quando houver consumidor real.
 */
export interface ContractChange {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description: string;
  status: ContractChangeStatus;
  identifiedAt: string; // ISO datetime
  createdByType: ContractChangeCreatedByType;
  createdByUserId: string | null;
  createdByLabel: string | null;
  clientFormalizationStatus: ClientFormalizationStatus;
  scheduleImpactStatus: ScheduleImpactStatus;
  technicalAdditionalDays: number | null;
  createdAt: string; // ISO datetime
}

export type ActionRequestStatus = "OPEN" | "CLOSED" | "CANCELLED";

/**
 * Solicitação rastreável para uma ou mais pessoas analisarem, responderem,
 * decidirem ou executarem algo — distinta de Alert (notificação passiva),
 * Email (canal), ContractEvent (fato já ocorrido) e ContractChange (a
 * alteração em si). "Resposta recebida" não fecha a solicitação
 * automaticamente — isso é derivável de ActionRequestResponse, nunca um
 * status próprio. Assignees e responses não entram embutidos aqui; serão
 * carregados separadamente quando houver consumidor real.
 */
export interface ActionRequest {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: ActionRequestStatus;
  requestedAt: string; // ISO datetime
  dueAt: string | null; // ISO datetime
  closedAt: string | null; // ISO datetime
  createdByType: "SYSTEM" | "USER" | "LEGACY";
  createdByUserId: string | null;
  createdByLabel: string | null;
  createdAt: string; // ISO datetime
}

/** Vínculo entre um ActionRequest e um profile responsável — membro real do mesmo projeto. */
export interface ActionRequestAssignee {
  actionRequestId: string;
  projectId: string;
  userId: string;
  createdAt: string; // ISO datetime
}

export type ActionRequestResponseChannel = "APP" | "EMAIL";

/**
 * Resposta a um ActionRequest, fato separado e independente — nunca coluna
 * única no ActionRequest, suportando múltiplas respostas de pessoas
 * diferentes. Conteúdo original (content) nunca é interpretação de IA. O
 * corpo de uma resposta por email permanece em Email; aqui há apenas a
 * referência (emailId), nunca cópia.
 */
export interface ActionRequestResponse {
  id: string;
  actionRequestId: string;
  projectId: string;
  channel: ActionRequestResponseChannel;
  responderUserId: string | null;
  emailId: string | null;
  content: string | null;
  respondedAt: string; // ISO datetime
  createdAt: string; // ISO datetime
}

export type NotificationKind = "INITIAL" | "REMINDER" | "ESCALATION";

export type NotificationStatus = "PENDING" | "SENT" | "CANCELLED";

/**
 * Registro de como o sistema comunica um ActionRequest (inicial, lembrete,
 * escalonamento) — distinto do próprio ActionRequest (o que precisa ser
 * feito) e de Email (a mensagem efetivamente enviada/recebida). Um lembrete
 * nunca cria um novo ActionRequest. Falha de entrega pertence ao delivery
 * (NotificationEmailDelivery), nunca a esta entidade abstrata.
 */
export interface Notification {
  id: string;
  projectId: string;
  actionRequestId: string;
  kind: NotificationKind;
  status: NotificationStatus;
  subject: string;
  body: string;
  createdByType: "SYSTEM" | "USER" | "LEGACY";
  createdByUserId: string | null;
  createdByLabel: string | null;
  createdAt: string; // ISO datetime
  sentAt: string | null; // ISO datetime
}

export type NotificationRecipientType = "USER" | "EMAIL";

/**
 * Destinatário de uma Notification. Quando recipientType é EMAIL,
 * recipientEmail é somente um endereço de destino — nunca cadastro de
 * contato externo, nunca concede acesso ao projeto.
 */
export interface NotificationRecipient {
  notificationId: string;
  projectId: string;
  recipientType: NotificationRecipientType;
  recipientUserId: string | null;
  recipientEmail: string | null;
  createdAt: string; // ISO datetime
}

export type EmailDeliveryDirection = "OUTBOUND" | "INBOUND";

export type EmailDeliveryStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "RECEIVED"
  | "FAILED"
  | "BOUNCED"
  | "IGNORED";

/**
 * Infraestrutura de mensagem — único lugar onde metadata de provider
 * (Gmail/etc.) pode viver futuramente. Nunca duplica o corpo do email
 * (isso permanece em Email via emailId). correlationId é identificador
 * interno estável para correlação futura de reply — nunca prova de
 * identidade/autoridade por si só.
 */
export interface NotificationEmailDelivery {
  id: string;
  notificationId: string;
  projectId: string;
  recipientEmail: string;
  direction: EmailDeliveryDirection;
  status: EmailDeliveryStatus;
  emailId: string | null;
  correlationId: string;
  provider: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  messageIdHeader: string | null;
  replyToDeliveryId: string | null;
  sentAt: string | null; // ISO datetime
  receivedAt: string | null; // ISO datetime
  createdAt: string; // ISO datetime
}
