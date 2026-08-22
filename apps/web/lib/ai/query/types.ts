// Tipos da consulta conversacional aos Experts ("Perguntar ao Diretor
// Comercial IA" e futuros). Estrutura de resposta DISTINTA de
// ExpertAssessment (../types.ts): aquela é a saída de uma análise em
// lote sobre um evento; esta é a resposta a uma pergunta pontual do
// usuário, com nomes de campo em português (conforme especificado) para
// exibição direta na UI.

import type { ExpertContractualBasisRef, ExpertId, ExpertSeverity } from "../types";
import type { LegalCitation } from "../legal/types";
import type { ResponseGroundingSummary } from "../grounding/types";

/**
 * Escopos suportados pela arquitetura. Nesta fase, somente PROJECT e
 * EVENT têm implementação funcional (ver docs/ai/experts.md) — DOCUMENT,
 * EMAIL e MULTI_EXPERT existem como contrato de tipo para não travar a
 * evolução futura, mas o orquestrador rejeita explicitamente (fail
 * closed) qualquer tentativa de uso real deles nesta fase.
 */
export type ExpertQueryScope = "PROJECT" | "EVENT" | "DOCUMENT" | "EMAIL" | "MULTI_EXPERT";

export interface ExpertQueryRequest {
  scope: ExpertQueryScope;
  projectId: string;
  /** Obrigatório quando scope = EVENT. */
  eventId?: string;
  /** Reservado para scope = DOCUMENT — FUTURE_SOURCE, não implementado nesta fase. */
  documentId?: string;
  /** Reservado para scope = EMAIL — FUTURE_SOURCE, não implementado nesta fase. */
  emailId?: string;
  question: string;
}

/**
 * Toda afirmação relevante deve ser classificada nesta origem — nunca
 * apresentar prática negocial como obrigação jurídica (ver seção
 * "Práticas negociais" em docs/ai/experts.md).
 */
export type RequirementSourceKind =
  | "LEGAL_REQUIREMENT"
  | "CONTRACTUAL_REQUIREMENT"
  | "NEGOTIATION_PRACTICE"
  | "AI_RECOMMENDATION";

export interface ClassifiedStatement {
  kind: RequirementSourceKind;
  statement: string;
}

/**
 * Anotação declarada internamente citada na resposta — nunca confundida
 * com fato documental. Espelha ContextEventNote (../context/types.ts),
 * repetido aqui para a resposta não depender de importar o contexto
 * inteiro.
 */
export interface DeclaredContextItem {
  noteId: string;
  category: string;
  text: string;
  author: string;
  createdAt: string;
  status: "DECLARED_CONTEXT";
}

export type ExpertQueryDraftType =
  | "EMAIL"
  | "PROPOSAL"
  | "COUNTER_PROPOSAL"
  | "LETTER"
  | "NOTIFICATION"
  | "COMMERCIAL_RESPONSE"
  | "MEETING_AGENDA"
  | "NEGOTIATION_SCRIPT"
  | "MEMO"
  | "INFORMATION_REQUEST"
  | "AMENDMENT_TEXT";

/**
 * Rascunho sugerido pela resposta. `status` travado em
 * "DRAFT_PENDING_REVIEW" — validado, nunca aceito com outro valor. É a
 * garantia de que nenhum rascunho é tratado como enviado (ver seção 4:
 * IA PODE REDIGIR → HUMANO REVISA/EDITA → HUMANO APROVA/REJEITA).
 */
export interface ExpertQueryDraft {
  type: ExpertQueryDraftType;
  subject: string | null;
  body: string;
  status: "DRAFT_PENDING_REVIEW";
}

/**
 * Resposta estruturada de uma consulta conversacional. Nunca texto livre
 * como única resposta — cada seção é renderizada separadamente na UI.
 */
export interface ExpertQueryResponse {
  expertId: ExpertId;
  expertName: string;
  expertVersion: string;
  scope: ExpertQueryScope;
  question: string;
  fatosDocumentados: string[];
  contextoInternoDeclarado: DeclaredContextItem[];
  baseContratual: ExpertContractualBasisRef[];
  baseLegal: LegalCitation[];
  praticasNegociais: ClassifiedStatement[];
  interpretacao: string;
  riscos: string[];
  severity: ExpertSeverity;
  recomendacoes: string[];
  acoesSugeridas: string[];
  informacoesFaltantes: string[];
  rascunhoSugerido: ExpertQueryDraft | null;
  confidence: number;
  requiresHumanReview: true;
  /** Ver ExpertAssessment.grounding (../types.ts) — mesma extensão compatível, nunca lida do provider. */
  grounding?: ResponseGroundingSummary | null;
}
