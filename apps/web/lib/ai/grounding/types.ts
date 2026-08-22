// Tipos do guardrail determinístico de grounding/citação
// (docs/ai/grounding-and-citation-guardrails.md). Puro, sem I/O — nunca
// importa de ../types.ts nem de ../query/types.ts (é o inverso: aqueles
// dois importam ResponseGroundingSummary daqui), para nunca criar
// dependência circular.
//
// Este módulo NUNCA usa embeddings, um segundo LLM "juiz" nem RAG — é
// checagem determinística baseada no contexto já recuperado pelos
// Context Builders existentes (ver build-grounding-source.ts). Ver
// docs/ai/grounding-and-citation-guardrails.md, seção "Limitações",
// para o que isso deliberadamente NÃO cobre nesta fase.

/**
 * Classificação obrigatória de toda afirmação relevante (seção 1 do
 * requisito):
 * - SUPPORTED: há suporte direto no contexto/evidenceRef/contractualBasis.
 * - INFERENCE: interpretação razoável derivada de fatos suportados —
 *   nunca apresentada como fato.
 * - UNSUPPORTED: não há suporte suficiente no contexto fornecido.
 * - HUMAN_INPUT_REQUIRED: depende de decisão/dado interno/autorização
 *   humana inexistente no contexto (ex.: desconto, margem, limite).
 */
export type ClaimSupportStatus = "SUPPORTED" | "INFERENCE" | "UNSUPPORTED" | "HUMAN_INPUT_REQUIRED";

export type ClaimCategory = "FACTUAL" | "CONTRACTUAL" | "LEGAL" | "NUMERIC";

/**
 * Uma afirmação (tipicamente uma frase) extraída de um draft e avaliada
 * contra o contexto autorizado. `reasoningNote` é sempre curto e
 * operacional — nunca chain-of-thought, nunca um raciocínio extenso.
 */
export interface GroundedClaim {
  text: string;
  category: ClaimCategory;
  supportStatus: ClaimSupportStatus;
  /** IDs/labels de evidência que sustentam a afirmação (quando aplicável). */
  evidenceRefs: string[];
  /** Números de cláusula que sustentam a afirmação (quando aplicável). */
  contractualBasisRefs: string[];
  /** Referências de fonte legal que sustentam a afirmação (quando aplicável). */
  legalSourceRefs: string[];
  reasoningNote: string;
}

/** Resultado da validação de grounding de um draft inteiro (seção 8). */
export interface GroundingValidationResult {
  /** false quando há ao menos uma unsupportedClaim não corrigida — o draft não deve ser tratado como pronto para revisão. */
  valid: boolean;
  supportedClaims: GroundedClaim[];
  inferredClaims: GroundedClaim[];
  unsupportedClaims: GroundedClaim[];
  humanInputRequiredClaims: GroundedClaim[];
  warnings: string[];
}

/**
 * Vocabulário/base de checagem determinística construída a partir do
 * contexto já recuperado pelos Context Builders (ver
 * build-grounding-source.ts) — nunca do conhecimento geral do modelo.
 */
export interface GroundingSource {
  /** Todo texto de evidência/fato disponível (evento, e-mails, anotações, cláusulas, fatos já documentados). */
  sourceTexts: string[];
  /** Números de cláusula presentes no contexto autorizado (cláusulas relacionadas + base contratual já citada). */
  availableClauseNumbers: string[];
  /** Referências de fonte legal oficial já presentes no contexto (baseLegal). */
  availableLegalReferences: string[];
}

/**
 * Resumo de grounding anexado à resposta (ExpertAssessment/ExpertQueryResponse,
 * seção 11) — extensão compatível, nunca um segundo schema concorrente.
 * `performed=false` quando não havia draft para checar nesta resposta.
 * Nomes dos quatro grupos seguem literalmente a seção 11 do requisito.
 */
export interface ResponseGroundingSummary {
  performed: boolean;
  valid: boolean;
  supported: GroundedClaim[];
  inferred: GroundedClaim[];
  unsupported: GroundedClaim[];
  missingSupport: GroundedClaim[];
  warnings: string[];
  /** true quando o guardrail determinístico corrigiu automaticamente uma afirmação insegura (ver apply-safe-correction.ts). */
  correctionApplied: boolean;
  /** true quando o rascunho foi suprimido (virou null) por não poder ser corrigido com segurança. */
  draftSuppressed: boolean;
}
