// Primeiro provider real de IA do ACC — chama a API Anthropic
// diretamente pelo SDK oficial (@anthropic-ai/sdk), nunca via Claude
// Code CLI/SDK. Ver docs/ai/anthropic-provider.md para a documentação
// completa (configuração, saída estruturada, fail-closed, limites).
//
// DELIBERADAMENTE RESTRITO NESTA FASE: diferente do FakeAiProvider
// (genérico por design — nunca conhece qual Expert está chamando), o
// AnthropicAiProvider só está autorizado a operar para o Diretor
// Comercial IA (commercial-director). Isto é uma decisão de produto
// explícita desta fase, aplicada em runtime (ANTHROPIC_ALLOWED_EXPERT_IDS),
// não uma limitação técnica — nunca ativa CEO IA, Consultor Jurídico IA,
// Diretor de Planejamento IA nem Diretor de ESG IA, mesmo que
// AXION_AI_PROVIDER=anthropic esteja configurado globalmente.
//
// Saída estruturada: usa tool-use forçado (tool_choice fixo em uma
// única ferramenta cujo input_schema é o JSON Schema do Expert
// chamador) em vez de pedir JSON em texto livre + parse manual — evita
// regex frágil e qualquer prosa ao redor do JSON. A validação real e
// definitiva da saída continua sendo sempre os validadores TypeScript
// existentes (validateExpertAssessment/validateExpertQueryResponse/
// validateCommercialDirectorAssessment) — nunca uma resposta
// parcialmente validada é tratada como análise oficial.

import Anthropic from "@anthropic-ai/sdk";
import type { ExpertId } from "../types";
import { loadAnthropicConfig, type AnthropicProviderConfig } from "./anthropic-config";
import type { AiProvider, AiProviderQueryRequest, AiProviderRequest, AiProviderResponse } from "./types";

const ANTHROPIC_ALLOWED_EXPERT_IDS: ExpertId[] = ["commercial-director"];
const ANTHROPIC_MAX_RETRIES = 2;
const TOOL_NAME = "emit_expert_structured_output";

interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicToolUseBlock extends AnthropicContentBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

interface AnthropicMessageResult {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Subconjunto mínimo do client real do SDK que este módulo usa — permite
 * injetar um client falso nos testes (scripts/test-anthropic-provider.mjs)
 * sem depender de rede nem de mocks do módulo inteiro. `options.signal` é
 * repassado para que um client real possa cancelar a requisição quando o
 * timeout de aplicação (ver callAnthropic) expira — mas a garantia real
 * de que a chamada nunca fica pendurada indefinidamente NÃO depende do
 * client honrar o signal (ver Promise.race em callAnthropic).
 */
export interface AnthropicMessagesClient {
  messages: {
    create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<AnthropicMessageResult>;
  };
}

/** Campos estruturados preservados no erro final para quem chama poder logar sem reparsear a mensagem (nunca a chave). */
export interface AnthropicWrappedError extends Error {
  anthropicStatus: number | null;
  anthropicCode: string | null;
  anthropicOriginalName: string | null;
}

export interface AnthropicAiProviderOverrides {
  client?: AnthropicMessagesClient;
  config?: AnthropicProviderConfig;
}

function assertExpertAllowed(expertId: ExpertId): void {
  if (!ANTHROPIC_ALLOWED_EXPERT_IDS.includes(expertId)) {
    throw new Error(
      `AnthropicAiProvider ainda não está autorizado para o Expert "${expertId}" nesta fase — somente ` +
        `${ANTHROPIC_ALLOWED_EXPERT_IDS.join(", ")}. Não conectar CEO IA, Consultor Jurídico IA, Diretor de ` +
        "Planejamento IA nem Diretor de ESG IA a um LLM real ainda (decisão de produto, não limitação técnica)."
    );
  }
}

function buildGovernanceReminder(): string {
  return `
## Governança obrigatória desta chamada

IA ANALISA → IA SUGERE → IA PODE REDIGIR → HUMANO REVISA → HUMANO APROVA OU REJEITA → SISTEMA EXECUTA SOMENTE O AUTORIZADO.

requiresHumanReview deve ser sempre true na sua resposta. Você NÃO pode: aprovar, enviar e-mail, assumir
compromisso, conceder desconto, aceitar condição comercial, alterar contrato, criar obrigação vinculante,
executar action request, alterar SLA, alterar Event Ledger, ou escrever diretamente no banco — você apenas
produz uma sugestão estruturada para revisão humana.

Você só pode tratar como fato do projeto os dados explicitamente fornecidos no CONTEXTO desta mensagem. Nunca
invente preço, desconto, margem, valor máximo/mínimo, percentual, condição de pagamento ou prazo autorizado —
quando um destes faltar, use exatamente "NÃO DISPONÍVEL — NECESSÁRIA DEFINIÇÃO HUMANA." no campo apropriado
(status REQUIRES_HUMAN_DEFINITION ou UNAVAILABLE, conforme o caso — nunca invente value/estimatedValue fora de
AVAILABLE).

Se não houver corpus normativo legal oficial carregado no contexto, baseLegal deve ser uma lista vazia — nunca
cite um artigo de lei de memória.

Responda EXCLUSIVAMENTE chamando a ferramenta "${TOOL_NAME}" com o JSON estruturado exigido — nunca em texto livre,
nunca com prosa antes ou depois da chamada de ferramenta.
`.trim();
}

function buildSystemPrompt(instructions: string): string {
  return `${instructions}\n\n${buildGovernanceReminder()}`;
}

function serializeContext(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function extractToolUseInput(message: AnthropicMessageResult): unknown {
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "Resposta do Anthropic truncada (stop_reason=max_tokens) antes de concluir o JSON estruturado — aumente " +
        "ANTHROPIC_MAX_TOKENS ou reduza o contexto. Uma resposta truncada nunca é tratada como avaliação válida."
    );
  }
  if (message.stop_reason === "refusal") {
    throw new Error(
      "O modelo recusou responder a esta solicitação (stop_reason=refusal). Nenhuma análise foi produzida — revise manualmente."
    );
  }

  const toolUse = message.content.find(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME
  );

  if (!toolUse) {
    throw new Error(
      `Resposta do Anthropic não trouxe a chamada de ferramenta estruturada esperada ("${TOOL_NAME}") — ` +
        `stop_reason: ${String(message.stop_reason)}. Nenhuma saída parcialmente validada é aceita como análise oficial.`
    );
  }

  return toolUse.input;
}

const AXION_TIMEOUT_ERROR_NAME = "AxionTimeoutError";

function makeWrappedError(
  message: string,
  fields: { anthropicStatus?: number | null; anthropicCode?: string | null; anthropicOriginalName?: string | null }
): AnthropicWrappedError {
  return Object.assign(new Error(message), {
    anthropicStatus: fields.anthropicStatus ?? null,
    anthropicCode: fields.anthropicCode ?? null,
    anthropicOriginalName: fields.anthropicOriginalName ?? null,
  }) as AnthropicWrappedError;
}

/**
 * Nunca inclui a API key nem qualquer valor de configuração na mensagem
 * de erro. Preserva status/code/name como campos estruturados no erro
 * retornado (AnthropicWrappedError) — quem chama pode logar
 * `error.anthropicStatus`/`error.anthropicCode`/`error.anthropicOriginalName`
 * sem precisar reparsear a mensagem.
 */
function wrapAnthropicError(error: unknown): AnthropicWrappedError {
  // Idempotente: um erro já produzido por raceWithHardTimeout (timeout de
  // aplicação) já é um AnthropicWrappedError — nunca re-envelopar (evita
  // uma mensagem redundante "Falha ao chamar a API Anthropic: Timeout...").
  if (error instanceof Error && "anthropicOriginalName" in error) {
    return error as AnthropicWrappedError;
  }

  const err = error as { status?: number; name?: string; message?: string; code?: string; type?: string } | null | undefined;
  const status = typeof err?.status === "number" ? err.status : null;
  const name = err?.name ?? "";
  const code = err?.code ?? err?.type ?? null;

  if (name === AXION_TIMEOUT_ERROR_NAME || name.toLowerCase().includes("timeout")) {
    return makeWrappedError(
      `Timeout ao chamar a API Anthropic (ver ANTHROPIC_TIMEOUT_MS). Nenhuma análise foi produzida. Detalhe técnico: ${name}`,
      { anthropicStatus: status, anthropicCode: code, anthropicOriginalName: name }
    );
  }
  if (status === 429) {
    return makeWrappedError(
      "Rate limit da API Anthropic atingido (HTTP 429), mesmo após as tentativas automáticas do SDK. " +
        "Nenhuma análise foi produzida — tente novamente mais tarde.",
      { anthropicStatus: status, anthropicCode: code, anthropicOriginalName: name || null }
    );
  }
  if (status !== null && status >= 500) {
    return makeWrappedError(
      `Erro do servidor Anthropic (HTTP ${status}), mesmo após as tentativas automáticas do SDK. Nenhuma análise foi produzida.`,
      { anthropicStatus: status, anthropicCode: code, anthropicOriginalName: name || null }
    );
  }
  if (status !== null) {
    return makeWrappedError(
      `Erro da API Anthropic (HTTP ${status}): ${err?.message ?? "sem detalhe"}. Este tipo de erro não é repetido automaticamente.`,
      { anthropicStatus: status, anthropicCode: code, anthropicOriginalName: name || null }
    );
  }
  return makeWrappedError(`Falha ao chamar a API Anthropic: ${err?.message ?? String(error)}`, {
    anthropicStatus: null,
    anthropicCode: code,
    anthropicOriginalName: name || null,
  });
}

/**
 * Prazo rígido de aplicação para a chamada inteira (incluindo qualquer
 * retry interno do SDK) — NUNCA depende só do client honrar o timeout.
 * O incidente do primeiro live test (processo aparentemente pendurado,
 * finalizado só por Ctrl+C) motivou esta defesa: a documentação do SDK
 * afirma explicitamente que "request timeouts are retried by default",
 * ou seja, o timeout por tentativa do client pode, na prática, ser
 * multiplicado por (1 + maxRetries) antes de desistir — sem nenhum
 * limite de parede total. Aqui, o `Promise.race` garante que
 * `callAnthropic` sempre se resolve (sucesso ou erro) dentro de
 * `timeoutMs`, não importa o que o client faça internamente. O
 * AbortSignal também é repassado ao client (quando ele o suporta) como
 * cortesia, para não deixar uma requisição HTTP pendurada em segundo
 * plano depois que já desistimos de esperar por ela.
 */
function raceWithHardTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(makeWrappedError(`Timeout de aplicação após ${timeoutMs}ms aguardando a API Anthropic.`, { anthropicOriginalName: AXION_TIMEOUT_ERROR_NAME }));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function callAnthropic(
  client: AnthropicMessagesClient,
  config: Pick<AnthropicProviderConfig, "model" | "maxTokens" | "timeoutMs">,
  systemPrompt: string,
  userContent: string,
  outputSchema: Record<string, unknown>
): Promise<AiProviderResponse> {
  const controller = new AbortController();

  let message: AnthropicMessageResult;
  try {
    message = await raceWithHardTimeout(
      client.messages.create(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
          tools: [
            {
              name: TOOL_NAME,
              description: "Emite a saída estruturada exigida pelo ACC para este Expert — nunca texto livre.",
              input_schema: outputSchema,
            },
          ],
          tool_choice: { type: "tool", name: TOOL_NAME },
          // stream nunca é usado nesta fase — o tool-use forçado precisa da mensagem completa para extrair `input`.
        },
        { signal: controller.signal }
      ),
      config.timeoutMs,
      controller
    );
  } catch (error) {
    throw wrapAnthropicError(error);
  }

  const output = extractToolUseInput(message);

  return {
    providerId: "anthropic",
    model: config.model,
    output,
    stopReason: message.stop_reason,
    usage: message.usage
      ? { inputTokens: message.usage.input_tokens ?? null, outputTokens: message.usage.output_tokens ?? null }
      : null,
  };
}

/**
 * Cria o provider real Anthropic. Fail-closed: sem `overrides.config`,
 * carrega a configuração de environment variables imediatamente
 * (loadAnthropicConfig) — nunca completa parcialmente. `overrides`
 * existe só para testes (injeção de config/client falsos, sem rede).
 */
export function createAnthropicAiProvider(overrides?: AnthropicAiProviderOverrides): AiProvider {
  const config = overrides?.config ?? loadAnthropicConfig();
  const client: AnthropicMessagesClient =
    overrides?.client ??
    (new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: ANTHROPIC_MAX_RETRIES,
    }) as unknown as AnthropicMessagesClient);

  return {
    id: "anthropic",

    async generateAssessment(request: AiProviderRequest): Promise<AiProviderResponse> {
      assertExpertAllowed(request.expertId);

      const systemPrompt = buildSystemPrompt(request.instructions);
      const userContent = [
        `Tipo de análise solicitada: ${request.analysisType}`,
        "",
        "CONTEXTO AUTORIZADO DO PROJETO (única fonte de fatos permitida — nunca use conhecimento geral para preencher fatos deste projeto):",
        serializeContext(request.context),
      ].join("\n");

      return callAnthropic(client, config, systemPrompt, userContent, request.outputSchema);
    },

    async answerQuery(request: AiProviderQueryRequest): Promise<AiProviderResponse> {
      assertExpertAllowed(request.expertId);

      const systemPrompt = buildSystemPrompt(request.instructions);
      const contextPayload = request.eventContext
        ? { scope: "EVENT", eventContext: request.eventContext }
        : { scope: "PROJECT", projectContext: request.projectContext };

      const userContent = [
        `Pergunta do usuário: ${request.question}`,
        "",
        "CONTEXTO AUTORIZADO (única fonte de fatos permitida — nunca use conhecimento geral para preencher fatos deste projeto):",
        serializeContext(contextPayload),
      ].join("\n");

      return callAnthropic(client, config, systemPrompt, userContent, request.outputSchema);
    },
  };
}
