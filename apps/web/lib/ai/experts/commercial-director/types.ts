// Schema específico do Diretor Comercial IA (commercial-director) —
// estende os campos genéricos de ExpertAssessment (ver ../../types.ts)
// com a análise de negociação comercial. Nenhum campo aqui duplica um
// campo genérico já existente (severity, confidence, evidenceRefs,
// contractualBasis, recommendedActions, uncertainties,
// requiresHumanReview continuam vindo de ExpertAssessment).

import type { ExpertAssessment } from "../../types";

/**
 * Representa um dado potencialmente sensível (econômico, autorização,
 * limite de negociação) que o Expert NUNCA pode inventar. Três estados
 * explícitos em vez de um valor opcional solto:
 *
 * - AVAILABLE: valor extraído/fundamentado no contexto fornecido.
 * - UNAVAILABLE: o contexto simplesmente não contém essa informação.
 * - REQUIRES_HUMAN_DEFINITION: a decisão depende de definição humana
 *   (ex.: limite de desconto, margem mínima) — nunca deve ser estimada
 *   pela IA. Declarar sempre com a frase "Necessária definição humana."
 */
export type CommercialFieldValue<T> =
  | { status: "AVAILABLE"; value: T; basis: string }
  | { status: "UNAVAILABLE"; value: null; basis: null }
  | { status: "REQUIRES_HUMAN_DEFINITION"; value: null; basis: null };

export type CommercialImpactCategory = "FINANCIAL" | "SCHEDULE" | "CONTRACTUAL";

/**
 * Avaliação de impacto (financeiro/prazo/contratual). `estimatedValue`
 * só pode ser não-nulo quando status é AVAILABLE — nunca um número
 * inventado para preencher um campo numérico.
 */
export interface CommercialImpactAssessment {
  category: CommercialImpactCategory;
  status: "AVAILABLE" | "UNAVAILABLE" | "REQUIRES_HUMAN_DEFINITION";
  description: string | null;
  estimatedValue: number | null;
  basis: string | null;
}

export type CommercialDraftCommunicationType =
  | "EMAIL"
  | "PROPOSAL"
  | "COUNTER_PROPOSAL"
  | "LETTER"
  | "MEETING_AGENDA"
  | "NEGOTIATION_SCRIPT"
  | "MEMO"
  | "AMENDMENT_TEXT"
  | "INFORMATION_REQUEST"
  | "CLAIM_RESPONSE";

/**
 * Rascunho de comunicação comercial. `status` é sempre
 * "DRAFT_PENDING_REVIEW" — nunca outro valor. Isso é a garantia em nível
 * de tipo de que nenhuma comunicação é considerada "enviada" pelo Expert;
 * envio é sempre uma ação humana separada e explícita, fora deste módulo.
 */
export interface CommercialDraftCommunication {
  type: CommercialDraftCommunicationType;
  subject: string | null;
  body: string;
  status: "DRAFT_PENDING_REVIEW";
}

/**
 * Análise de negociação comercial — a parte específica do Diretor
 * Comercial IA. Listas vazias representam "nenhum item identificado no
 * contexto fornecido"; nunca preenchidas artificialmente.
 */
export interface CommercialNegotiationAnalysis {
  negotiationObjective: string | null;
  currentPosition: string | null;
  targetPosition: string | null;
  minimumAcceptablePosition: CommercialFieldValue<string>;
  nonNegotiableItems: string[];
  negotiableItems: string[];
  possibleConcessions: string[];
  requiredCounterparts: string[];
  counterpartyLikelyInterests: string[];
  recommendedStrategy: string | null;
  arguments: string[];
  anticipatedObjections: string[];
  suggestedResponses: string[];
  recommendedSequence: string[];
  commercialRisks: string[];
  financialImpact: CommercialImpactAssessment;
  scheduleImpact: CommercialImpactAssessment;
  contractualImpact: CommercialImpactAssessment;
  /** Nulo quando nenhum rascunho de comunicação foi solicitado/aplicável. */
  draftCommunication: CommercialDraftCommunication | null;
}

/** Saída completa do Diretor Comercial IA: genérico + negociação. */
export interface CommercialDirectorAssessment extends ExpertAssessment {
  negotiation: CommercialNegotiationAnalysis;
}
