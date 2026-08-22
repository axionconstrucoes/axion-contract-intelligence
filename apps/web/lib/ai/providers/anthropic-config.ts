// Configuração fail-closed do AnthropicAiProvider — mesmo padrão já
// usado por AXION_EMAIL_PROVIDER=gmail (ver apps/web/lib/email/gmail-auth.ts,
// loadGmailConfig): lança erro imediatamente se algo obrigatório estiver
// ausente/inválido, nunca completa parcialmente, nunca loga os valores
// (nem a chave, nem prefixo dela).

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;

function readPositiveNumber(raw: string | undefined, envVarName: string, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envVarName} inválido: "${raw}". Deve ser um número positivo.`);
  }
  return parsed;
}

/**
 * FAIL CLOSED: ANTHROPIC_API_KEY e ANTHROPIC_MODEL são obrigatórios —
 * nenhum modelo é escolhido silenciosamente. ANTHROPIC_MAX_TOKENS e
 * ANTHROPIC_TIMEOUT_MS são opcionais, com defaults conservadores.
 */
export function loadAnthropicConfig(): AnthropicProviderConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;

  const missing: string[] = [];
  if (!apiKey) missing.push("ANTHROPIC_API_KEY");
  if (!model) missing.push("ANTHROPIC_MODEL");

  if (missing.length > 0) {
    throw new Error(
      `Configuração do AnthropicAiProvider incompleta — variáveis ausentes: ${missing.join(", ")}. ` +
        "AXION_AI_PROVIDER=anthropic não pode operar sem configuração completa (fail closed). " +
        "Nenhum modelo é escolhido silenciosamente."
    );
  }

  return {
    apiKey: apiKey!,
    model: model!,
    maxTokens: readPositiveNumber(process.env.ANTHROPIC_MAX_TOKENS, "ANTHROPIC_MAX_TOKENS", DEFAULT_MAX_TOKENS),
    timeoutMs: readPositiveNumber(process.env.ANTHROPIC_TIMEOUT_MS, "ANTHROPIC_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  };
}
