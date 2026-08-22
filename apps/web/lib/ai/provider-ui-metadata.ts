// Metadata segura de provider para exibição na UI — única fonte de
// verdade usada por expert-query-action.ts/esg-query-action.ts (nunca
// duplicar esta lógica por Expert). Deriva sempre de `providerId`/`model`
// já retornados pelo `audit` de answerCommercialDirectorQuery/
// answerEsgDirectorQuery (por sua vez resolvidos via
// resolveAiProviderForExpert) — nunca lê AXION_AI_PROVIDER nem nenhuma
// env var diretamente, e nunca inclui a API key.

export interface AiProviderUiMetadata {
  providerId: string;
  providerLabel: string;
  model: string | null;
  isRealProvider: boolean;
}

export function buildAiProviderUiMetadata(providerId: string, model: string | null): AiProviderUiMetadata {
  if (providerId === "anthropic") {
    return { providerId, providerLabel: "Anthropic", model, isRealProvider: true };
  }

  return { providerId, providerLabel: "Fake/Teste", model: null, isRealProvider: false };
}

/**
 * Normaliza o estado de `meta` para exibição — `null`/`undefined`
 * (nenhuma consulta ainda) sempre viram `null`; nunca lança, nunca usa
 * non-null assertion. Único ponto de checagem antes de qualquer acesso
 * a `meta.isRealProvider`/`meta.providerId`/`meta.providerLabel`/
 * `meta.model` em `ExpertQueryPanel` — motivado por um erro real em
 * runtime ("Cannot read properties of undefined (reading
 * 'isRealProvider')") quando `meta` chegava como `undefined`.
 */
export function normalizeProviderMeta(meta: AiProviderUiMetadata | null | undefined): AiProviderUiMetadata | null {
  return meta == null ? null : meta;
}
