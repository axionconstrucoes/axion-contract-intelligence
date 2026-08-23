"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type { ReviewEventClauseConfrontationCandidateState } from "./actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipo e estado inicial vivem em ./actions-state.ts.

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

// Usa useActionState no cliente: qualquer falha (campo ausente, permissão,
// candidato já revisado, erro da RPC) retorna como estado exibível na UI,
// em vez de um throw que ou é bloqueado silenciosamente pelo navegador
// (campo required vazio nunca chega a gerar requisição) ou vira uma página
// de erro genérica sem nenhuma explicação para o usuário.
export async function reviewEventClauseConfrontationCandidateAction(
  _prevState: ReviewEventClauseConfrontationCandidateState,
  formData: FormData
): Promise<ReviewEventClauseConfrontationCandidateState> {
  const projectId = optionalField(formData, "projectId");
  const eventId = optionalField(formData, "eventId");
  const candidateId = optionalField(formData, "candidateId");

  if (!projectId || !eventId || !candidateId) {
    return { error: "Dados do candidato ausentes. Recarregue a página e tente novamente." };
  }

  const action = optionalField(formData, "reviewAction")?.toUpperCase() ?? null;

  if (action !== "APPROVE" && action !== "REJECT") {
    return { error: "Ação de revisão inválida." };
  }

  const reviewNote = String(formData.get("reviewNote") ?? "").trim();

  if (action === "REJECT" && !reviewNote) {
    return { error: "Informe a justificativa da rejeição." };
  }

  const supabase = await createSupabaseServerClient();

  // review_event_clause_confrontation_candidate é a única autoridade sobre
  // permissão e transação: cria o event_cross_reference e o audit log.
  // Nenhuma lógica de negócio é duplicada aqui.
  const { error } = await supabase.rpc("review_event_clause_confrontation_candidate", {
    p_candidate_id: candidateId,
    p_action: action,
    p_review_note: reviewNote || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${projectId}/ledger/${eventId}`);
  revalidatePath(`/${projectId}/ledger`);
  revalidatePath(`/${projectId}/auditoria`);

  return { error: null };
}
