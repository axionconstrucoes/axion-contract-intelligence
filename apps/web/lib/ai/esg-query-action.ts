"use server";

// Server Action da consulta conversacional "Perguntar ao Diretor de ESG
// IA" — mesmo padrão de expert-query-action.ts (Diretor Comercial IA).
// Nenhuma lógica de negócio é duplicada aqui: answerEsgDirectorQuery já
// reutiliza os context builders genéricos e o provider abstrato.

import { createSupabaseServerClient } from "@axion/db/server";
import { answerEsgDirectorQuery } from "./experts/esg-director/query";
import { parseExpertQueryForm, resolveExpertQueryErrorMessage } from "./expert-query-request";
import { buildAiProviderUiMetadata, type AiProviderUiMetadata } from "./provider-ui-metadata";
import type { ExpertQueryResponse } from "./query/types";

export type AskEsgDirectorState = {
  response: ExpertQueryResponse | null;
  error: string | null;
  /** Ver AskCommercialDirectorState.meta (expert-query-state.ts) — mesmo motivo para tolerar `undefined` no tipo. */
  meta: AiProviderUiMetadata | null | undefined;
};

export async function askEsgDirectorAction(
  _prevState: AskEsgDirectorState,
  formData: FormData
): Promise<AskEsgDirectorState> {
  const parsed = parseExpertQueryForm(formData);

  if (!parsed.ok) {
    return { response: null, error: parsed.error, meta: null };
  }

  const supabase = await createSupabaseServerClient();

  try {
    const result = await answerEsgDirectorQuery(supabase, parsed.request);

    return {
      response: result.response,
      error: null,
      meta: buildAiProviderUiMetadata(result.audit.providerId, result.audit.model),
    };
  } catch (error) {
    return {
      response: null,
      error: resolveExpertQueryErrorMessage(error, "Falha ao consultar o Diretor de ESG IA."),
      meta: null,
    };
  }
}
