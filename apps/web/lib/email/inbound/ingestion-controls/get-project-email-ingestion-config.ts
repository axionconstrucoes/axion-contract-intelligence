import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectEmailIngestionConfig } from "./types";

const CONFIG_COLUMNS =
  "id,project_id,enabled,window_mode,custom_start_at,custom_end_at,monitoring_started_at,last_sync_at,include_attachments,email_account_id";

export async function getProjectEmailIngestionConfig(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectEmailIngestionConfig | null> {
  const { data: configRow, error: configError } = await supabase
    .from("project_email_ingestion_configs")
    .select(CONFIG_COLUMNS)
    .eq("project_id", projectId)
    .maybeSingle();

  if (configError) throw new Error(`Falha ao carregar configuração de ingestão: ${configError.message}`);
  if (!configRow) return null;

  const [{ data: mailboxRows, error: mailboxError }, { data: domainRows, error: domainError }, { data: participantRows, error: participantError }] =
    await Promise.all([
      supabase.from("project_email_ingestion_mailboxes").select("id,mailbox_address,enabled").eq("config_id", configRow.id),
      supabase.from("project_email_ingestion_domains").select("id,domain,domain_role,enabled").eq("config_id", configRow.id),
      supabase.from("project_email_ingestion_participants").select("id,email_address,role_note,enabled").eq("config_id", configRow.id),
    ]);

  if (mailboxError) throw new Error(`Falha ao carregar mailboxes: ${mailboxError.message}`);
  if (domainError) throw new Error(`Falha ao carregar domínios: ${domainError.message}`);
  if (participantError) throw new Error(`Falha ao carregar participantes: ${participantError.message}`);

  return {
    id: configRow.id,
    projectId: configRow.project_id,
    enabled: configRow.enabled,
    windowMode: configRow.window_mode,
    customStartAt: configRow.custom_start_at,
    customEndAt: configRow.custom_end_at,
    monitoringStartedAt: configRow.monitoring_started_at,
    lastSyncAt: configRow.last_sync_at,
    includeAttachments: configRow.include_attachments,
    emailAccountId: configRow.email_account_id,
    mailboxes: (mailboxRows ?? []).map((row) => ({ id: row.id, mailboxAddress: row.mailbox_address, enabled: row.enabled })),
    domains: (domainRows ?? []).map((row) => ({ id: row.id, domain: row.domain, domainRole: row.domain_role, enabled: row.enabled })),
    participants: (participantRows ?? []).map((row) => ({
      id: row.id,
      emailAddress: row.email_address,
      roleNote: row.role_note,
      enabled: row.enabled,
    })),
  };
}
