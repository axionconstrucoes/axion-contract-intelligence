// Ciclo de vida de uma execução de curadoria (ai_curation_runs) — seção
// 11 do requisito: falha de IA NUNCA desfaz a ingestão da fonte
// original, só marca esta linha FAILED_PENDING_RETRY. A fonte
// (documento/e-mail/anexo/etc.) já foi persistida ANTES desta função
// sequer ser chamada — nunca o contrário.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpertId } from "../../ai/types";
import type { AiCurationRun, AiCurationSourceType } from "./types";

function mapRow(row: Record<string, unknown>): AiCurationRun {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    sourceType: row.source_type as AiCurationSourceType,
    sourceId: row.source_id as string,
    sourceFingerprint: row.source_fingerprint as string,
    triggerType: row.trigger_type as AiCurationRun["triggerType"],
    status: row.status as AiCurationRun["status"],
    routedExpertIds: (row.routed_expert_ids as ExpertId[]) ?? [],
    errorMessage: (row.error_message as string | null) ?? null,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    createdByType: row.created_by_type as AiCurationRun["createdByType"],
    createdByUserId: (row.created_by_user_id as string | null) ?? null,
    createdByLabel: (row.created_by_label as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

const RUN_COLUMNS =
  "id,project_id,source_type,source_id,source_fingerprint,trigger_type,status,routed_expert_ids,error_message,started_at,completed_at,created_by_type,created_by_user_id,created_by_label,created_at";

/** Existe já uma execução COMPLETED para exatamente esta fonte+fingerprint? Se sim, nunca reexecutar (seção 12). */
export async function findCompletedCurationRun(
  supabase: SupabaseClient,
  input: { sourceType: AiCurationSourceType; sourceId: string; sourceFingerprint: string }
): Promise<AiCurationRun | null> {
  const { data, error } = await supabase
    .from("ai_curation_runs")
    .select(RUN_COLUMNS)
    .eq("source_type", input.sourceType)
    .eq("source_id", input.sourceId)
    .eq("source_fingerprint", input.sourceFingerprint)
    .eq("status", "COMPLETED")
    .maybeSingle();

  if (error) throw new Error(`Falha ao consultar execuções de curadoria: ${error.message}`);
  return data ? mapRow(data as unknown as Record<string, unknown>) : null;
}

export interface StartCurationRunInput {
  projectId: string;
  sourceType: AiCurationSourceType;
  sourceId: string;
  sourceFingerprint: string;
  triggerType: "AUTOMATIC" | "MANUAL";
  createdByUserId?: string;
}

export async function startCurationRun(supabase: SupabaseClient, input: StartCurationRunInput): Promise<AiCurationRun> {
  const { data, error } = await supabase
    .from("ai_curation_runs")
    .insert({
      project_id: input.projectId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_fingerprint: input.sourceFingerprint,
      trigger_type: input.triggerType,
      status: "RUNNING",
      created_by_type: input.createdByUserId ? "USER" : "SYSTEM",
      created_by_user_id: input.createdByUserId ?? null,
    })
    .select(RUN_COLUMNS)
    .single();

  if (error) throw new Error(`Falha ao iniciar execução de curadoria: ${error.message}`);
  return mapRow(data as unknown as Record<string, unknown>);
}

export async function completeCurationRun(supabase: SupabaseClient, runId: string, routedExpertIds: ExpertId[]): Promise<void> {
  const { error } = await supabase
    .from("ai_curation_runs")
    .update({ status: "COMPLETED", routed_expert_ids: routedExpertIds, completed_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) throw new Error(`Falha ao concluir execução de curadoria: ${error.message}`);
}

/** Nunca lança — usada dentro de um catch para garantir que a fonte original permaneça intacta mesmo quando isto também falhar. */
export async function failCurationRun(supabase: SupabaseClient, runId: string, errorMessage: string): Promise<void> {
  await supabase
    .from("ai_curation_runs")
    .update({ status: "FAILED_PENDING_RETRY", error_message: errorMessage, completed_at: new Date().toISOString() })
    .eq("id", runId);
}
