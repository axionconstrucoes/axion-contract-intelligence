// Núcleo de instanciação de provider por nome — usado tanto pela seleção
// global de compatibilidade (get-ai-provider.ts) quanto pela seleção por
// Expert (resolve-provider-for-expert.ts). Nunca duplicar esta lógica em
// dois lugares — extraída aqui justamente para evitar que as duas
// seleções divirjam silenciosamente sobre quais valores são válidos.
//
// Fail-closed: "fake" e "anthropic" são os únicos valores implementados
// nesta fase; qualquer outro valor falha explicitamente, citando de onde
// veio a configuração (`sourceDescription`) para a mensagem ser
// auditável mesmo quando múltiplas variáveis de ambiente podem ter
// influenciado a escolha.

import { createAnthropicAiProvider } from "./anthropic-provider";
import { createFakeAiProvider } from "./fake-provider";
import type { AiProvider } from "./types";

const KNOWN_UNIMPLEMENTED_PROVIDERS = ["openai", "gemini"];

export function instantiateAiProviderByName(raw: string, sourceDescription: string): AiProvider {
  const normalized = raw.trim().toLowerCase();

  if (normalized === "fake") {
    return createFakeAiProvider();
  }

  if (normalized === "anthropic") {
    return createAnthropicAiProvider();
  }

  if (KNOWN_UNIMPLEMENTED_PROVIDERS.includes(normalized)) {
    throw new Error(
      `${sourceDescription}="${normalized}" ainda não está implementado nesta fase. Nenhum provider real de IA ` +
        `foi conectado para "${normalized}" — configure "fake" ou "anthropic" (com ANTHROPIC_API_KEY/ANTHROPIC_MODEL), ` +
        "ou implemente este provider real antes de usar este valor."
    );
  }

  throw new Error(`${sourceDescription} inválido: "${normalized}". Valores permitidos nesta fase: "fake" ou "anthropic".`);
}
