import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import type { EmailAlertKind } from "./types";

const TABLE_BY_KIND: Record<EmailAlertKind, string> = {
  CONTRACT_EVENT: "contract_events",
  SLA_ACTION: "sla_actions",
  ACTION_REQUEST: "action_requests",
};

// Só para exibição na tela de confirmação — lido com o client normal
// (RLS), nunca o admin client. Se a linha não for visível (não deveria
// acontecer aqui, já que get_email_alert_action_context já confirmou
// a membership), devolve null e a página mostra só o tipo do alerta.
export async function getEmailAlertTitle(
  alertKind: EmailAlertKind,
  alertId: string
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from(TABLE_BY_KIND[alertKind])
    .select("title")
    .eq("id", alertId)
    .maybeSingle();

  return (data as { title?: string } | null)?.title ?? null;
}
