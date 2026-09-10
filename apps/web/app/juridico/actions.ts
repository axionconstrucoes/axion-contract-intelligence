"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type { CreatePrecontractWorkspaceState } from "@/lib/legal/precontract-workspace-state";

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
