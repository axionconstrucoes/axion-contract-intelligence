// Tipos do upload múltiplo de Documentos. Puros — sem dependência de
// DOM/React — para permitir testar a lógica de fila/dedup em Node
// (scripts/test-multi-document-upload.mjs), mesmo padrão de
// separação já usado em apps/web/lib/additionals e apps/web/lib/sla.

// Os 12 tipos documentais exigidos para o seletor de lote/individual
// do upload múltiplo. São um SUBCONJUNTO com nomes próprios de
// DocumentKind (@axion/types) — cada um existe na coluna real
// documents.kind (migration 20260825130000).
export type MultiUploadDocumentKind =
  | "CONTRATO_BASE"
  | "ADITIVO"
  | "ATA_REUNIAO"
  | "CRONOGRAMA_BASELINE"
  | "PROPOSTA_COMERCIAL"
  | "PROPOSTA_TECNICA"
  | "PLANILHA_CONTRATUAL"
  | "RELATORIO"
  | "NOTIFICACAO"
  | "ESG_SSMA"
  | "DIARIO_OBRA"
  | "OUTRO";

export const MULTI_UPLOAD_DOCUMENT_KINDS: readonly {
  value: MultiUploadDocumentKind;
  label: string;
}[] = [
  { value: "CONTRATO_BASE", label: "Contrato" },
  { value: "ADITIVO", label: "Aditivo Contratual" },
  { value: "ATA_REUNIAO", label: "Ata de Reunião" },
  { value: "CRONOGRAMA_BASELINE", label: "Cronograma" },
  { value: "PROPOSTA_COMERCIAL", label: "Proposta Comercial" },
  { value: "PROPOSTA_TECNICA", label: "Proposta Técnica" },
  { value: "PLANILHA_CONTRATUAL", label: "Planilha Contratual" },
  { value: "RELATORIO", label: "Relatório" },
  { value: "NOTIFICACAO", label: "Notificação" },
  { value: "ESG_SSMA", label: "ESG/SSMA" },
  { value: "DIARIO_OBRA", label: "Diário de Obra" },
  { value: "OUTRO", label: "Outro" },
];

// Fases por arquivo, nesta ordem fixa — o percentual de progresso
// reflete trabalho concluído (peso por fase), nunca tempo decorrido.
export type QueuePhase =
  | "VALIDACAO"
  | "HASH"
  | "UPLOAD"
  | "REGISTRO"
  | "PROCESSAMENTO"
  | "CONCLUIDO";

export const PHASE_ORDER: readonly QueuePhase[] = [
  "VALIDACAO",
  "HASH",
  "UPLOAD",
  "REGISTRO",
  "PROCESSAMENTO",
  "CONCLUIDO",
];

// Somam exatamente 100. UPLOAD tem o maior peso por ser, na prática,
// a fase mais demorada (transferência do binário).
export const PHASE_WEIGHTS: Record<QueuePhase, number> = {
  VALIDACAO: 5,
  HASH: 15,
  UPLOAD: 50,
  REGISTRO: 20,
  PROCESSAMENTO: 5,
  CONCLUIDO: 5,
};

export type QueueItemStatus =
  | "PENDENTE"
  | "VALIDANDO"
  | "CALCULANDO_HASH"
  | "AGUARDANDO_DECISAO_VERSAO"
  | "AGUARDANDO_DECISAO_CONFLITO"
  | "DUPLICADO"
  | "ENVIANDO"
  | "REGISTRANDO"
  | "PROCESSANDO"
  | "CONCLUIDO"
  // Terminal específico de Ata de Reunião (e de qualquer futuro tipo
  // com requiresHumanReview): o UPLOAD terminou (progressPercent
  // chega a 100), mas o conteúdo nunca foi analisado — não existe
  // worker de OCR/extração nesta etapa. Nunca reusar CONCLUIDO aqui,
  // que implicaria "tudo pronto" para quem lê a fila.
  | "AGUARDANDO_ANALISE"
  | "ERRO"
  | "REJEITADO";

export type DedupClassification =
  | "NOVO"
  | "NOVA_VERSAO"
  | "DUPLICADO"
  | "CONFLITO";

export type QueueFileDescriptor = {
  name: string;
  extension: string;
  sizeBytes: number;
  mimeType: string | null;
};

// Snapshot somente-leitura dos documentos já existentes no projeto,
// usado para classificação client-side ANTES do envio. A checagem
// definitiva (fail-closed) sempre acontece de novo no servidor —
// este snapshot é só para dar feedback rápido na fila, nunca é a
// fonte de verdade de segurança.
export type ExistingDocumentSnapshot = {
  documentId: string;
  title: string;
  kind: string;
  versions: { sha256Hash: string | null }[];
  nextVersionIndex: number;
};

export type ClassificationResult = {
  classification: DedupClassification;
  matchedDocumentId: string | null;
  matchedDocumentTitle: string | null;
  reason: string;
};

export type QueueItem = {
  id: string;
  descriptor: QueueFileDescriptor;
  kind: MultiUploadDocumentKind;
  status: QueueItemStatus;
  phase: QueuePhase;
  progressPercent: number;
  errorMessage: string | null;
  classification: DedupClassification | null;
  matchedDocumentId: string | null;
  matchedDocumentTitle: string | null;
  sha256Hash: string | null;
  documentVersionId: string | null;
  requiresHumanReview: boolean;
};

export type BatchSummary = {
  total: number;
  completed: number;
  processing: number;
  duplicated: number;
  rejected: number;
  errored: number;
  overallPercent: number;
  // Upload terminou, mas o conteúdo ainda não foi analisado (hoje: só
  // Ata de Reunião). Contado dentro de `completed` (o UPLOAD está
  // 100% feito) e também exposto aqui à parte, para nunca ficar
  // escondido atrás de um "concluído" genérico.
  pendingReview: number;
};
