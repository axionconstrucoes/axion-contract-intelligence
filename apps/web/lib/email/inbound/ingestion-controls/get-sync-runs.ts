import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSyncRun } from "./types";

const COLUMNS =
  "id,config_id,project_id,status,emails_found,emails_imported,attachments_found,attachments_processed,findings_generated,failures_count,error_message,started_by_user_id,started_at,completed_at";

function mapRow(row: Record<string, unknown>): EmailSyncRun {
  return {
    id: row.id as string,
    configId: row.config_id as string,
    projectId: row.project_id as string,
    status: row.status as EmailSyncRun["status"],
    emailsFound: (row.emails_found as number | null) ?? null,
    emailsImported: row.emails_imported as number,
    attachmentsFound: row.attachments_found as number,
    attachmentsProcessed: row.attachments_processed as number,
    findingsGenerated: row.findings_generated as number,
    failuresCount: row.failures_count as number,
    errorMessage: (row.error_message as string | null) ?? null,
    startedByUserId: row.started_by_user_id as string,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export async function getEmailSyncRunsForProject(supabase: SupabaseClient, projectId: string, limit = 10): Promise<EmailSyncRun[]> {
  const { data, error } = await supabase
    .from("project_email_ingestion_sync_runs")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Falha ao carregar execuções de sincronização: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapRow);
}

export async function getLatestEmailSyncRun(supabase: SupabaseClient, projectId: string): Promise<EmailSyncRun | null> {
  const runs = await getEmailSyncRunsForProject(supabase, projectId, 1);
  return runs[0] ?? null;
}
