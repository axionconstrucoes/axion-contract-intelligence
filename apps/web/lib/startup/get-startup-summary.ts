// Cabeçalho do Start-up ACC (seção 4 do requisito) — somente leitura,
// reutiliza projects (datas) e ai_findings (contadores). "Histórico" é
// identificado pelo lifecycle_status atribuído na criação do finding
// (ver run-automatic-curation.ts) — nunca recalculado por data aqui, o
// que preservaria a decisão humana já registrada mesmo que a data efetiva
// seja revisada depois.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectStartupConfig, StartupStatus, StartupSummary } from "./types";

const HISTORICAL_LIFECYCLE_STATUSES = ["HISTORICAL_PENDING_STARTUP_REVIEW", "DISMISSED_AT_STARTUP", "RESOLVED_BEFORE_GO_LIVE", "ACTION_CREATED"];
const DECIDED_LIFECYCLE_STATUSES = ["DISMISSED_AT_STARTUP", "RESOLVED_BEFORE_GO_LIVE", "ACTION_CREATED"];

export async function getProjectStartupConfig(supabase: SupabaseClient, projectId: string): Promise<ProjectStartupConfig> {
  const { data, error } = await supabase
    .from("projects")
    .select("id,project_start_date,acc_operational_start_date,startup_completed_at,startup_completed_by_user_id,historical_review_through")
    .eq("id", projectId)
    .single();

  if (error) throw new Error(`Falha ao carregar configuração de Start-up do projeto: ${error.message}`);

  return {
    projectId: data.id,
    projectStartDate: data.project_start_date,
    accOperationalStartDate: data.acc_operational_start_date,
    startupCompletedAt: data.startup_completed_at,
    startupCompletedByUserId: data.startup_completed_by_user_id,
    historicalReviewThrough: data.historical_review_through,
  };
}

function computeStatus(config: ProjectStartupConfig, totalHistoricalFindings: number, curationRunExists: boolean): StartupStatus {
  if (config.startupCompletedAt) return "COMPLETED";
  if (!config.projectStartDate) return "NOT_STARTED";
  if (totalHistoricalFindings === 0 && !curationRunExists) return "NOT_STARTED";
  if (totalHistoricalFindings === 0 && curationRunExists) return "IN_ANALYSIS";
  return "IN_HUMAN_REVIEW";
}

export async function getStartupSummary(supabase: SupabaseClient, projectId: string): Promise<StartupSummary> {
  const config = await getProjectStartupConfig(supabase, projectId);

  const [{ data: findings, error: findingsError }, { count: runCount, error: runError }] = await Promise.all([
    supabase
      .from("ai_findings")
      .select("severity,lifecycle_status")
      .eq("project_id", projectId)
      .in("lifecycle_status", HISTORICAL_LIFECYCLE_STATUSES),
    supabase
      .from("ai_curation_runs")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);

  if (findingsError) throw new Error(`Falha ao carregar findings históricos: ${findingsError.message}`);
  if (runError) throw new Error(`Falha ao carregar execuções de curadoria: ${runError.message}`);

  const rows = findings ?? [];
  const totalHigh = rows.filter((r) => r.severity === "HIGH").length;
  const totalCritical = rows.filter((r) => r.severity === "CRITICAL").length;
  const highCriticalRows = rows.filter((r) => r.severity === "HIGH" || r.severity === "CRITICAL");
  const decidedHighCritical = highCriticalRows.filter((r) => DECIDED_LIFECYCLE_STATUSES.includes(r.lifecycle_status)).length;
  const pendingHighCritical = highCriticalRows.length - decidedHighCritical;

  return {
    config,
    status: computeStatus(config, rows.length, (runCount ?? 0) > 0),
    totalHistoricalFindings: rows.length,
    totalHigh,
    totalCritical,
    decidedHighCritical,
    pendingHighCritical,
    completionPercentage: highCriticalRows.length === 0 ? 100 : Math.round((decidedHighCritical / highCriticalRows.length) * 100),
  };
}
