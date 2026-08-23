// Tipos centrais da saída estruturada dos AI Experts do ACC.
//
// Nenhum destes tipos representa fato do projeto por si só — são o
// "envelope" estrutural que qualquer Expert deve preencher. A garantia de
// que o conteúdo é honesto/rastreável vem da validação em
// schemas/validate-expert-assessment.ts, não deste arquivo.

import type { ResponseGroundingSummary } from "./grounding/types";

/**
 * Identificador técnico estável do Expert. Nunca reutilizado para outro
 * papel. Só existe aqui um id por Expert realmente implementado — nomes de
 * Experts oficiais ainda não implementados (ver docs/ai/experts.md) não
 * entram nesta união. Os cinco Experts oficiais (ver
 * expert-definitions/types.ts OfficialExpertId) estão todos aqui desde a
 * conexão a um provider real (ver providers/anthropic-provider.ts).
 */
export type ExpertId = "commercial-director" | "esg-director" | "legal-consultant" | "planning-director" | "ceo";

export type ExpertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Tipos de análise reconhecidos nesta fase. Lista fechada e validada — um
 * Expert nunca pode inventar um analysisType fora daqui (evita saída
 * textual livre disfarçada de campo estruturado). Estender esta união (e
 * VALID_ANALYSIS_TYPES no validador) conforme novos Experts/análises forem
 * adicionados — nunca remover valores usados por Experts existentes.
 */
export type ExpertAnalysisType =
  | "EVENT_CONTRACTUAL_ANALYSIS"
  | "CLAUSE_CONFRONTATION_REVIEW"
  | "SCOPE_CHANGE_ASSESSMENT"
  | "RISK_ASSESSMENT"
  | "COMMERCIAL_NEGOTIATION_STRATEGY"
  | "COMMERCIAL_COMMUNICATION_DRAFT";

/** Mesmas fontes de evidência já usadas no Event Ledger (EvidenceRef/CrossReference). */
export type ExpertEvidenceSourceType = "DOCUMENT" | "CLAUSE" | "EVENT" | "EMAIL" | "SCHEDULE_ACTIVITY";

/** Referência rastreável a uma evidência real do projeto — nunca texto solto. */
export interface ExpertEvidenceRef {
  sourceType: ExpertEvidenceSourceType;
  sourceId: string;
  label: string;
  locator: string | null;
}

/** Referência estruturada a cláusula/documento — nunca cláusula inventada. */
export interface ExpertContractualBasisRef {
  documentId: string | null;
  documentKind: string | null;
  clauseId: string | null;
  clauseNumber: string | null;
  clauseTitle: string | null;
  excerpt: string | null;
}

/**
 * Separação obrigatória entre FATO/EVIDÊNCIA (facts) e INTERPRETAÇÃO DO
 * EXPERT (interpretation) — nunca apresentar interpretação como fato.
 * `recommendedActions` no assessment é a terceira categoria (C. RECOMENDAÇÃO).
 */
export interface ExpertFinding {
  facts: string[];
  interpretation: string;
}

/**
 * Saída estruturada obrigatória de qualquer AI Expert do ACC.
 * requiresHumanReview é sempre true nesta fase — nunca decisão do provider.
 */
export interface ExpertAssessment {
  expertId: ExpertId;
  expertName: string;
  expertVersion: string;
  analysisType: ExpertAnalysisType;
  finding: ExpertFinding;
  severity: ExpertSeverity;
  confidence: number; // 0..1
  executiveSummary: string;
  contractualBasis: ExpertContractualBasisRef[];
  eventBasis: string[];
  evidenceRefs: ExpertEvidenceRef[];
  possibleImpacts: string[];
  recommendedActions: string[];
  uncertainties: string[];
  requiresHumanReview: true;
  /**
   * Resumo do guardrail determinístico de grounding/citação (ver
   * apps/web/lib/ai/grounding/), computado sempre pelo próprio Expert
   * DEPOIS da validação de schema — nunca lido diretamente do provider.
   * `null`/ausente quando o guardrail não foi executado (ex.: nenhum
   * draft nesta resposta, ou Expert que ainda não integra o guardrail).
   */
  grounding?: ResponseGroundingSummary | null;
}
