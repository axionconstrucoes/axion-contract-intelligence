// Leitura bruta de emails com as colunas de proveniência de mailbox
// (mailbox_address/direction/provider_message_id) usadas pelo Dashboard
// Visual (recebidos/enviados globais + volume por mailbox). Separado de
// getEmails (lib/data.ts) para não alterar o contrato já usado por
// outras telas — mesma tabela, seleção de colunas própria para este uso.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailVolumeRow } from "./compute-email-summary";

const COLUMNS = "id, mailbox_address, direction, provider_message_id, sent_at";

type Row = {
  id: string;
  mailbox_address: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  provider_message_id: string | null;
  sent_at: string;
};

export async function getEmailVolumeRows(supabase: SupabaseClient, projectId: string): Promise<EmailVolumeRow[]> {
  const { data, error } = await supabase.from("emails").select(COLUMNS).eq("project_id", projectId);

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar volume de e-mails: ${error.message}`);
  }

  return (data as Row[]).map((row) => ({
    id: row.id,
    mailboxAddress: row.mailbox_address,
    direction: row.direction,
    providerMessageId: row.provider_message_id,
    sentAt: row.sent_at,
  }));
}
