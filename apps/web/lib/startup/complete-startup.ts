// "[CONCLUIR START-UP DO PROJETO]" (seção 14) — só habilitado quando
// todos os findings históricos ALTO/CRÍTICO têm decisão humana. Nunca
// reescreve nenhum finding/evento histórico — só grava o marco de
// conclusão no projeto.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectStartupConfig } from "./get-startup-summary";
import type { ProjectStartupConfig } from "./types";

export async function canCompleteProjectStartup(supabase: SupabaseClient, projectId: string): Promise<{ canComplete: boolean; pendingCount: number }> {
  const { count, error } = await supabase
    .from("ai_findings")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .in("severity", ["HIGH", "CRITICAL"])
    .eq("lifecycle_status", "HISTORICAL_PENDING_STARTUP_REVIEW");

  if (error) throw new Error(`Falha ao verificar findings pendentes: ${error.message}`);

  const pendingCount = count ?? 0;
  return { canComplete: pendingCount === 0, pendingCount };
}

export interface CompleteProjectStartupInput {
  projectId: string;
  completedByUserId: string;
}

export async function completeProjectStartup(supabase: SupabaseClient, input: CompleteProjectStartupInput): Promise<ProjectStartupConfig> {
  const { canComplete, pendingCount } = await canCompleteProjectStartup(supabase, input.projectId);
  if (!canComplete) {
    throw new Error(
      `Não é possível concluir o Start-up: ${pendingCount} finding(s) histórico(s) ALTO/CRÍTICO ainda sem decisão humana.`
    );
  }

  const config = await getProjectStartupConfig(supabase, input.projectId);
  const operationalStart = new Date(`${config.accOperationalStartDate}T00:00:00.000Z`);
  const dayBefore = new Date(operationalStart.getTime() - 24 * 60 * 60 * 1000);
  const historicalReviewThrough = dayBefore.toISOString().slice(0, 10);

  const { error } = await supabase
    .from("projects")
    .update({
      startup_completed_at: new Date().toISOString(),
      startup_completed_by_user_id: input.completedByUserId,
      historical_review_through: historicalReviewThrough,
    })
    .eq("id", input.projectId);

  if (error) throw new Error(`Falha ao concluir Start-up do projeto: ${error.message}`);

  return getProjectStartupConfig(supabase, input.projectId);
}
