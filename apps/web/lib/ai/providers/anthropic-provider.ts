// Primeiro provider real de IA do ACC — chama a API Anthropic
// diretamente pelo SDK oficial (@anthropic-ai/sdk), nunca via Claude
// Code CLI/SDK. Ver docs/ai/anthropic-provider.md para a documentação
// completa (configuração, saída estruturada, fail-closed, limites).
//
// Autorizado para os cinco Experts oficiais do ACC
// (ANTHROPIC_ALLOWED_EXPERT_IDS) — cada um só é efetivamente ativado
// quando sua própria variável de provider resolve para "anthropic" (ver
// resolve-provider-for-expert.ts); ativar um nunca ativa os demais.
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
import type {
  AiProvider,
  AiProviderCurationRequest,
  AiProviderQueryRequest,
  AiProviderRequest,
  AiProviderResponse,
} from "./types";

const ANTHROPIC_ALLOWED_EXPERT_IDS: ExpertId[] = [
  "commercial-director",
  "esg-director",
  "legal-consultant",
  "planning-director",
  "ceo",
];
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
        `${ANTHROPIC_ALLOWED_EXPERT_IDS.join(", ")}.`
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

/**
 * Campos exigidos pelo schema que faltaram ou vieram vazios na saída.
 * Só olha o primeiro nível: é o suficiente para dizer ao modelo o que
 * refazer, e a validação de verdade continua sendo os validadores
 * TypeScript depois (nunca esta função).
 */
/**
 * ESCOPO DESTA CHECAGEM — leia antes de confiar nela.
 *
 * `findSchemaViolations` NÃO valida o JSON Schema inteiro. Ela detecta
 * apenas o subconjunto de problemas ESTRUTURAIS E REPARÁVEIS do primeiro
 * nível da saída, que é o que faz sentido pedir ao modelo para refazer:
 *
 *   - campo de `required` ausente (undefined);
 *   - `null` quando o schema NÃO admite null;
 *   - string vazia quando o schema não declara `minLength: 0`;
 *   - tipo errado (string onde se espera array, número onde se espera
 *     objeto, etc.);
 *   - valor fora do `enum` declarado;
 *   - array obrigatório vazio quando o schema exige `minItems`;
 *   - objeto que não traz os próprios `required` internos (um nível).
 *
 * O que ela deliberadamente NÃO faz: validar `$ref`, `allOf`,
 * `patternProperties`, `format`, aninhamento profundo, unicidade de
 * array, dependências entre campos. Nada disso vira repetição.
 *
 * A validação que DECIDE se a resposta é aceita continua sendo, sempre,
 * o validador TypeScript do Expert (validate-expert-query-response.ts /
 * validate-expert-assessment.ts), que roda depois e falha fechado. Esta
 * função só escolhe se vale a pena gastar UMA segunda chamada.
 *
 * Casos NÃO reparáveis por repetição — tratados antes, em
 * extractToolUseInput, que LANÇA e nunca chega aqui:
 *   - `stop_reason: "max_tokens"` (resposta truncada);
 *   - `stop_reason: "refusal"`;
 *   - ausência do bloco tool_use esperado.
 * Repetir esses casos com o mesmo contexto tenderia ao mesmo resultado,
 * e a mensagem própria de cada um é mais útil que uma nova tentativa.
 */
export interface SchemaViolation {
  field: string;
  problem: string;
}

function typeMatches(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function schemaAllowsNull(fieldSchema: unknown): boolean {
  if (typeof fieldSchema !== "object" || fieldSchema === null) return false;
  const schema = fieldSchema as Record<string, unknown>;

  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  if ("const" in schema && schema.const === null) return true;

  for (const key of ["oneOf", "anyOf"]) {
    const variants = schema[key];
    if (Array.isArray(variants) && variants.some((variant) => schemaAllowsNull(variant))) return true;
  }

  return false;
}

/** Variantes de oneOf/anyOf que não são `null` — usadas para checar tipo. */
function nonNullVariants(fieldSchema: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const key of ["oneOf", "anyOf"]) {
    const variants = fieldSchema[key];
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      if (typeof variant === "object" && variant !== null && (variant as Record<string, unknown>).type !== "null") {
        out.push(variant as Record<string, unknown>);
      }
    }
  }
  return out;
}

function violationFor(field: string, value: unknown, fieldSchema: unknown): SchemaViolation | null {
  // Campo obrigatorio sem `properties` declarado: ainda assim uma string
  // vazia e uma violacao — "obrigatorio" nunca significa "pode vir em
  // branco".
  if (typeof fieldSchema !== "object" || fieldSchema === null) {
    if (typeof value === "string" && value.trim() === "") return { field, problem: "string vazia" };
    return null;
  }
  const schema = fieldSchema as Record<string, unknown>;

  // `const` declarado (ex.: requiresHumanReview: true).
  if ("const" in schema && value !== schema.const) {
    return { field, problem: `deve ser exatamente ${JSON.stringify(schema.const)}` };
  }

  // Tipo: aceita `type` direto ou a variante não-nula de oneOf/anyOf.
  const variants = nonNullVariants(schema);
  const candidates = variants.length > 0 ? variants : [schema];
  const typeOk = candidates.some((candidate) => {
    const expected = candidate.type;
    if (typeof expected === "string") return typeMatches(value, expected);
    if (Array.isArray(expected)) return expected.some((t) => typeof t === "string" && typeMatches(value, t));
    return true;
  });

  if (!typeOk) {
    const expected = candidates.map((candidate) => candidate.type).filter(Boolean).join(" | ");
    return { field, problem: `tipo inválido (esperado ${expected || "conforme o schema"})` };
  }

  const effective = candidates.find((candidate) => {
    const expected = candidate.type;
    if (typeof expected === "string") return typeMatches(value, expected);
    if (Array.isArray(expected)) return expected.some((t) => typeof t === "string" && typeMatches(value, t));
    return true;
  }) ?? schema;

  // Enum.
  const enumValues = effective.enum ?? schema.enum;
  if (Array.isArray(enumValues) && !enumValues.includes(value as never)) {
    return { field, problem: `valor fora do conjunto permitido (${enumValues.join(", ")})` };
  }

  // String vazia — proibida salvo minLength: 0 explícito.
  if (typeof value === "string" && value.trim() === "" && effective.minLength !== 0 && schema.minLength !== 0) {
    return { field, problem: "string vazia" };
  }

  // Array obrigatoriamente não vazio.
  if (Array.isArray(value)) {
    const minItems = typeof effective.minItems === "number" ? effective.minItems : schema.minItems;
    if (typeof minItems === "number" && value.length < minItems) {
      return { field, problem: `array com menos de ${minItems} item(ns)` };
    }
  }

  // Objeto incompleto — um nível de `required` interno.
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const innerRequired = effective.required ?? schema.required;
    if (Array.isArray(innerRequired)) {
      const record = value as Record<string, unknown>;
      const faltando = (innerRequired as string[]).filter((key) => record[key] === undefined);
      if (faltando.length > 0) {
        return { field, problem: `objeto incompleto (faltam: ${faltando.join(", ")})` };
      }
    }
  }

  return null;
}

/**
 * Violações estruturais reparáveis no primeiro nível. Ver o bloco de
 * ESCOPO acima: isto NÃO é um validador de JSON Schema.
 */
export function findSchemaViolations(
  output: unknown,
  outputSchema: Record<string, unknown>
): SchemaViolation[] {
  const required = Array.isArray(outputSchema.required) ? (outputSchema.required as string[]) : [];
  if (required.length === 0) return [];

  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return [{ field: "(raiz)", problem: "a saída não é um objeto JSON" }];
  }

  const record = output as Record<string, unknown>;
  const properties =
    typeof outputSchema.properties === "object" && outputSchema.properties !== null
      ? (outputSchema.properties as Record<string, unknown>)
      : {};

  const violations: SchemaViolation[] = [];

  for (const field of required) {
    const value = record[field];
    const fieldSchema = properties[field];

    if (value === undefined) {
      violations.push({ field, problem: "ausente" });
      continue;
    }

    if (value === null) {
      if (!schemaAllowsNull(fieldSchema)) violations.push({ field, problem: "null não permitido pelo schema" });
      continue;
    }

    const violation = violationFor(field, value, fieldSchema);
    if (violation) violations.push(violation);
  }

  return violations;
}

/** Compatibilidade: só os nomes dos campos com violação. */
export function findMissingRequiredFields(
  output: unknown,
  outputSchema: Record<string, unknown>
): string[] {
  return findSchemaViolations(output, outputSchema).map((violation) => violation.field);
}

function sumUsage(
  first: AiProviderResponse["usage"],
  second: AiProviderResponse["usage"]
): AiProviderResponse["usage"] {
  if (!first) return second ?? null;
  if (!second) return first;

  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

  return {
    inputTokens: add(first.inputTokens, second.inputTokens),
    outputTokens: add(first.outputTokens, second.outputTokens),
  };
}

/** Uma única chamada — sem repetição alguma. */
async function callAnthropicOnce(
  client: AnthropicMessagesClient,
  config: Pick<AnthropicProviderConfig, "model" | "maxTokens" | "timeoutMs">,
  systemPrompt: string,
  messages: Array<{ role: "user"; content: string }>,
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
          messages,
          tools: [
            {
              name: TOOL_NAME,
              description: "Emite a saída estruturada exigida pelo ACC para este Expert — nunca texto livre.",
              input_schema: outputSchema,
              // strict: a API passa a garantir a validação do schema da
              // ferramenta (ver Tool.strict no @anthropic-ai/sdk
              // instalado: "When true, guarantees schema validation on
              // tool names and inputs"). Reduz drasticamente a saída
              // incompleta — mas NÃO substitui os validadores TypeScript,
              // que continuam rodando depois: uma resposta truncada por
              // max_tokens, por exemplo, nunca chega a ser validada pela
              // API, e é justamente esse caso que produzia
              // "Campo obrigatório ausente ou vazio: severity".
              strict: true,
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
    // Autenticação, rede, timeout e rate limit saem por AQUI — e são
    // lançados, nunca repetidos por este módulo (o SDK já tem sua própria
    // política de retry para o que faz sentido repetir).
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
 * Chamada com NO MÁXIMO uma repetição, e só quando a saída violar o
 * schema (campo obrigatório ausente ou vazio). Nunca repete por erro de
 * autenticação, rede, timeout ou rate limit — esses lançam em
 * callAnthropicOnce e nem chegam aqui.
 *
 * A repetição reenvia EXATAMENTE o mesmo contexto autorizado e acrescenta
 * quais campos faltaram. Se a segunda resposta também violar o schema,
 * devolvemos a segunda saída como está: quem decide é o validador
 * TypeScript do Expert, que falha fechado com mensagem própria. Nada é
 * inventado aqui — em especial, `severity` nunca é preenchido por este
 * código, e `required` não é afrouxado.
 *
 * Loop infinito é impossível por construção: este caminho chama
 * callAnthropicOnce duas vezes e nunca a si mesmo.
 */
async function callAnthropic(
  client: AnthropicMessagesClient,
  config: Pick<AnthropicProviderConfig, "model" | "maxTokens" | "timeoutMs">,
  systemPrompt: string,
  userContent: string,
  outputSchema: Record<string, unknown>
): Promise<AiProviderResponse> {
  const first = await callAnthropicOnce(
    client,
    config,
    systemPrompt,
    [{ role: "user", content: userContent }],
    outputSchema
  );

  const violations = findSchemaViolations(first.output, outputSchema);
  if (violations.length === 0) return first;

  const descricao = violations.map((violation) => `${violation.field} (${violation.problem})`).join("; ");
  console.error("[anthropic] saída fora do schema, repetindo uma única vez:", descricao);

  const retryContent = [
    userContent,
    "",
    "A resposta anterior foi RECUSADA porque a chamada de ferramenta veio fora do schema exigido.",
    `Problemas encontrados: ${descricao}.`,
    "Responda de novo, com TODOS os campos obrigatórios preenchidos, usando exatamente o mesmo contexto autorizado " +
      "acima. Não invente fato nenhum para preencher um campo — se algo não puder ser determinado a partir do " +
      "contexto, use o campo apropriado de informação faltante.",
  ].join("\n");

  const second = await callAnthropicOnce(
    client,
    config,
    systemPrompt,
    [{ role: "user", content: retryContent }],
    outputSchema
  );

  return {
    ...second,
    // Uso acumulado das DUAS tentativas — a auditoria nunca subestima o custo.
    usage: sumUsage(first.usage, second.usage),
  };
}

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

    async consolidateExecutiveCuration(request: AiProviderCurationRequest): Promise<AiProviderResponse> {
      assertExpertAllowed(request.expertId);

      const systemPrompt = buildSystemPrompt(request.instructions);
      const userContent = [
        `Situação a consolidar: ${request.situationSummary}`,
        "",
        "POSIÇÕES JÁ PRODUZIDAS PELOS ESPECIALISTAS NESTA RODADA (única fonte de fatos permitida — nunca invente a " +
          "posição de um Expert que não está listado aqui):",
        serializeContext(request.positions),
      ].join("\n");

      return callAnthropic(client, config, systemPrompt, userContent, request.outputSchema);
    },
  };
}
