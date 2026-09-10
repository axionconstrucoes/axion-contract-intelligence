"use server";

import { createSupabaseServerClient } from "@axion/db/server";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { answerLegalConsultantQuery } from "./experts/legal-consultant/query";
import type { AskCommercialDirectorState } from "./expert-query-state";
import { buildAiProviderUiMetadata } from "./provider-ui-metadata";

export async function askLegalConsultantAction(
  _previous: AskCommercialDirectorState,
  formData: FormData
): Promise<AskCommercialDirectorState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();

  if (!projectId) return { response: null, error: "Espaço jurídico ausente.", meta: null };
  if (!question) return { response: null, error: "Digite uma pergunta para o especialista jurídico.", meta: null };
  if ((await getCurrentProjectPermission(projectId)) === null) {
    return { response: null, error: "Você não possui acesso ativo a este espaço.", meta: null };
  }

  const supabase = await createSupabaseServerClient();
  try {
    const result = await answerLegalConsultantQuery(supabase, {
      scope: "PROJECT",
      projectId,
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
      error: error instanceof Error ? error.message : "Falha ao consultar o especialista jurídico.",
      meta: null,
    };
  }
}
