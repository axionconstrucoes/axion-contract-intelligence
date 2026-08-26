import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import { hashEmailActionToken } from "./token-crypto";
import type { EmailAlertActionType, EmailAlertKind } from "./types";

export interface EmailAlertActionContext {
  alertKind: EmailAlertKind;
  alertId: string;
  action: EmailAlertActionType;
  projectId: string;
  projectName: string;
  expiresAt: string;
  isExpired: boolean;
  isConsumed: boolean;
  canExecute: boolean;
}

// GET-only (nunca muda estado) — usado pela página /email-actions/[token]
// para decidir o que renderizar (formulário de confirmação, expirado, já
// usado, sem permissão). Usa o client normal (RLS + auth.uid() reais da
// sessão) — nunca o admin client aqui, isso pularia a checagem de
// membership que get_email_alert_action_context faz no servidor.
export async function getEmailAlertActionContext(
  rawToken: string
): Promise<EmailAlertActionContext | null> {
  const supabase = await createSupabaseServerClient();
  const tokenHash = await hashEmailActionToken(rawToken);

  const { data, error } = await supabase
    .rpc("get_email_alert_action_context", { p_token_hash: tokenHash })
    .maybeSingle();

  if (error) {
    // Mesmo "não encontrado" tanto para token inexistente/expirado
    // quanto para um token válido de projeto inacessível — nunca
    // distinguimos os dois na UI (ver comentário do RPC).
    return null;
  }

  if (!data) {
    return null;
  }

  const row = data as {
    alert_kind: EmailAlertKind;
    alert_id: string;
    action: EmailAlertActionType;
    project_id: string;
    project_name: string;
    expires_at: string;
    is_expired: boolean;
    is_consumed: boolean;
    can_execute: boolean;
  };

  return {
    alertKind: row.alert_kind,
    alertId: row.alert_id,
    action: row.action,
    projectId: row.project_id,
    projectName: row.project_name,
    expiresAt: row.expires_at,
    isExpired: row.is_expired,
    isConsumed: row.is_consumed,
    canExecute: row.can_execute,
  };
}
