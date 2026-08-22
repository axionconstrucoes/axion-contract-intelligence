"use server";

// Server Action da consulta conversacional "Perguntar ao Diretor
// Comercial IA" — reutilizável em qualquer página (evento ou projeto),
// sem arquitetura paralela. Nenhuma lógica de negócio é duplicada aqui:
// answerCommercialDirectorQuery já reutiliza os context builders
// genéricos e o provider abstrato.

import { createSupabaseServerClient } from "@axion/db/server";
import { answerCommercialDirectorQuery } from "./experts/commercial-director/query";
import type { AskCommercialDirectorState } from "./expert-query-state";
import { buildAiProviderUiMetadata } from "./provider-ui-metadata";
import type { ExpertQueryScope } from "./query/types";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipos e o estado inicial vivem em ./expert-query-state.ts
// (nunca aqui), justamente para nunca reintroduzir "A 'use server' file
// can only export async functions, found object."

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

export async function askCommercialDirectorAction(
  _prevState: AskCommercialDirectorState,
  formData: FormData
): Promise<AskCommercialDirectorState> {
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
    const result = await answerCommercialDirectorQuery(supabase, {
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
      error: error instanceof Error ? error.message : "Falha ao consultar o Diretor Comercial IA.",
      meta: null,
    };
  }
}
