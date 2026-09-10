"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";

export type CreatePrecontractWorkspaceState = {
  error: string | null;
  projectId: string | null;
  projectName: string | null;
};

export const initialCreatePrecontractWorkspaceState: CreatePrecontractWorkspaceState = {
  error: null,
  projectId: null,
  projectName: null,
};

export async function createPrecontractWorkspaceAction(
  _previousState: CreatePrecontractWorkspaceState,
  formData: FormData
): Promise<CreatePrecontractWorkspaceState> {
  const name = String(formData.get("name") ?? "").trim();
  const client = String(formData.get("client") ?? "").trim();
  if (!name || !client) {
    return {
      error: "Preencha o nome da oportunidade e o cliente.",
      projectId: null,
      projectName: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_precontract_workspace", {
    p_name: name,
    p_client: client,
  });
  if (error || !data) {
    return {
      error: error?.message ?? "Não foi possível criar a análise pré-contratual.",
      projectId: null,
      projectName: null,
    };
  }

  revalidatePath("/juridico");
  return {
    error: null,
    projectId: String(data),
    projectName: name,
  };
}
