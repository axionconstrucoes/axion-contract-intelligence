import type { SupabaseClient } from "@supabase/supabase-js";
import { FINDING_COLUMNS, mapFindingRow } from "./map-finding-row";
import type { AiFinding } from "./types";

export async function getFindingsForProject(supabase: SupabaseClient, projectId: string): Promise<AiFinding[]> {
  const { data, error } = await supabase
    .from("ai_findings")
    .select(FINDING_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Falha ao carregar findings: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapFindingRow);
}

export async function getFinding(supabase: SupabaseClient, findingId: string): Promise<AiFinding | null> {
  const { data, error } = await supabase.from("ai_findings").select(FINDING_COLUMNS).eq("id", findingId).maybeSingle();
  if (error) throw new Error(`Falha ao carregar finding: ${error.message}`);
  return data ? mapFindingRow(data as unknown as Record<string, unknown>) : null;
}
