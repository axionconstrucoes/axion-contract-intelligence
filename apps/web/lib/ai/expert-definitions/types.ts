// Especificação formal, tipada e versionada dos Experts oficiais do ACC
// — um CATÁLOGO/REGISTRO, nunca a implementação operacional em si.
//
// Deliberadamente DISTINTO do `ExpertId` operacional
// (apps/web/lib/ai/types.ts), que só contém os Experts com
// generateAssessment/answerQuery de fato ligados (hoje:
// "commercial-director" | "esg-director"). Este catálogo registra os
// CINCO Experts oficiais do produto, incluindo os três ainda sem
// nenhuma implementação operacional — `status` declara isso
// explicitamente, nunca finge que algo existe antes de existir (mesmo
// princípio já usado em docs/ai/experts.md seção 1).
//
// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.

export type OfficialExpertId =
  | "ceo"
  | "commercial-director"
  | "legal-consultant"
  | "planning-director"
  | "esg-director";

export type ExpertImplementationStatus =
  // Definição formal existe (este catálogo); generateAssessment/answerQuery reais ainda não foram construídos.
  | "PLANNED"
  // Definição formal + operação real (context builder, provider, validação) já ligados.
  | "IMPLEMENTED";

/** Nunca finge integração existente — AVAILABLE só quando a fonte é real e consultável hoje. */
export type ExpertSourceStatus = "AVAILABLE" | "FUTURE_SOURCE";

export interface AuthorizedSourceRef {
  /** Identificador estável da fonte (nome de tabela real ou rótulo conceitual quando FUTURE_SOURCE). */
  sourceId: string;
  label: string;
  status: ExpertSourceStatus;
  /** Por que está FUTURE_SOURCE, ou onde a fonte já é consumida hoje quando AVAILABLE — nunca deixado implícito. */
  note: string;
}

/** Seção 11 do requisito — outputs formais que qualquer Expert pode produzir. */
export type ExpertOutputType =
  | "ANALYSIS"
  | "RECOMMENDATION"
  | "RISK_ASSESSMENT"
  | "ACTION_SUGGESTION"
  | "DRAFT_EMAIL"
  | "DRAFT_LETTER"
  | "DRAFT_NOTIFICATION"
  | "DRAFT_PROPOSAL"
  | "DRAFT_COUNTERPROPOSAL"
  | "EXECUTIVE_SUMMARY"
  | "TIMELINE_ANALYSIS"
  | "DOCUMENT_GAP_ANALYSIS";

/**
 * Seção 10 do requisito — toda saída de todo Expert deve poder
 * classificar cada afirmação em uma destas oito categorias. Já
 * implementado como CAMPOS separados em `ExpertQueryResponse`
 * (`fatosDocumentados`/`contextoInternoDeclarado`/`baseContratual`/
 * `baseLegal`/`praticasNegociais`/`interpretacao`/`recomendacoes`/
 * `informacoesFaltantes`) — este enum existe para referência/documentação
 * formal da mesma distinção, não para duplicar o schema real.
 */
export type FactCategory =
  | "FATO_DOCUMENTADO"
  | "CONTEXTO_INTERNO_DECLARADO"
  | "BASE_CONTRATUAL"
  | "BASE_LEGAL"
  | "PRATICA_NEGOCIAL"
  | "INTERPRETACAO_IA"
  | "RECOMENDACAO_IA"
  | "INFORMACAO_AUSENTE";

/** Seção 13 do requisito — situação em que o Expert deve declarar "DECISÃO HUMANA NECESSÁRIA". */
export interface ExpertEscalationRule {
  situation: string;
  requiredDeclaration: string;
}

/**
 * Seção 12 do requisito — TEMA → EXPERT PRINCIPAL → EXPERTS AUXILIARES.
 * Uma linha da matriz mestre (`EXPERT_COLLABORATION_MATRIX`); cada
 * `ExpertDefinition` expõe as linhas em que participa via
 * `getCollaborationRulesForExpert()`, nunca duplicando os dados.
 */
export interface ExpertCollaborationRule {
  topic: string;
  primaryExpertId: OfficialExpertId;
  supportingExpertIds: OfficialExpertId[];
  /** Condição de quando o auxiliar entra (ex.: "quando houver risco legal") — null quando sempre se aplica. */
  condition: string | null;
}

export interface ExpertConfidenceRule {
  description: string;
}

/**
 * Especificação formal de um Expert oficial do ACC. `requiresHumanReview`
 * é sempre `true` (tipo literal) — nenhuma definição pode existir sem
 * essa garantia, mesmo antes do Expert ter qualquer implementação
 * operacional real.
 */
export interface ExpertDefinition {
  expertId: OfficialExpertId;
  expertName: string;
  /** Ex.: "v1" — combinado com expertId forma a tag "commercial-director:v1" (ver formatExpertVersionTag). */
  version: string;
  status: ExpertImplementationStatus;
  mission: string;
  authorizedSources: AuthorizedSourceRef[];
  capabilities: string[];
  typicalQuestions: string[];
  outputTypes: ExpertOutputType[];
  limitations: string[];
  escalationRules: ExpertEscalationRule[];
  collaborationRules: ExpertCollaborationRule[];
  confidenceRules: ExpertConfidenceRule[];
  requiresHumanReview: true;
}

export function formatExpertVersionTag(definition: Pick<ExpertDefinition, "expertId" | "version">): string {
  return `${definition.expertId}:${definition.version}`;
}
