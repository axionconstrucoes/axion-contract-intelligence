// Corpo do live test do Diretor Comercial IA + Anthropic, extraído para
// um módulo separado e injetável (dependências passadas por parâmetro)
// justamente para poder ser testado offline (scripts/test-provider-per-expert.mjs
// / scripts/test-anthropic-provider.mjs) sem nunca chamar rede — e para
// permitir diagnosticar, pelos marcadores "LIVE STEP N/7", exatamente em
// qual etapa uma execução real trava (Context Builder/Supabase vs.
// Anthropic/rede vs. validação de schema vs. impressão do resultado).
//
// Nunca imprime API key, prompt integral, documentos/e-mails integrais
// nem headers de autenticação — só os marcadores e metadata estruturada.

/**
 * @param {object} deps
 * @param {() => Promise<unknown>} deps.buildEventContext
 * @param {() => { id: string, answerQuery: Function }} deps.resolveProvider
 * @param {(output: unknown, expected: unknown) => unknown} deps.validateResponse
 * @param {{ expertId: string, expertName: string, expertVersion: string, instructions: string, outputSchema: Record<string, unknown> }} deps.identity
 * @param {string} deps.question
 * @param {(...args: unknown[]) => void} [deps.log]
 */
export async function runAnthropicCommercialDirectorLiveTest({
  buildEventContext,
  resolveProvider,
  validateResponse,
  identity,
  question,
  log = console.log,
}) {
  log("LIVE STEP 1/7: loading event context");
  const eventContext = await buildEventContext();
  log("LIVE STEP 2/7: event context loaded");

  log("LIVE STEP 3/7: resolving AI provider");
  const provider = resolveProvider();
  log(`LIVE STEP 3/7: AI provider resolved (id=${provider.id})`);

  log("LIVE STEP 4/7: starting Anthropic request");
  const response = await provider.answerQuery({
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
    instructions: identity.instructions,
    scope: "EVENT",
    question,
    eventContext,
    projectContext: null,
    outputSchema: identity.outputSchema,
  });
  log(`LIVE STEP 5/7: Anthropic response received (stopReason=${response.stopReason ?? "n/a"})`);

  log("LIVE STEP 6/7: validating structured response");
  const validated = validateResponse(response.output, {
    expertId: identity.expertId,
    expertName: identity.expertName,
    expertVersion: identity.expertVersion,
  });
  log("LIVE STEP 6/7: structured response validated");

  log("LIVE STEP 7/7: result ready");

  return {
    response: validated,
    audit: {
      providerId: response.providerId,
      model: response.model,
      stopReason: response.stopReason ?? null,
      usage: response.usage ?? null,
    },
  };
}

/**
 * Extrai só os campos seguros de um erro para log (nunca a mensagem
 * pode conter a chave — os providers já garantem isso — mas aqui também
 * nunca imprimimos stack completo nem propriedades arbitrárias).
 */
export function describeErrorSafely(error) {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: String(error), status: null, code: null };
  }
  return {
    name: error.anthropicOriginalName ?? error.name ?? "Error",
    message: error.message,
    status: error.anthropicStatus ?? null,
    code: error.anthropicCode ?? null,
  };
}
