import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";
import {
  NotAuthorizedError,
  performActionRequestNotification,
  type ResolvedActionRequest,
  type SendActionRequestNotificationInput,
  type SendActionRequestNotificationResult,
} from "./action-request-notification-core";

/**
 * Resolução system-scoped: para chamadores internos confiáveis — hoje o
 * harness de DEV, futuramente Cron/webhook — que por definição não têm
 * sessão de usuário. Resolve via admin client diretamente (sem RLS,
 * porque não há sessão para avaliar).
 *
 * A segurança aqui NÃO vem de RLS — vem de quem tem permissão de invocar
 * esta função. Este módulo (e sendActionRequestNotificationAsSystem) NUNCA
 * deve ser importado por código client-side nem reexportado por uma rota
 * pública. O chamador precisa estar, ele mesmo, atrás de autenticação
 * própria (ex.: apps/web/proxy.ts para o harness de DEV) ou de um
 * segredo/assinatura dedicado (futuro Cron/webhook).
 */
async function resolveActionRequestForSystem(
  actionRequestId: string
): Promise<ResolvedActionRequest> {
  const admin = createSupabaseAdminClient();

  const { data: actionRequestRow, error: actionRequestError } = await admin
    .from("action_requests")
    .select("id, project_id")
    .eq("id", actionRequestId)
    .maybeSingle();

  if (actionRequestError) {
    throw actionRequestError;
  }

  if (!actionRequestRow) {
    throw new NotAuthorizedError(`ActionRequest ${actionRequestId} não encontrado.`);
  }

  return { id: actionRequestRow.id as string, projectId: actionRequestRow.project_id as string };
}

/**
 * Ponto de entrada system-scoped: usado por chamadores internos que não
 * têm sessão de usuário. Resolve o ActionRequest via admin client, depois
 * delega ao mesmo núcleo compartilhado usado pelo caminho user-scoped
 * (action-request-notification-core.ts) — nenhuma lógica de
 * Notification/Recipient/Delivery/Email/provider duplicada.
 */
export async function sendActionRequestNotificationAsSystem(
  input: SendActionRequestNotificationInput
): Promise<SendActionRequestNotificationResult> {
  const resolved = await resolveActionRequestForSystem(input.actionRequestId);
  return performActionRequestNotification(resolved, input);
}
