import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import {
  NotAuthorizedError,
  performActionRequestNotification,
  type ResolvedActionRequest,
  type SendActionRequestNotificationInput,
  type SendActionRequestNotificationResult,
} from "./action-request-notification-core";

export {
  NotAuthorizedError,
  DuplicateNotificationError,
  type SendActionRequestNotificationInput,
  type SendActionRequestNotificationResult,
} from "./action-request-notification-core";

/**
 * Resolução user-scoped: usa o client Supabase normal (RLS) para
 * confirmar que o ActionRequest existe e é visível ao usuário atual —
 * RLS já restringe a membros do projeto, então null aqui cobre tanto
 * "não existe" quanto "sem autorização" (nunca revelamos a diferença a
 * um não-membro). Sem qualquer bypass.
 */
async function resolveActionRequestForUser(
  actionRequestId: string
): Promise<ResolvedActionRequest> {
  const supabase = await createSupabaseServerClient();

  const { data: actionRequestRow, error: actionRequestError } = await supabase
    .from("action_requests")
    .select("id, project_id")
    .eq("id", actionRequestId)
    .maybeSingle();

  if (actionRequestError) {
    throw actionRequestError;
  }

  if (!actionRequestRow) {
    throw new NotAuthorizedError(
      `ActionRequest ${actionRequestId} não encontrado ou não autorizado para o usuário atual.`
    );
  }

  return { id: actionRequestRow.id as string, projectId: actionRequestRow.project_id as string };
}

/**
 * Ponto de entrada user-scoped: única forma válida de disparar uma
 * Notification a partir de uma UI/Server Action acionada por um usuário
 * logado. Resolve o ActionRequest via sessão real + RLS, depois delega
 * ao núcleo compartilhado (action-request-notification-core.ts).
 */
export async function sendActionRequestNotification(
  input: SendActionRequestNotificationInput
): Promise<SendActionRequestNotificationResult> {
  const resolved = await resolveActionRequestForUser(input.actionRequestId);
  return performActionRequestNotification(resolved, input);
}
