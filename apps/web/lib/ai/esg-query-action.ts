"use server";

// Server Action da consulta conversacional "Perguntar ao Diretor de ESG
// IA" — mesmo padrão de expert-query-action.ts (Diretor Comercial IA).
// Nenhuma lógica de negócio é duplicada aqui: answerEsgDirectorQuery já
// reutiliza os context builders genéricos e o provider abstrato.

import { createSupabaseServerClient } from "@axion/db/server";
import { answerEsgDirectorQuery } from "./experts/esg-director/query";
import { buildAiProviderUiMetadata, type AiProviderUiMetadata } from "./provider-ui-metadata";
import type { ExpertQueryResponse, ExpertQueryScope } from "./query/types";

export type AskEsgDirectorState = {
  response: ExpertQueryResponse | null;
  error: string | null;
  /** Ver AskCommercialDirectorState.meta (expert-query-state.ts) — mesmo motivo para tolerar `undefined` no tipo. */
  meta: AiProviderUiMetadata | null | undefined;
};

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

export async function askEsgDirectorAction(
  _prevState: AskEsgDirectorState,
  formData: FormData
): Promise<AskEsgDirectorState> {
  const projectId = optionalField(formData, "projectId");
  const scopeRaw = optionalField(formData, "scope");
  const eventId = optionalField(formData, "eventId");
  const question = optionalField(formData, "question");

  if (!projectId) {
    return { response: null, error: "Projeto ausente. Recarregue a página e tente novamente.", meta: null };
  }

  if (scopeRaw !== "PROJECT" && scopeRaw !== "EVENT") {
    return { response: null, error: "Escopo de consulta inválido.", meta: null };
  }

  if (!question) {
    return { response: null, error: "Digite uma pergunta.", meta: null };
  }

  const scope = scopeRaw as ExpertQueryScope;

  if (scope === "EVENT" && !eventId) {
    return { response: null, error: "Evento ausente para consulta de escopo EVENT.", meta: null };
  }

  const supabase = await createSupabaseServerClient();

  try {
    const result = await answerEsgDirectorQuery(supabase, {
      scope,
      projectId,
      eventId: eventId ?? undefined,
      question,
    });

    return {
      response: result.response,
      error: null,
      meta: buildAiProviderUiMetadata(result.audit.providerId, result.audit.model),
    };
  } catch (error) {
    return {
      response: null,
      error: error instanceof Error ? error.message : "Falha ao consultar o Diretor de ESG IA.",
      meta: null,
    };
  }
}
