import type {
  AiFindingType,
  AlertSeverity,
  EventStatus,
  ImplicationCategory,
  IntegrationStatus,
  ProjectPermission,
  ScheduleActivityStatus,
  SourceType,
  UserOrigin,
} from "@axion/types";

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

export const severityLabels: Record<AlertSeverity, string> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
  CRITICA: "Crítica",
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
};

export const integrationStatusLabels: Record<IntegrationStatus, string> = {
  CONECTADO: "Conectado",
  PENDENTE: "Pendente",
  ERRO: "Erro",
};

export const permissionLabels: Record<ProjectPermission, string> = {
  VIEWER: "Leitor",
  EDITOR: "Editor",
  ADMIN: "Administrador",
};

export const originLabels: Record<UserOrigin, string> = {
  AXION_INTERNO: "Axion (Interno)",
  TERCEIRO: "Terceiro",
};

export const scheduleStatusLabels: Record<ScheduleActivityStatus, string> = {
  NO_PRAZO: "No Prazo",
  ATRASADA: "Atrasada",
  CONCLUIDA: "Concluída",
};

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
