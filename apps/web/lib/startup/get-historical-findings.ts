import type { SupabaseClient } from "@supabase/supabase-js";
import { FINDING_COLUMNS, mapFindingRow } from "../additionals/findings/map-finding-row";
import type { AiFinding } from "../additionals/findings/types";

const HISTORICAL_LIFECYCLE_STATUSES = ["HISTORICAL_PENDING_STARTUP_REVIEW", "DISMISSED_AT_STARTUP", "RESOLVED_BEFORE_GO_LIVE", "ACTION_CREATED"];

/** Todos os findings marcados como históricos pelo Start-up — nunca removidos do histórico mesmo depois de decididos (seção 13). */
export async function getHistoricalFindings(supabase: SupabaseClient, projectId: string): Promise<AiFinding[]> {
  const { data, error } = await supabase
    .from("ai_findings")
    .select(FINDING_COLUMNS)
    .eq("project_id", projectId)
    .in("lifecycle_status", HISTORICAL_LIFECYCLE_STATUSES)
    .order("severity", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Falha ao carregar findings históricos: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapFindingRow);
}
