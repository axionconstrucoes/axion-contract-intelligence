// Seleção GLOBAL de provider de IA — mantida por compatibilidade.
//
// IMPORTANTE: `AXION_AI_PROVIDER` é global (não sabe qual Expert está
// chamando). Desde a correção "PROVIDER POR EXPERT", nenhum Expert deve
// chamar esta função diretamente — cada um deve usar
// `resolveAiProviderForExpert(expertId)` (./resolve-provider-for-expert.ts),
// que só cai para `AXION_AI_PROVIDER` quando NÃO existir configuração
// específica daquele Expert (ex.: `AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR`).
// Isso evita a regressão em que ativar um provider real para um Expert
// (ex.: Anthropic para o Diretor Comercial IA) desativasse outro Expert
// que deveria continuar no fake provider (ex.: Diretor de ESG IA).
//
// `getAiProvider()` continua existindo (e sendo testada em
// scripts/test-ai-foundation.mjs) como a seleção genérica/legada — nunca
// escolhe silenciosamente um provider: "fake" e "anthropic" estão
// implementados nesta fase; qualquer outro valor falha explicitamente.

import { instantiateAiProviderByName } from "./instantiate-provider";
import type { AiProvider } from "./types";

export function getAiProvider(): AiProvider {
  const raw = process.env.AXION_AI_PROVIDER ?? "fake";
  return instantiateAiProviderByName(raw, "AXION_AI_PROVIDER");
}
