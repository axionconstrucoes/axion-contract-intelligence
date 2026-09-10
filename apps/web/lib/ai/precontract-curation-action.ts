"use server";

import { createSupabaseServerClient } from "@axion/db/server";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { runMultiExpertCuration } from "./curation/run-multi-expert-curation";
import type { MultiExpertCuration } from "./curation/types";

export type PrecontractCurationState = {
  result: MultiExpertCuration | null;
  error: string | null;
};

export async function runPrecontractCurationAction(
  _previous: PrecontractCurationState,
  formData: FormData
): Promise<PrecontractCurationState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();
  if (!projectId || !question) return { result: null, error: "Informe a dúvida ou cláusula que será negociada." };
  if ((await getCurrentProjectPermission(projectId)) === null) {
    return { result: null, error: "Você não possui acesso ativo a esta análise pré-contratual." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await runMultiExpertCuration(supabase, {
      projectId,
      sourceType: "PROJECT",
      description: question,
      consultAllExperts: true,
    });
    return { result, error: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : "Falha na análise integrada dos especialistas.",
    };
  }
}
