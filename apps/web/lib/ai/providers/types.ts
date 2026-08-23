// Abstração de provider de IA — nenhum Expert conhece Anthropic/OpenAI/
// Gemini diretamente. Isso permite trocar/adicionar provider real sem
// alterar nenhum Expert, e permite testar Experts inteiramente com o
// FakeAiProvider (determinístico, sem custo, sem rede).

import type { EventAnalysisContext, ProjectAnalysisContext } from "../context/types";
import type { ExpertAnalysisType, ExpertId, ExpertSeverity } from "../types";
import type { ExpertQueryScope } from "../query/types";

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
  /**
   * JSON Schema (formato "input_schema" de tool-use da Anthropic, mas
   * generalizável) descrevendo exatamente a saída estruturada esperada
   * (ex.: CommercialDirectorAssessment). Fornecido pelo próprio Expert
   * (ver experts/<expert>/json-schema.ts) — o provider nunca hardcoda o
   * formato de um Expert específico, apenas usa o schema recebido para
   * pedir/forçar saída estruturada quando o provider real suportar isso.
   * O FakeAiProvider ignora este campo.
   */
  outputSchema: Record<string, unknown>;
}

/**
 * Requisição de consulta conversacional ("Perguntar ao Diretor Comercial
 * IA" e futuros). Exatamente um entre eventContext/projectContext é
 * preenchido, conforme `scope` — nunca ambos, nunca nenhum.
 */
export interface AiProviderQueryRequest {
  expertId: ExpertId;
  expertName: string;
  expertVersion: string;
  instructions: string;
  scope: ExpertQueryScope;
  question: string;
  eventContext: EventAnalysisContext | null;
  projectContext: ProjectAnalysisContext | null;
  /** Ver AiProviderRequest.outputSchema — mesma ideia, para ExpertQueryResponse (genérico, ver query/json-schema.ts). */
  outputSchema: Record<string, unknown>;
}

/**
 * Posição condensada de um Expert já consultado — a unidade de entrada da
 * curadoria executiva do CEO IA (ver experts/ceo/consolidate.ts). Nunca a
 * ExpertQueryResponse inteira (evita reenviar rascunhos/baseLegal/
 * baseContratual completos ao consolidar — mesmo princípio de "não
 * despejar tudo no modelo" já aplicado pelos Context Builders).
 */
export interface AiProviderExpertPosition {
  expertId: ExpertId;
  expertName: string;
  severity: ExpertSeverity;
  interpretacao: string;
  riscos: string[];
  recomendacoes: string[];
  informacoesFaltantes: string[];
}

/**
 * Requisição de consolidação executiva (CEO IA — ver
 * experts/ceo/consolidate.ts). Distinta de AiProviderRequest/
 * AiProviderQueryRequest: a "fonte de fatos" aqui não é um contexto do
 * projeto, e sim as posições já produzidas pelos demais Experts nesta
 * mesma rodada de curadoria (nunca inferidas, sempre as que realmente
 * rodaram).
 */
export interface AiProviderCurationRequest {
  expertId: ExpertId;
  expertName: string;
  expertVersion: string;
  instructions: string;
  situationSummary: string;
  positions: AiProviderExpertPosition[];
  outputSchema: Record<string, unknown>;
}

/**
 * Resultado bruto do provider — ainda NÃO validado como ExpertAssessment
 * nem como ExpertQueryResponse. A validação/normalização final é sempre
 * responsabilidade do Expert (ver schemas/), nunca do provider.
 */
export interface AiProviderResponse {
  /** Identificador do provider que gerou a resposta (ex.: "fake", "anthropic"). */
  providerId: string;
  /** Nome do modelo, quando aplicável (ex.: "claude-sonnet-5"). Nulo para o fake provider. */
  model: string | null;
  /** Saída ainda não validada — deve ter o formato esperado pelo Expert, mas pode estar incorreta. */
  output: unknown;
  /** Motivo de parada da API real (ex.: "end_turn", "max_tokens", "refusal"). Ausente/null para o fake provider. */
  stopReason?: string | null;
  /** Uso de tokens da API real, quando disponível — nunca inventado. Ausente/null para o fake provider. */
  usage?: { inputTokens: number | null; outputTokens: number | null } | null;
}

export interface AiProvider {
  readonly id: string;
  generateAssessment(request: AiProviderRequest): Promise<AiProviderResponse>;
  /** Responde uma consulta conversacional (escopo PROJECT/EVENT nesta fase). */
  answerQuery(request: AiProviderQueryRequest): Promise<AiProviderResponse>;
  /** Consolida posições de múltiplos Experts em uma curadoria executiva (CEO IA — ver experts/ceo/consolidate.ts). */
  consolidateExecutiveCuration(request: AiProviderCurationRequest): Promise<AiProviderResponse>;
}
