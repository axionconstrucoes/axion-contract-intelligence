// Registros de campo SSMA (ocorrência / inspeção) enviados pelo PWA. Módulo PURO (sem React, sem
// rede): tipos, listas e validação compartilhados pela fila offline, pela UI e pelos testes.
// Regras espelham a migration 20261028130000_ssma_field_records.sql — o servidor revalida tudo.

export const FIELD_RECORD_KINDS = [
  { value: "OCORRENCIA", label: "Ocorrência" },
  { value: "INSPECAO", label: "Inspeção" },
] as const;
export type FieldRecordKind = (typeof FIELD_RECORD_KINDS)[number]["value"];

export const FIELD_RECORD_CATEGORIES = [
  "Condição insegura",
  "Ato inseguro",
  "Quase-acidente",
  "EPI",
  "Sinalização",
  "Organização e limpeza",
  "Meio ambiente",
  "Inspeção de rotina",
  "Outra",
] as const;

// Mesmos níveis do aplicativo SSMA existente (SSMA_RISK_LEVELS): o risco aqui é o relato de CAMPO,
// não a classificação contratual de alertas.
export const FIELD_RECORD_RISKS = [
  { value: "BAIXA", label: "Baixo" },
  { value: "MEDIA", label: "Médio" },
  { value: "ALTA", label: "Alto" },
  { value: "CRITICA", label: "Crítico" },
] as const;
export type FieldRecordRisk = (typeof FIELD_RECORD_RISKS)[number]["value"];

export const MAX_PHOTOS_PER_RECORD = 20;
export const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_PHOTO_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png"];

export interface FieldRecordDraft {
  kind: FieldRecordKind;
  category: string;
  description: string;
  location: string;
  /** Instante do fato (ISO 8601 UTC), informado/confirmado pelo técnico. */
  occurredAt: string;
  risk: FieldRecordRisk;
  responsibleUserId: string | null;
  /** AAAA-MM-DD; obrigatório quando há responsável. */
  dueDate: string | null;
}

export type FieldRecordValidation = { ok: true } | { ok: false; errors: string[] };

export function validateFieldRecordDraft(draft: FieldRecordDraft, now: Date = new Date()): FieldRecordValidation {
  const errors: string[] = [];
  if (!FIELD_RECORD_KINDS.some((kind) => kind.value === draft.kind)) errors.push("Tipo de registro inválido.");
  if (!draft.category.trim()) errors.push("Informe a categoria.");
  if (draft.description.trim().length < 3) errors.push("Descreva o registro (mínimo de 3 caracteres).");
  if (draft.description.trim().length > 4000) errors.push("A descrição excede 4000 caracteres.");
  if (!draft.location.trim()) errors.push("Informe o local.");
  const occurred = new Date(draft.occurredAt);
  if (Number.isNaN(occurred.getTime())) errors.push("Informe uma data e hora válidas.");
  else if (occurred.getTime() > now.getTime() + 24 * 60 * 60 * 1000) errors.push("A data do fato não pode estar no futuro.");
  if (!FIELD_RECORD_RISKS.some((risk) => risk.value === draft.risk)) errors.push("Selecione o risco.");
  if (draft.responsibleUserId) {
    if (!draft.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) errors.push("Informe o prazo da ação corretiva.");
  } else if (draft.dueDate) {
    errors.push("Informe o responsável pela ação corretiva ou remova o prazo.");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Estados mostrados ao usuário no aparelho. */
export type QueueStatus = "SAVED_ON_DEVICE" | "WAITING_SEND" | "SYNCED" | "FAILED";

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  SAVED_ON_DEVICE: "Salvo no aparelho",
  WAITING_SEND: "Aguardando envio",
  SYNCED: "Sincronizado",
  FAILED: "Falha no envio",
};

export type PhotoPurpose = "REGISTRO" | "EVIDENCIA_ACAO";

export interface QueuedPhoto {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  purpose: PhotoPurpose;
  /** Já enviada ao Storage. */
  uploaded: boolean;
  /** Já registrada no servidor (RPC). */
  registered: boolean;
}

export interface QueuedRecord {
  /** UUID gerado no aparelho — também é o id do registro no servidor (idempotência). */
  clientId: string;
  /** Dono do registro no aparelho: nada é enviado por outra conta. */
  userId: string;
  projectId: string;
  draft: FieldRecordDraft;
  /** Horário REAL da criação no aparelho (ISO). Preservado no servidor. */
  clientCreatedAt: string;
  photos: QueuedPhoto[];
  recordSubmitted: boolean;
  status: QueueStatus;
  attempts: number;
  lastError: string | null;
  /** Erro que repetir não resolve (ex.: sem acesso à obra). Exige descarte ou correção por humano. */
  permanentError: boolean;
  lastAttemptAt: string | null;
  syncedAt: string | null;
}

export const RISK_LABELS: Record<FieldRecordRisk, string> = { BAIXA: "Baixo", MEDIA: "Médio", ALTA: "Alto", CRITICA: "Crítico" };
export const ACTION_STATUS_LABELS = { ABERTA: "Aberta", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída" } as const;
export type ActionStatus = keyof typeof ACTION_STATUS_LABELS;

/** Mensagens (pt-BR) para os códigos de erro das RPCs. Nunca expõe texto bruto do banco. */
export const SERVER_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Sessão expirada. Entre novamente para enviar.",
  USER_MISMATCH: "Este registro foi criado por outra conta. Entre com a conta original para enviá-lo.",
  PROJECT_ACCESS_DENIED: "Você não tem acesso a esta obra.",
  RECORD_ID_CONFLICT: "Já existe um registro com este identificador de outra pessoa.",
  RESPONSIBLE_NOT_PROJECT_MEMBER: "O responsável escolhido não participa mais da obra.",
  DUE_DATE_REQUIRED: "Informe o prazo da ação corretiva.",
  INVALID_FUTURE_DATE: "A data do fato está no futuro. Corrija o horário do aparelho.",
  RECORD_ACCESS_DENIED: "Sem permissão para anexar neste registro.",
  PHOTO_LIMIT_EXCEEDED: "Limite de fotos do registro excedido.",
  ACTION_ACCESS_DENIED: "Somente o responsável ou um gestor da obra pode atualizar esta ação.",
  ACTION_ALREADY_CONCLUDED: "Esta ação já foi concluída.",
  NOTE_REQUIRED: "Descreva o andamento.",
  EVIDENCE_REQUIRED: "A conclusão exige uma foto de evidência.",
  EVIDENCE_NOT_FOUND: "A foto de evidência não foi encontrada neste registro.",
  JUSTIFICATION_REQUIRED: "Informe a justificativa (mínimo de 10 caracteres).",
};

/** Códigos que repetir o envio não resolve. */
export const PERMANENT_ERROR_CODES: readonly string[] = [
  "USER_MISMATCH",
  "PROJECT_ACCESS_DENIED",
  "RECORD_ID_CONFLICT",
  "RESPONSIBLE_NOT_PROJECT_MEMBER",
  "DUE_DATE_REQUIRED",
  "INVALID_FUTURE_DATE",
  "RECORD_ACCESS_DENIED",
  "PHOTO_LIMIT_EXCEEDED",
];

export function messageForServerError(code: string | null | undefined): string {
  if (code && SERVER_ERROR_MESSAGES[code]) return SERVER_ERROR_MESSAGES[code];
  return "Não foi possível enviar. Tente novamente.";
}

/** Extrai o código (ex.: "USER_MISMATCH") de uma mensagem de erro de RPC. */
export function extractServerErrorCode(message: string | null | undefined): string | null {
  for (const match of (message ?? "").matchAll(/[A-Z][A-Z_]{4,}/g)) {
    if (match[0] in SERVER_ERROR_MESSAGES || PERMANENT_ERROR_CODES.includes(match[0])) return match[0];
  }
  return null;
}
