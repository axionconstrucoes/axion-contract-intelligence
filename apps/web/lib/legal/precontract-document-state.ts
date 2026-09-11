// Estados do card de documento da análise pré-contratual. Módulo
// server/client-neutro DE PROPÓSITO: um módulo "use server" só pode
// exportar funções async, então tipos, constantes e funções puras vivem
// aqui (mesmo motivo de lib/ai/expert-query-state.ts).

/**
 * Estados visíveis do card, na ordem em que acontecem.
 *
 * ENVIANDO e PRONTO são deliberadamente distintos de PROCESSANDO: "100%
 * enviado" nunca significa "pronto para consultar". O byte final chegar
 * ao Storage não diz nada sobre o texto ter sido lido — um PDF
 * digitalizado sem OCR chega a 100% e não libera consulta nenhuma.
 *
 * AGUARDANDO_DECISAO existe porque o pipeline de upload do ACC nunca
 * decide sozinho entre "nova versão" e "documento separado" — quem
 * decide é o humano (ver classifyCandidate em
 * lib/documents/multi-upload/queue-core.ts).
 */
export type PrecontractDocumentStatus =
  | "OCIOSO"
  | "AGUARDANDO_DECISAO"
  | "ENVIANDO"
  | "PROCESSANDO"
  | "PRONTO"
  | "DUPLICADO"
  | "ERRO";

export const PRECONTRACT_STATUS_LABELS: Record<PrecontractDocumentStatus, string> = {
  OCIOSO: "Aguardando documento",
  AGUARDANDO_DECISAO: "Aguardando sua confirmação",
  ENVIANDO: "Enviando",
  PROCESSANDO: "Processando documento",
  PRONTO: "Pronto",
  DUPLICADO: "Documento duplicado",
  ERRO: "Erro",
};

/** Decisão humana pendente quando o arquivo parece uma nova versão. */
export interface PrecontractPendingDecision {
  classification: "NOVA_VERSAO" | "CONFLITO";
  matchedDocumentId: string;
  matchedDocumentTitle: string;
  reason: string;
}

export interface PrecontractDocumentItem {
  /** Identificador local do item — nunca persistido. */
  id: string;
  fileName: string;
  kind: string;
  sizeBytes: number;
  status: PrecontractDocumentStatus;
  /** Percentual REAL de bytes enviados (0..100) durante ENVIANDO. */
  uploadPercent: number;
  documentId: string | null;
  documentVersionId: string | null;
  versionLabel: string | null;
  pageCount: number | null;
  characterCount: number | null;
  message: string | null;
  /** Preenchido apenas em AGUARDANDO_DECISAO. */
  pendingDecision: PrecontractPendingDecision | null;
  /** true quando o item veio do servidor (documento já existente), não deste envio. */
  hydrated: boolean;
}

export interface VerifyPrecontractDocumentResult {
  ok: boolean;
  status: "PRONTO" | "ERRO";
  pageCount: number | null;
  characterCount: number | null;
  message: string | null;
}

/**
 * Resultado da verificacao EM LOTE (hidratacao apos F5). Somente
 * metadados de prontidao — o texto extraido nunca volta ao navegador.
 * A lista de documentos e DESCOBERTA PELO SERVIDOR a partir do
 * projectId; o cliente nao envia (nem poderia enviar) quais documentos
 * devem ser lidos.
 */
export interface BatchVerifiedDocument {
  documentId: string;
  documentVersionId: string;
  title: string;
  fileName: string;
  versionLabel: string | null;
  sizeBytes: number;
  status: "PRONTO" | "ERRO";
  pageCount: number | null;
  characterCount: number | null;
  message: string | null;
}

export interface BatchVerifyPrecontractDocumentsResult {
  ok: boolean;
  message: string | null;
  documents: BatchVerifiedDocument[];
}

/**
 * Converte o resultado do lote em itens do card. Substitui a hidratacao
 * otimista anterior: agora a tela so mostra o que o SERVIDOR confirmou.
 */
export function itemsFromBatchVerification(
  documents: readonly BatchVerifiedDocument[]
): PrecontractDocumentItem[] {
  return documents.map((document) => ({
    id: `existing:${document.documentVersionId}`,
    fileName: document.fileName,
    kind: "CONTRATO_BASE",
    sizeBytes: document.sizeBytes,
    status: document.status,
    uploadPercent: 100,
    documentId: document.documentId,
    documentVersionId: document.documentVersionId,
    versionLabel: document.versionLabel,
    pageCount: document.pageCount,
    characterCount: document.characterCount,
    message: document.message,
    pendingDecision: null,
    hydrated: true,
  }));
}

/**
 * Documento já existente no projeto, carregado NO SERVIDOR para hidratar
 * a tela após um F5. Sem isto, "Pronto" morria com o estado do React e o
 * usuário era obrigado a reenviar o mesmo arquivo.
 */
export interface PrecontractExistingDocument {
  documentId: string;
  documentVersionId: string;
  title: string;
  kind: string;
  versionLabel: string | null;
  fileName: string;
  sizeBytes: number;
}

/**
 * Converte os documentos vindos do servidor em itens do card. Entram em
 * PROCESSANDO, nunca em PRONTO: só a verificação server-side (que relê o
 * arquivo) pode promover para PRONTO.
 */
export function hydrateItemsFromExisting(
  existing: readonly PrecontractExistingDocument[]
): PrecontractDocumentItem[] {
  return existing.map((document) => ({
    id: `existing:${document.documentVersionId}`,
    fileName: document.fileName,
    kind: document.kind,
    sizeBytes: document.sizeBytes,
    status: "PROCESSANDO",
    uploadPercent: 100,
    documentId: document.documentId,
    documentVersionId: document.documentVersionId,
    versionLabel: document.versionLabel,
    pageCount: null,
    characterCount: null,
    message: null,
    pendingDecision: null,
    hydrated: true,
  }));
}

/**
 * Regra única de liberação da consulta — usada pela página e coberta por
 * teste. Fail-closed: qualquer estado que não seja PRONTO com conteúdo
 * efetivamente extraído mantém o botão bloqueado.
 */
export function hasReadyPrecontractDocument(items: readonly PrecontractDocumentItem[]): boolean {
  return items.some(
    (item) => item.status === "PRONTO" && typeof item.characterCount === "number" && item.characterCount > 0
  );
}

/**
 * Motivo exibido quando a consulta está bloqueada. `null` quando
 * liberada — a página usa isso tanto para desabilitar o botão quanto
 * para explicar por quê, nunca só desabilitar sem dizer a razão.
 */
export function precontractQueryBlockReason(items: readonly PrecontractDocumentItem[]): string | null {
  if (hasReadyPrecontractDocument(items)) return null;

  if (items.some((item) => item.status === "AGUARDANDO_DECISAO")) {
    return "Confirme como este arquivo deve ser registrado para continuar.";
  }
  if (items.some((item) => item.status === "ENVIANDO")) {
    return "Aguarde o envio do documento terminar.";
  }
  if (items.some((item) => item.status === "PROCESSANDO")) {
    return "Processando documento — a consulta é liberada quando o conteúdo estiver disponível.";
  }
  if (items.length > 0 && items.every((item) => item.status === "ERRO" || item.status === "DUPLICADO")) {
    return "Nenhum documento pôde ser lido. Envie um PDF, DOCX ou TXT com texto selecionável.";
  }

  return "Envie um documento da negociação para consultar o especialista jurídico.";
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
