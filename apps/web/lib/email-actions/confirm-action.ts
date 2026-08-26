import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import { hashEmailActionToken } from "./token-crypto";

export class EmailActionConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailActionConfirmError";
  }
}

export interface ConfirmEmailAlertActionInput {
  rawToken: string;
  comment?: string | null;
  newDueAt?: string | null; // ISO — usado só para SET_DEADLINE
}

export interface ConfirmEmailAlertActionResult {
  id: string;
  action: string;
  comment: string | null;
  newDueAt: string | null;
  newResponsibleUserId: string | null;
}

// POST-only por construção: só é chamada pelo Server Action por trás do
// formulário de confirmação (nunca por um handler GET). Usa o client
// normal — o RPC confirm_email_alert_action é quem faz toda a
// autorização real (auth.uid(), membership ACTIVE, permissão por ação,
// alerta pertencente ao projeto do token) — nunca confiamos em nada que
// vem do navegador além do token e do payload específico da ação.
export async function confirmEmailAlertAction(
  input: ConfirmEmailAlertActionInput
): Promise<ConfirmEmailAlertActionResult> {
  const supabase = await createSupabaseServerClient();
  const tokenHash = await hashEmailActionToken(input.rawToken);

  const { data, error } = await supabase
    .rpc("confirm_email_alert_action", {
      p_token_hash: tokenHash,
      p_comment: input.comment ?? null,
      p_new_due_at: input.newDueAt ?? null,
    })
    .single();

  if (error) {
    throw new EmailActionConfirmError(error.message);
  }

  const row = data as {
    id: string;
    action: string;
    comment: string | null;
    new_due_at: string | null;
    new_responsible_user_id: string | null;
  };

  return {
    id: row.id,
    action: row.action,
    comment: row.comment,
    newDueAt: row.new_due_at,
    newResponsibleUserId: row.new_responsible_user_id,
  };
}
