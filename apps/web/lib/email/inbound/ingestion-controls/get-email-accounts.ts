import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAccount } from "./types";

const COLUMNS =
  "id,email_address,display_name,status,last_sync_at,last_sync_error,connected_at,connected_by_user_id,created_at,updated_at";

function mapRow(row: Record<string, unknown>): EmailAccount {
  return {
    id: row.id as string,
    emailAddress: row.email_address as string,
    displayName: (row.display_name as string | null) ?? null,
    status: row.status as EmailAccount["status"],
    lastSyncAt: (row.last_sync_at as string | null) ?? null,
    lastSyncError: (row.last_sync_error as string | null) ?? null,
    connectedAt: (row.connected_at as string | null) ?? null,
    connectedByUserId: (row.connected_by_user_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getEmailAccounts(supabase: SupabaseClient): Promise<EmailAccount[]> {
  const { data, error } = await supabase.from("email_accounts").select(COLUMNS).order("email_address", { ascending: true });
  if (error) throw new Error(`Falha ao carregar contas de e-mail AXION: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapRow);
}
