"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import { validateConfrontationJustification } from "@/lib/ledger/confrontation-justification-validation";
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

  // Justificativa específica é obrigatória tanto para aprovar quanto para
  // rejeitar — mesma validação compartilhada e determinística do cliente
  // (ConfrontationReviewForms), mas esta é a barreira que de fato conta:
  // o navegador pode contornar o gate do cliente, nunca este. Rejeita
  // vazio, curto demais ou uma das frases genéricas já vistas em produção
  // ("aprovado", "de acordo", "possível relação", "confronto humano
  // aprovado", "rejeitado", "não se aplica" sem explicação, etc.).
  const justification = validateConfrontationJustification(reviewNote);
  if (!justification.valid) {
    return { error: justification.error };
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

// Emenda de review_note em candidato JÁ revisado (APPROVED/REJECTED) —
// nunca reabre a revisão, nunca troca status/aprovador original/data
// original. Chama amend_event_clause_confrontation_review_note (migration
// 20260828150000, NÃO aplicada nesta etapa — em qualquer ambiente sem
// essa migration, a RPC não existe e o Supabase retorna PGRST202/42883,
// tratado abaixo como uma mensagem clara, nunca um erro genérico).
export async function amendConfrontationReviewNoteAction(
  _prevState: ReviewEventClauseConfrontationCandidateState,
  formData: FormData
): Promise<ReviewEventClauseConfrontationCandidateState> {
  const projectId = optionalField(formData, "projectId");
  const eventId = optionalField(formData, "eventId");
  const candidateId = optionalField(formData, "candidateId");

  if (!projectId || !eventId || !candidateId) {
    return { error: "Dados do candidato ausentes. Recarregue a página e tente novamente." };
  }

  const newReviewNote = String(formData.get("reviewNote") ?? "").trim();

  // Mesma validação compartilhada e determinística usada em APROVAR/
  // REJEITAR — a RPC também valida (rede de segurança mínima em SQL),
  // mas esta é a checagem completa (frases genéricas incluídas).
  const justification = validateConfrontationJustification(newReviewNote);
  if (!justification.valid) {
    return { error: justification.error };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("amend_event_clause_confrontation_review_note", {
    p_candidate_id: candidateId,
    p_new_review_note: newReviewNote,
  });

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return {
        error:
          "Complementar justificativas ainda não está disponível neste ambiente — a migration correspondente não foi aplicada.",
      };
    }
    return { error: error.message };
  }

  revalidatePath(`/${projectId}/ledger/${eventId}`);
  revalidatePath(`/${projectId}/ledger`);
  revalidatePath(`/${projectId}/auditoria`);

  return { error: null };
}
