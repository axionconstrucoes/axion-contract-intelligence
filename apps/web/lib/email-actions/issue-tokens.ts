import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { getAppBaseUrl } from "@/lib/app-base-url";
import { resolveEffectiveRecipient } from "@/lib/email/pilot-outbound-guard";

import { buildEmailActionUrl } from "./urls";
import { resolveAllowedEmailActions } from "./resolve-allowed-actions";
import type { EmailAlertActionType, EmailAlertKind } from "./types";
import type { EmailActionButton } from "./render-buttons";

export interface IssueEmailAlertActionTokensInput {
  projectId: string;
  alertKind: EmailAlertKind;
  alertId: string;
  intendedRecipientEmail: string;
  // Por padrão resolve as ações plausíveis para quem de fato vai
  // conseguir clicar (resolveAllowedEmailActions) — passar
  // explicitamente só para sobrescrever esse cálculo (não deveria ser
  // necessário nos 3 fluxos existentes). O RPC de confirmação continua
  // sendo a autoridade real de quem pode executar o quê, sempre — isto
  // aqui é só UX (nunca transfere autoridade: quem confirma é sempre o
  // usuário realmente autenticado no momento do clique, nunca quem o
  // link foi endereçado a).
  actions?: readonly EmailAlertActionType[];
  sourceEmailId?: string | null;
  providerMessageId?: string | null;
}

// Único ponto que os três fluxos de e-mail (alerta de contrato,
// escalonamento SLA, solicitação de ação) chamam para obter os botões
// de ação prontos para o template — nunca chamam o RPC diretamente,
// nunca geram token por conta própria. Usa o admin client (mesmo padrão
// de send-contract-alert-email.ts/action-request-notification-core.ts
// para os writes técnicos: quem está montando um e-mail aqui é o
// sistema, não uma sessão de usuário interativa) — mas o RPC em si
// segue sendo SECURITY DEFINER e GRANT restrito a service_role, nunca
// authenticated/anon.
export async function issueEmailAlertActionButtons(
  input: IssueEmailAlertActionTokensInput
): Promise<EmailActionButton[]> {
  const admin = createSupabaseAdminClient();
  const baseUrl = getAppBaseUrl();

  // Fonte única (pilot-outbound-guard.ts) — nunca uma segunda leitura
  // de ACC_OUTBOUND_MODE/ACC_PILOT_RECIPIENT aqui. Em produção, quem de
  // fato recebe é o destinatário pretendido; em piloto, é sempre
  // reynaldo@axion.com.br — o mesmo cálculo que o envio real usa.
  const resolved = resolveEffectiveRecipient(input.intendedRecipientEmail);

  // Em produção, os botões são oferecidos conforme a permissão de quem
  // FOI ENDEREÇADO o e-mail. Em piloto, quem de fato recebe (e pode
  // clicar) é sempre reynaldo@axion.com.br — oferecer botões calculados
  // pela permissão de um terceiro que nunca vai ver o e-mail seria
  // inútil; a permissão relevante é a de quem efetivamente recebe.
  const permissionCheckEmail =
    resolved.mode === "PILOT" ? resolved.effectiveRecipientEmail : resolved.intendedRecipientEmail;

  const actions =
    input.actions ?? (await resolveAllowedEmailActions(admin, input.projectId, permissionCheckEmail));

  if (actions.length === 0) {
    return [];
  }

  const { data, error } = await admin.rpc("issue_email_alert_action_tokens", {
    p_project_id: input.projectId,
    p_alert_kind: input.alertKind,
    p_alert_id: input.alertId,
    p_intended_recipient_email: resolved.intendedRecipientEmail,
    p_effective_recipient_email: resolved.effectiveRecipientEmail,
    p_actions: actions,
    p_source_email_id: input.sourceEmailId ?? null,
    p_provider_message_id: input.providerMessageId ?? null,
  });

  if (error) {
    throw error;
  }

  const rows = data as { action: EmailAlertActionType; token: string; expires_at: string }[];

  return rows.map((row) => ({
    action: row.action,
    url: buildEmailActionUrl(baseUrl, row.token),
  }));
}
