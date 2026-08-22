"use server";

// Server Action da consulta conversacional "Perguntar ao Diretor
// Comercial IA" — reutilizável em qualquer página (evento ou projeto),
// sem arquitetura paralela. Nenhuma lógica de negócio é duplicada aqui:
// answerCommercialDirectorQuery já reutiliza os context builders
// genéricos e o provider abstrato.

import { createSupabaseServerClient } from "@axion/db/server";
import { answerCommercialDirectorQuery } from "./experts/commercial-director/query";
import type { ExpertQueryResponse, ExpertQueryScope } from "./query/types";

export type AskCommercialDirectorState = {
  response: ExpertQueryResponse | null;
  error: string | null;
};

export const initialAskCommercialDirectorState: AskCommercialDirectorState = {
  response: null,
  error: null,
};

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
    return { response: null, error: "Projeto ausente. Recarregue a página e tente novamente." };
  }

  if (scopeRaw !== "PROJECT" && scopeRaw !== "EVENT") {
    return { response: null, error: "Escopo de consulta inválido." };
  }

  if (!question) {
    return { response: null, error: "Digite uma pergunta." };
  }

  const scope = scopeRaw as ExpertQueryScope;

  if (scope === "EVENT" && !eventId) {
    return { response: null, error: "Evento ausente para consulta de escopo EVENT." };
  }

  const supabase = await createSupabaseServerClient();

  try {
    const result = await answerCommercialDirectorQuery(supabase, {
      scope,
      projectId,
      eventId: eventId ?? undefined,
      question,
    });

    return { response: result.response, error: null };
  } catch (error) {
    return {
      response: null,
      error: error instanceof Error ? error.message : "Falha ao consultar o Diretor Comercial IA.",
    };
  }
}
