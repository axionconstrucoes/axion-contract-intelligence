// Seleção de provider POR EXPERT — o ponto de entrada correto para
// qualquer Expert escolher seu provider (nunca `getAiProvider()`
// diretamente, ver get-ai-provider.ts).
//
// Resolução, em ordem:
//   1. variável específica do Expert (ex.: AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR)
//   2. se ausente, AXION_AI_PROVIDER (default de compatibilidade)
//   3. se ambas ausentes, "fake"
//
// Isto é seleção explícita e auditável — nunca um fallback SILENCIOSO
// por erro: se a variável específica (ou a global, quando usada como
// fallback) apontar para "anthropic" e a configuração estiver
// incompleta (ex.: ANTHROPIC_API_KEY ausente), a resolução FALHA — ela
// nunca cai de volta para "fake" só porque "anthropic" deu erro. Um
// Expert só usa "fake" quando isso foi deliberadamente configurado (ou
// é o default de nenhuma configuração), nunca como recuperação de falha.
//
// Ativar um provider real para um Expert nunca desativa outro: cada
// Expert é resolvido de forma independente a partir de sua própria
// variável específica.

import type { OfficialExpertId } from "../expert-definitions/types";
import { instantiateAiProviderByName } from "./instantiate-provider";
import type { AiProvider } from "./types";

/**
 * Nomes de variável preparados para os cinco Experts oficiais
 * (ver docs/ai/expert-capabilities.md). Só commercial-director e
 * esg-director têm operação real nesta fase — as outras três variáveis
 * existem apenas para não exigir uma segunda migração de nomenclatura
 * quando CEO IA/Consultor Jurídico IA/Diretor de Planejamento IA forem
 * conectados a um provider real no futuro.
 */
export const EXPERT_PROVIDER_ENV_VAR: Record<OfficialExpertId, string> = {
  "commercial-director": "AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR",
  "esg-director": "AXION_AI_PROVIDER_ESG_DIRECTOR",
  ceo: "AXION_AI_PROVIDER_CEO",
  "legal-consultant": "AXION_AI_PROVIDER_LEGAL_CONSULTANT",
  "planning-director": "AXION_AI_PROVIDER_PLANNING_DIRECTOR",
};

interface ResolvedProviderName {
  raw: string;
  /** De onde o valor efetivamente veio — usado para mensagens de erro auditáveis. */
  sourceDescription: string;
}

function resolveProviderNameSource(expertId: OfficialExpertId): ResolvedProviderName {
  const specificVarName = EXPERT_PROVIDER_ENV_VAR[expertId];
  const specific = process.env[specificVarName];

  if (specific !== undefined && specific.trim() !== "") {
    return { raw: specific, sourceDescription: specificVarName };
  }

  const global = process.env.AXION_AI_PROVIDER;
  if (global !== undefined && global.trim() !== "") {
    return { raw: global, sourceDescription: `AXION_AI_PROVIDER (default de compatibilidade — ${specificVarName} não configurada para "${expertId}")` };
  }

  return { raw: "fake", sourceDescription: `default (nem ${specificVarName} nem AXION_AI_PROVIDER configuradas)` };
}

/** Só o nome normalizado ("fake"/"anthropic"/...) — útil para exibição/testes sem instanciar o provider. */
export function resolveAiProviderNameForExpert(expertId: OfficialExpertId): string {
  return resolveProviderNameSource(expertId).raw.trim().toLowerCase();
}

/**
 * Ponto de entrada correto para qualquer Expert obter seu provider.
 * Fail-closed: nunca cai para "fake" silenciosamente por erro de
 * configuração — só usa "fake" quando isso é o que foi resolvido
 * (configurado explicitamente ou default de ausência total de config).
 */
export function resolveAiProviderForExpert(expertId: OfficialExpertId): AiProvider {
  const { raw, sourceDescription } = resolveProviderNameSource(expertId);
  return instantiateAiProviderByName(raw, sourceDescription);
}
