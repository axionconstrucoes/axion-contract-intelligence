"use server";

import { createSupabaseServerClient } from "@axion/db/server";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { answerPlanningDirectorQuery } from "./experts/planning-director/query";
import type { AskCommercialDirectorState } from "./expert-query-state";
import { buildAiProviderUiMetadata } from "./provider-ui-metadata";
import type { ExpertQueryScope } from "./query/types";

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

export async function askEngineeringDirectorAction(
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
  if (scopeRaw === "EVENT" && !eventId) {
    return { response: null, error: "Evento ausente para esta consulta.", meta: null };
  }

  const permission = await getCurrentProjectPermission(projectId);
  if (permission === null) {
    return { response: null, error: "Você não possui acesso ativo a este projeto.", meta: null };
  }

  const supabase = await createSupabaseServerClient();
  try {
    const result = await answerPlanningDirectorQuery(supabase, {
      scope: scopeRaw as ExpertQueryScope,
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
      error: error instanceof Error ? error.message : "Falha ao consultar o Diretor de Engenharia IA.",
      meta: null,
    };
  }
}
