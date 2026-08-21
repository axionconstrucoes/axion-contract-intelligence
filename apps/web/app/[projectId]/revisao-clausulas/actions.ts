"use server";

import {
  revalidatePath,
} from "next/cache";

import {
  redirect,
} from "next/navigation";

import {
  createSupabaseServerClient,
} from "@axion/db/server";

function getRequiredString(
  formData: FormData,
  key: string
) {
  const value =
    String(
      formData.get(key) ?? ""
    ).trim();

  if (!value) {
    throw new Error(
      `Campo obrigatório ausente: ${key}`
    );
  }

  return value;
}

export async function reviewClauseCandidateAction(
  formData: FormData
) {
  const projectId =
    getRequiredString(
      formData,
      "projectId"
    );

  const candidateId =
    getRequiredString(
      formData,
      "candidateId"
    );

  const action =
    getRequiredString(
      formData,
      "reviewAction"
    ).toUpperCase();

  if (
    action !== "APPROVE" &&
    action !== "REJECT"
  ) {
    throw new Error(
      "Ação de revisão inválida."
    );
  }

  const reviewNote =
    String(
      formData.get(
        "reviewNote"
      ) ?? ""
    ).trim();

  if (
    action === "REJECT" &&
    !reviewNote
  ) {
    throw new Error(
      "Informe a justificativa da rejeição."
    );
  }

  const clauseNumber =
    String(
      formData.get(
        "clauseNumber"
      ) ?? ""
    ).trim();

  const clauseTitle =
    String(
      formData.get(
        "clauseTitle"
      ) ?? ""
    ).trim();

  const clauseText =
    String(
      formData.get(
        "clauseText"
      ) ?? ""
    ).trim();

  if (
    action === "APPROVE" &&
    (
      !clauseNumber ||
      !clauseTitle ||
      !clauseText
    )
  ) {
    throw new Error(
      "Número, título e texto são obrigatórios para aprovação."
    );
  }

  const supabase =
    await createSupabaseServerClient();

  const rpcClient =
    supabase as unknown as {
      rpc: (
        name: string,
        parameters: Record<
          string,
          unknown
        >
      ) => Promise<{
        data: unknown;
        error:
          | {
              message: string;
            }
          | null;
      }>;
    };

  const {
    error,
  } = await rpcClient.rpc(
    "review_clause_extraction_candidate",
    {
      p_candidate_id:
        candidateId,

      p_action:
        action,

      p_review_note:
        reviewNote || null,

      p_clause_number:
        action === "APPROVE"
          ? clauseNumber
          : null,

      p_clause_title:
        action === "APPROVE"
          ? clauseTitle
          : null,

      p_clause_text:
        action === "APPROVE"
          ? clauseText
          : null,
    }
  );

  if (error) {
    throw new Error(
      error.message
    );
  }

  revalidatePath(
    `/${projectId}/revisao-clausulas`
  );

  revalidatePath(
    `/${projectId}/documentos`
  );

  revalidatePath(
    `/${projectId}/auditoria`
  );

  redirect(
    `/${projectId}/revisao-clausulas`
  );
}
