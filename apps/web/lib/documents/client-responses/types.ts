// Bloco 6 (MVP controlado) — resposta do cliente vinculada a uma
// versão de documento. Espelha public.document_version_client_responses
// (migration 20260829190000_document_version_client_responses.sql).

export type ClientResponseRelationType = "RESPONDE" | "DISCORDA" | "CORRIGE" | "RESSALVA" | "COMPLEMENTA";

export type ClientResponseLinkMethod =
  | "INTERNAL_VERSION_ID"
  | "MESSAGE_ID_REFERENCES"
  | "THREAD"
  | "ATTACHMENT_HASH"
  | "SUBJECT_CANDIDATE";

export interface DocumentVersionClientResponse {
  id: string;
  projectId: string;
  documentVersionId: string;
  emailId: string;
  relationType: ClientResponseRelationType;
  linkMethod: ClientResponseLinkMethod;
  excerpt: string | null;
  createdAt: string;
}

// Entrada mínima de e-mail necessária para a resolução de candidatos —
// só os campos realmente usados pela prioridade de vínculo (Bloco 6),
// nunca o corpo completo do e-mail.
export interface InboundEmailForLinking {
  emailId: string;
  providerThreadId: string | null;
  messageIdHeader: string | null;
  attachmentSha256Hashes: string[];
  subject: string;
}

export interface DocumentVersionLinkCandidate {
  documentVersionId: string;
  // Presente quando esta versão pertence a uma thread de e-mail
  // conhecida (o e-mail ORIGINAL que enviou o documento, se rastreado)
  // — permite o método THREAD.
  originatingThreadId: string | null;
  // Hashes reais dos arquivos desta versão (document_version_files) —
  // permite o método ATTACHMENT_HASH.
  fileSha256Hashes: string[];
  // Título do documento — só para o método SUBJECT_CANDIDATE (última
  // prioridade, nunca automático).
  documentTitle: string;
}
