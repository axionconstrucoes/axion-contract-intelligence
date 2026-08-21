"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";

function requiredField(
  formData: FormData,
  name: string
) {
  const value =
    String(
      formData.get(name) ?? ""
    ).trim();

  if (!value) {
    throw new Error(
      `Campo obrigatório ausente: ${name}`
    );
  }

  return value;
}

export async function reviewContractCandidateAction(
  formData: FormData
) {
  const candidateId =
    requiredField(
      formData,
      "candidateId"
    );

  const decision =
    requiredField(
      formData,
      "decision"
    );

  const supabase =
    await createSupabaseServerClient();

  /*
   * Carregamos o candidato pela sessão real/RLS.
   * O RPC fará novamente a autorização forte.
   */
  const {
    data: candidate,
    error: candidateError,
  } = await supabase
    .from("email_thread_event_candidates")
    .select("id,project_id,status")
    .eq("id", candidateId)
    .single();

  if (
    candidateError ||
    !candidate
  ) {
    throw new Error(
      "Candidato não encontrado ou sem permissão de acesso."
    );
  }

  if (
    candidate.status !==
    "PENDING_REVIEW"
  ) {
    throw new Error(
      "Este candidato já foi revisado."
    );
  }

  if (
    decision === "APPROVE"
  ) {
    const eventTitle =
      requiredField(
        formData,
        "eventTitle"
      );

    const eventDescription =
      requiredField(
        formData,
        "eventDescription"
      );

    const {
      data: eventId,
      error,
    } = await supabase.rpc(
      "review_email_thread_event_candidate",
      {
        p_candidate_id:
          candidateId,

        p_action:
          "APPROVE",

        p_review_note:
          eventDescription,

        p_event_title:
          eventTitle,

        p_event_description:
          eventDescription,
      }
    );

    if (error) {
      throw new Error(
        `Falha ao aprovar candidato: ${error.message}`
      );
    }

    revalidatePath(
      `/${candidate.project_id}/revisao-contratual`
    );

    revalidatePath(
      `/${candidate.project_id}/ledger`
    );

    revalidatePath(
      `/${candidate.project_id}/timeline`
    );

    revalidatePath(
      `/${candidate.project_id}/auditoria`
    );

    if (eventId) {
      redirect(
        `/${candidate.project_id}/ledger/${eventId}`
      );
    }

    redirect(
      `/${candidate.project_id}/ledger`
    );
  }

  if (
    decision === "REJECT"
  ) {
    const reviewNote =
      requiredField(
        formData,
        "reviewNote"
      );

    const {
      error,
    } = await supabase.rpc(
      "review_email_thread_event_candidate",
      {
        p_candidate_id:
          candidateId,

        p_action:
          "REJECT",

        p_review_note:
          reviewNote,

        p_event_title:
          null,

        p_event_description:
          null,
      }
    );

    if (error) {
      throw new Error(
        `Falha ao rejeitar candidato: ${error.message}`
      );
    }

    revalidatePath(
      `/${candidate.project_id}/revisao-contratual`
    );

    revalidatePath(
      `/${candidate.project_id}/auditoria`
    );

    redirect(
      `/${candidate.project_id}/revisao-contratual`
    );
  }

  throw new Error(
    "Ação de revisão inválida."
  );
}
