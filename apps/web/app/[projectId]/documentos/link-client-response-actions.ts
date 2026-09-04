"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@axion/db/server";
import type { ClientResponseRelationType } from "@/lib/documents/client-responses/types";
import type { LinkClientResponseState } from "./link-client-response-actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipo e estado inicial vivem em
// ./link-client-response-actions-state.ts.

const VALID_RELATION_TYPES: ClientResponseRelationType[] = ["RESPONDE", "DISCORDA", "CORRIGE", "RESSALVA", "COMPLEMENTA"];

// Vínculo MANUAL e auditável (Bloco 6 — MVP controlado): o humano já
// está na tela da versão específica (o card), então o vínculo
// email->versão é sempre INTERNAL_VERSION_ID — inequívoco por
// construção (nunca precisa da prioridade Message-ID/thread/hash/
// assunto aqui, essa cadeia é para vínculo automático a partir de um
// e-mail recém-chegado, não deste formulário). A RELAÇÃO
// (RESPONDE/DISCORDA/CORRIGE/RESSALVA/COMPLEMENTA) é sempre escolhida
// explicitamente pelo humano — nunca inferida do conteúdo do e-mail.
export async function linkClientResponseAction(
  _prevState: LinkClientResponseState,
  formData: FormData
): Promise<LinkClientResponseState> {
  const supabase = await createSupabaseServerClient();

  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: "Sessão expirada. Faça login novamente.", success: false };
    }

    const projectId = String(formData.get("projectId") ?? "").trim();
    const documentVersionId = String(formData.get("documentVersionId") ?? "").trim();
    const emailId = String(formData.get("emailId") ?? "").trim();
    const relationType = String(formData.get("relationType") ?? "").trim() as ClientResponseRelationType;
    const excerpt = String(formData.get("excerpt") ?? "").trim() || null;

    if (!projectId || !documentVersionId || !emailId) {
      return { error: "Dados ausentes. Recarregue a página e tente novamente.", success: false };
    }
    if (!VALID_RELATION_TYPES.includes(relationType)) {
      return { error: "Selecione uma relação válida.", success: false };
    }

    const { error } = await supabase.from("document_version_client_responses").insert({
      project_id: projectId,
      document_version_id: documentVersionId,
      email_id: emailId,
      relation_type: relationType,
      link_method: "INTERNAL_VERSION_ID",
      excerpt,
      created_by_type: "USER",
      created_by_user_id: authData.user.id,
    });

    if (error) {
      if (error.message.includes("duplicate key")) {
        return { error: "Este e-mail já está vinculado a esta versão.", success: false };
      }
      return { error: `Falha ao vincular resposta do cliente: ${error.message}`, success: false };
    }

    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao vincular resposta do cliente.", success: false };
  }
}
