import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import type { EmailAlertActionType, EmailAlertKind } from "./types";

export interface EmailAlertActionHistoryEntry {
  id: string;
  action: EmailAlertActionType;
  actorUserId: string;
  comment: string | null;
  previousDueAt: string | null;
  newDueAt: string | null;
  previousResponsibleUserId: string | null;
  newResponsibleUserId: string | null;
  occurredAt: string;
}

// Leitura do "estado central" descrito no relatório da feature de
// e-mail acionável: para CONTRACT_EVENT (que não tem responsável/prazo/
// ciência nativos) e para RESPOND em SLA_ACTION (que não tem tabela de
// comentário própria), email_alert_actions é a ÚNICA fonte — por isso
// as telas correspondentes (Ledger, Ações e Escalonamentos) precisam
// chamar esta função para não deixarem essas ações "invisíveis" fora da
// tabela técnica. Client normal (RLS via
// email_alert_actions_select_project_members_only) — nunca admin client
// para leitura de página.
export async function getEmailAlertActionHistory(
  alertKind: EmailAlertKind,
  alertId: string
): Promise<EmailAlertActionHistoryEntry[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("email_alert_actions")
    .select(
      "id,action,actor_user_id,comment,previous_due_at,new_due_at,previous_responsible_user_id,new_responsible_user_id,occurred_at"
    )
    .eq("alert_kind", alertKind)
    .eq("alert_id", alertId)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(`Falha ao carregar histórico de ações de e-mail: ${error.message}`);
  }

  const rows = data as unknown as {
    id: string;
    action: EmailAlertActionType;
    actor_user_id: string;
    comment: string | null;
    previous_due_at: string | null;
    new_due_at: string | null;
    previous_responsible_user_id: string | null;
    new_responsible_user_id: string | null;
    occurred_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actor_user_id,
    comment: row.comment,
    previousDueAt: row.previous_due_at,
    newDueAt: row.new_due_at,
    previousResponsibleUserId: row.previous_responsible_user_id,
    newResponsibleUserId: row.new_responsible_user_id,
    occurredAt: row.occurred_at,
  }));
}
