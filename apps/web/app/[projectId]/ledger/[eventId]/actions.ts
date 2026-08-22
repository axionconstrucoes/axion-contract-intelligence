"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";

function requiredField(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();

  if (!value) {
    throw new Error(`Campo obrigatório ausente: ${name}`);
  }

  return value;
}

export async function reviewEventClauseConfrontationCandidateAction(formData: FormData) {
  const projectId = requiredField(formData, "projectId");
  const eventId = requiredField(formData, "eventId");
  const candidateId = requiredField(formData, "candidateId");

  const action = requiredField(formData, "reviewAction").toUpperCase();

  if (action !== "APPROVE" && action !== "REJECT") {
    throw new Error("Ação de revisão inválida.");
  }

  const reviewNote = String(formData.get("reviewNote") ?? "").trim();

  if (action === "REJECT" && !reviewNote) {
    throw new Error("Informe a justificativa da rejeição.");
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
    throw new Error(error.message);
  }

  revalidatePath(`/${projectId}/ledger/${eventId}`);
  revalidatePath(`/${projectId}/ledger`);
  revalidatePath(`/${projectId}/auditoria`);
}
