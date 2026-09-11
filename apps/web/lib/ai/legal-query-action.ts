"use server";

import { createSupabaseServerClient } from "@axion/db/server";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { answerLegalConsultantQuery } from "./experts/legal-consultant/query";
import {
  MISSING_QUERY_CONTEXT_MESSAGE,
  resolveExpertQueryErrorMessage,
} from "./expert-query-request";
import type { AskCommercialDirectorState } from "./expert-query-state";
import { buildAiProviderUiMetadata } from "./provider-ui-metadata";

// `scope` é fixo em "PROJECT" abaixo, de propósito: esta consulta é
// sempre do espaço jurídico inteiro e o navegador nunca pode influenciar
// o escopo. O ExpertQueryRequest montado aqui é a ÚNICA fonte do escopo
// da resposta — ver validate-expert-query-response.ts
// (ExpectedExpertQueryIdentity.scope), que deixou de lê-lo da saída do
// provider justamente porque um modelo que omitia o campo derrubava a
// consulta inteira com "scope inválido: undefined".

export async function askLegalConsultantAction(
  _previous: AskCommercialDirectorState,
  formData: FormData
): Promise<AskCommercialDirectorState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();

  if (!projectId) return { response: null, error: MISSING_QUERY_CONTEXT_MESSAGE, meta: null };
  if (!question) return { response: null, error: "Digite uma pergunta para o especialista jurídico.", meta: null };
  if ((await getCurrentProjectPermission(projectId)) === null) {
    return { response: null, error: "Você não possui acesso ativo a este espaço.", meta: null };
  }

  const supabase = await createSupabaseServerClient();

  // Workspace revalidado no servidor tambem no caminho da CONSULTA (nao
  // so no upload): o contexto documental so e montado para um espaco
  // PRE_CONTRATUAL de fato. Falhou: nao carrega documento, nao extrai,
  // nao chama provider.
  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("id,workspace_type")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !projectRow) {
    return { response: null, error: MISSING_QUERY_CONTEXT_MESSAGE, meta: null };
  }

  if ((projectRow as { workspace_type?: string }).workspace_type !== "PRE_CONTRATUAL") {
    return {
      response: null,
      error: "Este espaço não é uma análise jurídica pré-contratual.",
      meta: null,
    };
  }
  try {
    const result = await answerLegalConsultantQuery(
      supabase,
      { scope: "PROJECT", projectId, question },
      undefined,
      // A analise pre-contratual so responde com o texto do contrato/minuta
      // em maos. Sem documento legivel, answerLegalConsultantQuery lanca um
      // ExpertQuerySafeError e o provider nem e chamado.
      { requireContractualDocuments: true }
    );
    return {
      response: result.response,
      error: null,
      meta: buildAiProviderUiMetadata(result.audit.providerId, result.audit.model),
      coverage: result.documentCoverage,
    };
  } catch (error) {
    return {
      response: null,
      error: resolveExpertQueryErrorMessage(error, "Falha ao consultar o especialista jurídico."),
      meta: null,
    };
  }
}
