import type {
  ActionRequestStatus,
  AiFindingType,
  AlertSeverity,
  DocumentKind,
  DriveType,
  EventStatus,
  ImplicationCategory,
  IntegrationStatus,
  MembershipArea,
  MembershipStatus,
  ProjectPermission,
  ScheduleActivityStatus,
  SourceType,
  UserOrigin,
} from "@axion/types";
import type {
  SlaArea,
  SlaActionOrigin,
  SlaActionStatus,
  SlaEscalationLevel,
  SlaEscalationReason,
  SlaTimeUnit,
} from "@/lib/sla/types";
import type { MemberInvitationStatus } from "@/lib/users/invitation-mapper";
import type {
  AdditionalProposalApprovalStatus,
  AdditionalProposalDocumentalState,
  AdditionalProposalFormalizationType,
  AdditionalProposalLinkRole,
  AdditionalProposalScheduleExtensionStatus,
  AdditionalProposalStatus,
} from "@/lib/additionals/types";

export const categoryLabels: Record<ImplicationCategory, string> = {
  PRAZO: "Prazo",
  CUSTO: "Custo",
  ESCOPO: "Escopo",
  MULTAS: "Multas",
  PENALIDADES: "Penalidades",
  MEDICOES: "Medições",
  PAGAMENTOS: "Pagamentos",
  RESPONSABILIDADES: "Responsabilidades",
  ALTERACOES_PROJETO: "Alterações de Projeto",
  NOTIFICACOES: "Notificações",
  CLAIMS_CHANGE_ORDERS: "Claims / Change Orders",
};

export const eventStatusLabels: Record<EventStatus, string> = {
  NOVO: "Novo",
  EM_ANALISE: "Em Análise",
  CONFRONTADO: "Confrontado",
  RESOLVIDO: "Resolvido",
};

// Padrão visível PT-BR de risco: BAIXO/MÉDIO/ALTO/CRÍTICO — nunca a
// forma feminina ("Alta"/"Crítica") nem HIGH/CRITICAL em interface.
// HIGH/CRITICAL continuam corretos em enums/types/schema/migrations/
// testes técnicos — nunca removidos de lá, só nunca exibidos assim.
export const severityLabels: Record<AlertSeverity, string> = {
  BAIXA: "Baixo",
  MEDIA: "Médio",
  ALTA: "Alto",
  CRITICA: "Crítico",
};

export const findingTypeLabels: Record<AiFindingType, string> = {
  DESVIO: "Desvio",
  CONFLITO: "Conflito",
  INFORMACAO_NOVA: "Informação Nova",
  IMPACTO_POTENCIAL: "Impacto Potencial",
};

export const sourceTypeShortLabels: Record<SourceType, string> = {
  EMAIL: "E-mail",
  DIARIO_OBRA: "Diário de Obra",
  CONSTRUMANAGER: "Construmanager",
  CONTRATO: "Contrato",
  GOOGLE_DRIVE: "Google Drive",
  RECEBIDOS_CLIENTE: "Recebidos Cliente",
  EDITAL_RFI_RFP: "Edital/RFI/RFP",
  CRONOGRAMA: "Cronograma",
  RELATORIO_SEMANAL: "Relatório Semanal",
  ERP: "ERP",
  ORCAMENTO: "Orçamento",
  ESG_SSMA: "ESG/SSMA",
};

// CONECTADO (valor bruto do banco, nome histórico) é exibido como
// "Ativo" — configuração válida + fonte apta a operar (seção 7 do
// requisito de Integrações). ATENCAO é distinto de ERRO: autorização
// expirada/retry/falha não bloqueante, nunca "não consegue operar".
export const integrationStatusLabels: Record<IntegrationStatus, string> = {
  CONECTADO: "Ativo",
  PENDENTE: "Pendente",
  ATENCAO: "Atenção",
  ERRO: "Erro",
};

export const driveTypeLabels: Record<DriveType, string> = {
  MEU_DRIVE: "Meu Drive",
  DRIVE_COMPARTILHADO: "Drive compartilhado",
  PASTA_COMPARTILHADA: "Pasta compartilhada",
};

export const permissionLabels: Record<ProjectPermission, string> = {
  ADMINISTRADOR: "Administrador",
  GESTOR: "Gestor",
  COLABORADOR: "Colaborador",
  LEITURA: "Leitura",
};

export const originLabels: Record<UserOrigin, string> = {
  AXION_INTERNO: "Axion (Interno)",
  TERCEIRO: "Terceiro",
};

export const membershipStatusLabels: Record<MembershipStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
};

export const membershipAreaLabels: Record<MembershipArea, string> = {
  DIRETORIA: "Diretoria",
  ADMINISTRATIVO: "Administrativo",
  COMERCIAL: "Comercial",
  FINANCEIRO: "Financeiro",
  ENGENHARIA: "Engenharia",
  ORÇAMENTO: "Orçamento",
  JURÍDICO: "Jurídico",
  PLANEJAMENTO: "Planejamento",
};

export const memberInvitationStatusLabels: Record<MemberInvitationStatus, string> = {
  PENDING: "Aguardando primeiro login",
  ACTIVATED: "Ativado",
  CANCELLED: "Cancelado",
};

export const scheduleStatusLabels: Record<ScheduleActivityStatus, string> = {
  NO_PRAZO: "No Prazo",
  ATRASADA: "Atrasada",
  CONCLUIDA: "Concluída",
};

export const actionRequestStatusLabels: Record<ActionRequestStatus, string> = {
  OPEN: "Aberta",
  CLOSED: "Encerrada",
  CANCELLED: "Cancelada",
};

export type ConfrontationCandidateSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// event_clause_confrontation_candidates.severity usa termos em inglês
// (constraint do banco), distintos de AlertSeverity (PT-BR). Este mapa
// traduz para reutilizar SeverityBadge sem duplicar a paleta visual.
export const confrontationSeverityToAlertSeverity: Record<ConfrontationCandidateSeverity, AlertSeverity> = {
  LOW: "BAIXA",
  MEDIUM: "MEDIA",
  HIGH: "ALTA",
  CRITICAL: "CRITICA",
};

export type ConfrontationCandidateStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export const confrontationCandidateStatusLabels: Record<ConfrontationCandidateStatus, string> = {
  PENDING_REVIEW: "Pendente de revisão",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
};

export type EventNoteCategory =
  | "CONTEXTO_OPERACIONAL"
  | "INFORMACAO_COMERCIAL"
  | "OBSERVACAO_JURIDICA"
  | "PLANEJAMENTO"
  | "FINANCEIRO"
  | "OUTROS";

export const eventNoteCategoryLabels: Record<EventNoteCategory, string> = {
  CONTEXTO_OPERACIONAL: "Contexto Operacional",
  INFORMACAO_COMERCIAL: "Informação Comercial",
  OBSERVACAO_JURIDICA: "Observação Jurídica",
  PLANEJAMENTO: "Planejamento",
  FINANCEIRO: "Financeiro",
  OUTROS: "Outros",
};

export type EsgObligationCategory =
  | "DDS"
  | "INTEGRACAO_SEGURANCA"
  | "TREINAMENTO"
  | "INSPECAO"
  | "RELATORIO"
  | "DOCUMENTACAO_TERCEIROS"
  | "REGISTRO_ACIDENTE_INCIDENTE"
  | "DESTINACAO_RESIDUOS"
  | "COMPROVANTE_AMBIENTAL"
  | "LICENCA"
  | "CERTIFICADO"
  | "PERMISSAO"
  | "ENTREGA_EPI"
  | "DOCUMENTO_CLIENTE"
  | "FOTO_CAMPO"
  | "OUTRO";

export const esgObligationCategoryLabels: Record<EsgObligationCategory, string> = {
  DDS: "DDS",
  INTEGRACAO_SEGURANCA: "Integração de Segurança",
  TREINAMENTO: "Treinamento",
  INSPECAO: "Inspeção",
  RELATORIO: "Relatório",
  DOCUMENTACAO_TERCEIROS: "Documentação de Terceiros",
  REGISTRO_ACIDENTE_INCIDENTE: "Registro de Acidente/Incidente",
  DESTINACAO_RESIDUOS: "Destinação de Resíduos",
  COMPROVANTE_AMBIENTAL: "Comprovante Ambiental",
  LICENCA: "Licença",
  CERTIFICADO: "Certificado",
  PERMISSAO: "Permissão",
  ENTREGA_EPI: "Entrega de EPI",
  DOCUMENTO_CLIENTE: "Documento Exigido pelo Cliente",
  FOTO_CAMPO: "Foto de Campo",
  OUTRO: "Outro",
};

export type EsgObligationPeriodicity =
  | "UNICA"
  | "DIARIA"
  | "SEMANAL"
  | "QUINZENAL"
  | "MENSAL"
  | "POR_EVENTO"
  | "POR_MARCO"
  | "PERSONALIZADA";

export const esgObligationPeriodicityLabels: Record<EsgObligationPeriodicity, string> = {
  UNICA: "Única",
  DIARIA: "Diária",
  SEMANAL: "Semanal",
  QUINZENAL: "Quinzenal",
  MENSAL: "Mensal",
  POR_EVENTO: "Por evento",
  POR_MARCO: "Por marco",
  PERSONALIZADA: "Personalizada",
};

export type EsgObligationStatus =
  | "CUMPRIDO"
  | "CUMPRIDO_PARCIALMENTE"
  | "PENDENTE"
  | "NAO_CUMPRIDO"
  | "NAO_APLICAVEL"
  | "DISPENSADO";

export const esgObligationStatusLabels: Record<EsgObligationStatus, string> = {
  CUMPRIDO: "Cumprido",
  CUMPRIDO_PARCIALMENTE: "Cumprido parcialmente",
  PENDENTE: "Pendente",
  NAO_CUMPRIDO: "Não cumprido",
  NAO_APLICAVEL: "Não aplicável",
  DISPENSADO: "Dispensado",
};

export type EsgEvidenceKind = "FOTO" | "DOCUMENTO" | "PLANILHA" | "LISTA_PRESENCA" | "OUTRO";

export const esgEvidenceKindLabels: Record<EsgEvidenceKind, string> = {
  FOTO: "Foto",
  DOCUMENTO: "Documento",
  PLANILHA: "Planilha",
  LISTA_PRESENCA: "Lista de presença",
  OUTRO: "Outro",
};

export type EsgRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const slaAreaLabels: Record<SlaArea, string> = {
  DIRETORIA: "Diretoria",
  ADMINISTRATIVO: "Administrativo",
  COMERCIAL: "Comercial",
  FINANCEIRO: "Financeiro",
  ENGENHARIA: "Engenharia",
  ORCAMENTO: "Orçamento",
  JURIDICO: "Jurídico",
  PLANEJAMENTO: "Planejamento",
  ESG_SSMA: "ESG/SSMA",
};

export const slaActionStatusLabels: Record<SlaActionStatus, string> = {
  PENDING: "Pendente",
  ACKNOWLEDGED: "Assumida",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  OVERDUE: "Vencida",
  ESCALATED: "Escalada",
  CANCELLED: "Cancelada",
};

export const slaEscalationLevelLabels: Record<SlaEscalationLevel, string> = {
  RESPONSAVEL: "Responsável",
  ESCALAO_1: "1º Escalão",
  ESCALAO_2: "2º Escalão",
  DIRETORIA: "Diretoria",
};

export const slaTimeUnitLabels: Record<SlaTimeUnit, string> = {
  BUSINESS_HOURS: "Horas úteis",
  CLOCK_HOURS: "Horas corridas",
  BUSINESS_DAYS: "Dias úteis",
  CALENDAR_DAYS: "Dias corridos",
};

export const slaActionOriginLabels: Record<SlaActionOrigin, string> = {
  MANUAL: "Manual",
  EXPERT_RECOMMENDATION: "Recomendação de um Expert",
  ESG_OBLIGATION: "Obrigação ESG/SSMA",
  EVENT: "Evento do Ledger",
  ACTION_REQUEST: "Solicitação (ActionRequest)",
  OTHER: "Outra",
};

export const slaEscalationReasonLabels: Record<SlaEscalationReason, string> = {
  NO_ACKNOWLEDGMENT: "Não assumida no prazo",
  NOT_RESPONDED: "Não respondida no prazo",
  NOT_COMPLETED: "Não concluída no prazo",
  CONTRACTUAL_DEADLINE_NEAR: "Prazo contratual próximo",
  CONTRACTUAL_DEADLINE_MISSED: "Prazo contratual perdido",
  NEW_EVIDENCE_INCREASED_RISK: "Nova evidência aumentou o risco",
};

export const additionalProposalStatusLabels: Record<AdditionalProposalStatus, string> = {
  POSSIBLE_ADDITIONAL: "Possível adicional",
  UNDER_ANALYSIS: "Em análise",
  IN_NEGOTIATION: "Em negociação",
  CONTRACTED: "Contratado",
  NOT_CONTRACTED: "Não contratado",
  CANCELLED: "Cancelado",
};

export const additionalProposalApprovalStatusLabels: Record<AdditionalProposalApprovalStatus, string> = {
  NOT_EVALUATED: "Não avaliado",
  NOT_REQUIRED: "Não necessário",
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
};

export const additionalProposalScheduleExtensionStatusLabels: Record<AdditionalProposalScheduleExtensionStatus, string> = {
  NOT_EVALUATED: "Não avaliado",
  NOT_REQUIRED: "Não necessário",
  TO_BE_REQUESTED: "A solicitar",
  REQUESTED: "Solicitado",
  APPROVED: "Aprovado",
  PARTIALLY_APPROVED: "Aprovado parcialmente",
  REJECTED: "Rejeitado",
};

export const additionalProposalFormalizationTypeLabels: Record<AdditionalProposalFormalizationType, string> = {
  ADITIVO_CONTRATUAL: "Aditivo contratual",
  EMAIL_APROVACAO: "E-mail de aprovação",
  ORDEM_COMPRA_PO: "Ordem de compra / PO",
  ORDEM_SERVICO: "Ordem de serviço",
  CARTA_AUTORIZACAO_FORMAL: "Carta / autorização formal",
  ATA_REGISTRO_FORMAL_ACEITO: "Ata / registro formal aceito",
  OUTRO: "Outro",
  NAO_IDENTIFICADO: "Não identificado",
};

export const additionalProposalDocumentalStateLabels: Record<AdditionalProposalDocumentalState, string> = {
  CONTRATADO_DOCUMENTACAO_COMPLETA: "Contratado — documentação completa",
  CONTRATADO_DOCUMENTACAO_PENDENTE: "Contratado — documentação pendente",
  CONTRATADO_FORMALIZACAO_COM_RESSALVA: "Contratado — formalização com ressalva",
};

export const additionalProposalLinkRoleLabels: Record<AdditionalProposalLinkRole, string> = {
  ORIGIN_SOURCE: "Fonte de origem",
  EVIDENCIA_CONTRATACAO: "Evidência da contratação",
  PROPOSTA_FINAL_AXION: "Proposta final AXION",
  CRONOGRAMA_IMPACTO: "Cronograma atualizado / análise de impacto",
  EVIDENCIA_VALOR: "Evidência de valor aprovado",
  EVIDENCIA_PRAZO: "Evidência de prazo aprovado/extensão",
  ESCOPO_PROJETO: "Escopo/projeto aprovado",
};

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const emailAccountStatusLabels: Record<"NOT_CONNECTED" | "CONNECTED" | "SYNCING" | "AUTH_EXPIRED" | "ERROR", string> = {
  NOT_CONNECTED: "Não conectada",
  CONNECTED: "Conectada",
  SYNCING: "Sincronizando",
  AUTH_EXPIRED: "Autorização expirada",
  ERROR: "Erro",
};

export const documentKindLabels: Record<DocumentKind, string> = {
  CONTRATO_BASE: "Contrato base",
  ADITIVO: "Aditivo",
  EDITAL: "Edital",
  RFI: "RFI",
  RFP: "RFP",
  ESPECIFICACAO: "Especificação",
  DESENHO: "Desenho",
  PLANILHA: "Planilha",
  CRONOGRAMA_BASELINE: "Cronograma baseline",
  CRONOGRAMA_REVISAO: "Revisão de cronograma",
  RELATORIO_SEMANAL: "Relatório semanal",
  PROPOSTA_AXION: "Proposta AXION",
  CLARIFICACAO_CLIENTE: "Clarificação do cliente",
};
