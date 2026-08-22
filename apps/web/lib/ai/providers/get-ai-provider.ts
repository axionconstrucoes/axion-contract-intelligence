// Seleção de provider de IA — fail-closed, mesmo padrão já usado por
// AXION_EMAIL_PROVIDER (ver apps/web/lib/email/gmail-auth.ts).
//
// Nunca escolhe silenciosamente Anthropic/OpenAI/Gemini: só existe "fake"
// implementado nesta fase. Qualquer outro valor falha explicitamente com
// mensagem indicando o que falta configurar.

import { createFakeAiProvider } from "./fake-provider";
import type { AiProvider } from "./types";

const KNOWN_UNIMPLEMENTED_PROVIDERS = ["anthropic", "openai", "gemini"];

export function getAiProvider(): AiProvider {
  const raw = (process.env.AXION_AI_PROVIDER ?? "fake").trim().toLowerCase();

  if (raw === "fake") {
    return createFakeAiProvider();
  }

  if (KNOWN_UNIMPLEMENTED_PROVIDERS.includes(raw)) {
    throw new Error(
      `AXION_AI_PROVIDER="${raw}" ainda não está implementado nesta fase. ` +
        `Nenhum provider real de IA foi conectado — configure AXION_AI_PROVIDER=fake ` +
        `ou implemente o provider real (chave/modelo via environment variables, nunca no código) antes de usar este valor.`
    );
  }

  throw new Error(
    `AXION_AI_PROVIDER inválido: "${raw}". Valor permitido nesta fase: "fake".`
  );
}
