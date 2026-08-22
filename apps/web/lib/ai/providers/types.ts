// Abstração de provider de IA — nenhum Expert conhece Anthropic/OpenAI/
// Gemini diretamente. Isso permite trocar/adicionar provider real sem
// alterar nenhum Expert, e permite testar Experts inteiramente com o
// FakeAiProvider (determinístico, sem custo, sem rede).

import type { EventAnalysisContext } from "../context/types";
import type { ExpertAnalysisType, ExpertId } from "../types";

export interface AiProviderRequest {
  expertId: ExpertId;
  /** Nome amigável do Expert — o provider nunca deve hardcodar identidade de um Expert específico. */
  expertName: string;
  expertVersion: string;
  /** Instruções versionadas do Expert (ver experts/<expert>/identity.ts). */
  instructions: string;
  /**
   * Tipo de análise que o Expert espera desta chamada — cada Expert decide
   * quais valores fazem sentido para si (ver sua própria ExpertAnalysisType
   * relevante). O provider apenas ecoa/usa este valor, nunca escolhe por
   * conta própria qual análise está sendo pedida.
   */
  analysisType: ExpertAnalysisType;
  context: EventAnalysisContext;
}

/**
 * Resultado bruto do provider — ainda NÃO validado como ExpertAssessment.
 * A validação/normalização final é sempre responsabilidade do Expert
 * (ver schemas/validate-expert-assessment.ts), nunca do provider.
 */
export interface AiProviderResponse {
  /** Identificador do provider que gerou a resposta (ex.: "fake", "anthropic"). */
  providerId: string;
  /** Nome do modelo, quando aplicável (ex.: "claude-sonnet-5"). Nulo para o fake provider. */
  model: string | null;
  /** Saída ainda não validada — deve ter o formato de ExpertAssessment, mas pode estar incorreta. */
  output: unknown;
}

export interface AiProvider {
  readonly id: string;
  generateAssessment(request: AiProviderRequest): Promise<AiProviderResponse>;
}
