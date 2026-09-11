"use server";

// Server Action da consulta conversacional "Perguntar ao Diretor
// Comercial IA" — reutilizável em qualquer página (evento ou projeto),
// sem arquitetura paralela. Nenhuma lógica de negócio é duplicada aqui:
// answerCommercialDirectorQuery já reutiliza os context builders
// genéricos e o provider abstrato, e a validação do contexto do
// formulário vive em ./expert-query-request.ts (compartilhada com os
// demais Experts).

import { createSupabaseServerClient } from "@axion/db/server";
import { answerCommercialDirectorQuery } from "./experts/commercial-director/query";
import {
  parseExpertQueryForm,
  resolveExpertQueryErrorMessage,
} from "./expert-query-request";
import type { AskCommercialDirectorState } from "./expert-query-state";
import { buildAiProviderUiMetadata } from "./provider-ui-metadata";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipos e o estado inicial vivem em ./expert-query-state.ts
// (nunca aqui), justamente para nunca reintroduzir "A 'use server' file
// can only export async functions, found object."

const FALLBACK_ERROR = "Falha ao consultar o Diretor Comercial IA.";

export async function askCommercialDirectorAction(
  _prevState: AskCommercialDirectorState,
  formData: FormData
): Promise<AskCommercialDirectorState> {
  const parsed = parseExpertQueryForm(formData);

  if (!parsed.ok) {
    return { response: null, error: parsed.error, meta: null };
  }

  const supabase = await createSupabaseServerClient();

  try {
    const result = await answerCommercialDirectorQuery(supabase, parsed.request);

    return {
      response: result.response,
      error: null,
      meta: buildAiProviderUiMetadata(result.audit.providerId, result.audit.model),
    };
  } catch (error) {
    return {
      response: null,
      error: resolveExpertQueryErrorMessage(error, FALLBACK_ERROR),
      meta: null,
    };
  }
}
