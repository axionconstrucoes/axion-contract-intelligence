// Configura as datas do Start-up (seção 1) — sempre humano (RLS EDITOR
// via projects_update_editor). Nunca reescreve nenhum timestamp
// histórico de outra entidade (seção 19); só os dois campos de
// configuração do projeto.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectStartupConfig } from "./get-startup-summary";
import type { ProjectStartupConfig } from "./types";

export interface ConfigureStartupInput {
  projectId: string;
  projectStartDate: string;
  /** Opcional — quando ausente, mantém o valor já configurado (nunca reseta silenciosamente para o default). */
  accOperationalStartDate?: string;
}

export async function configureProjectStartup(supabase: SupabaseClient, input: ConfigureStartupInput): Promise<ProjectStartupConfig> {
  const updates: Record<string, unknown> = { project_start_date: input.projectStartDate };
  if (input.accOperationalStartDate) updates.acc_operational_start_date = input.accOperationalStartDate;

  const { error } = await supabase.from("projects").update(updates).eq("id", input.projectId);
  if (error) throw new Error(`Falha ao configurar Start-up do projeto: ${error.message}`);

  return getProjectStartupConfig(supabase, input.projectId);
}
