"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";

export async function createPrecontractWorkspaceAction(formData: FormData): Promise<never> {
  const name = String(formData.get("name") ?? "").trim();
  const client = String(formData.get("client") ?? "").trim();
  if (!name || !client) redirect("/juridico?erro=campos-obrigatorios");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_precontract_workspace", {
    p_name: name,
    p_client: client,
  });
  if (error || !data) redirect(`/juridico?erro=${encodeURIComponent(error?.message ?? "falha-ao-criar")}`);
  redirect(`/${String(data)}/juridico`);
}
