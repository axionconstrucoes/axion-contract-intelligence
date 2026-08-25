import type { QueueItemStatus, QueuePhase } from "@/lib/documents/multi-upload/types";

export const STATUS_LABELS: Record<QueueItemStatus, string> = {
  PENDENTE: "Aguardando envio",
  VALIDANDO: "Validando",
  CALCULANDO_HASH: "Calculando hash",
  AGUARDANDO_DECISAO_VERSAO: "Confirmar nova versão?",
  AGUARDANDO_DECISAO_CONFLITO: "Conflito de tipo — decisão necessária",
  DUPLICADO: "Duplicado",
  ENVIANDO: "Enviando",
  REGISTRANDO: "Registrando",
  PROCESSANDO: "Processando",
  CONCLUIDO: "Concluído",
  AGUARDANDO_ANALISE: "Upload concluído — análise/OCR pendente",
  ERRO: "Erro",
  REJEITADO: "Rejeitado",
};

export const PHASE_LABELS: Record<QueuePhase, string> = {
  VALIDACAO: "Validação",
  HASH: "Cálculo de hash",
  UPLOAD: "Upload",
  REGISTRO: "Registro",
  PROCESSAMENTO: "Processamento",
  CONCLUIDO: "Concluído",
};

export const STATUS_BADGE_VARIANT: Record<
  QueueItemStatus,
  "default" | "outline" | "secondary" | "destructive"
> = {
  PENDENTE: "outline",
  VALIDANDO: "outline",
  CALCULANDO_HASH: "outline",
  AGUARDANDO_DECISAO_VERSAO: "secondary",
  AGUARDANDO_DECISAO_CONFLITO: "secondary",
  DUPLICADO: "secondary",
  ENVIANDO: "outline",
  REGISTRANDO: "outline",
  PROCESSANDO: "outline",
  CONCLUIDO: "default",
  AGUARDANDO_ANALISE: "secondary",
  ERRO: "destructive",
  REJEITADO: "destructive",
};
