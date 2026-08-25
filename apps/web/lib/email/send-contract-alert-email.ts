import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";
import { createSupabaseServerClient } from "@axion/db/server";

import { canEditProjectContent, getCurrentProjectPermission } from "@/lib/contract-review";

import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";
import { EmailSendError } from "./email-provider";
import { getEmailProvider } from "./get-email-provider";
import { buildContractAlertEmail, type ContractAlertEmailInput } from "./templates/contract-alert-template";

export class NotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

export interface SendContractAlertEmailInput {
  projectId: string;
  eventId: string;
  recipientEmail: string;
  alert: ContractAlertEmailInput;
}

export interface SendContractAlertEmailResult {
  emailId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId: string;
  messageIdHeader: string;
  sentAt: string;
}

/**
 * Envio do e-mail institucional de "Alerta do Contrato" (padrão ACC) — o
 * "SISTEMA ENVIA" final da cadeia IA prepara → humano revisa/edita →
 * humano aprova → sistema envia. Só é chamado depois que um humano
 * autenticado com permissão EDITOR/ADMIN confirmou o envio (nunca
 * automático a partir de um Expert).
 *
 * Autorização via RLS (sessão real do usuário); os writes técnicos
 * (emails/audit_log_entries) usam o admin client, mesmo padrão de
 * action-request-notification-core.ts — nenhuma policy de INSERT existe
 * para essas tabelas sob RLS normal, então não seria possível fazê-lo de
 * outra forma sem duplicar essa exceção em todo lugar.
 */
export async function sendContractAlertEmail(
  input: SendContractAlertEmailInput
): Promise<SendContractAlertEmailResult> {
  const supabase = await createSupabaseServerClient();

  const { data: eventRow, error: eventError } = await supabase
    .from("contract_events")
    .select("id")
    .eq("id", input.eventId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (eventError) {
    throw eventError;
  }

  if (!eventRow) {
    throw new NotAuthorizedError(
      `Evento ${input.eventId} não encontrado ou não autorizado para o usuário atual.`
    );
  }

  const permission = await getCurrentProjectPermission(input.projectId);
  if (!canEditProjectContent(permission)) {
    throw new NotAuthorizedError(
      "Envio de alerta por e-mail exige permissão de Colaborador, Gerente ou Administrador no projeto."
    );
  }

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    throw new NotAuthorizedError("Sessão expirada. Faça login novamente.");
  }

  const { subject, html, text } = buildContractAlertEmail(input.alert);
  const inlineLogo = loadAccLogoInlineImage();
  const signed = appendAccEmailSignature({ text, html }, inlineLogo !== null);

  const provider = getEmailProvider();
  const correlationId = crypto.randomUUID();

  let sendResult;
  try {
    sendResult = await provider.send({
      to: input.recipientEmail,
      subject,
      text: signed.text,
      html: signed.html,
      inlineImages: inlineLogo ? [inlineLogo] : undefined,
      correlationId,
    });
  } catch (error) {
    if (error instanceof EmailSendError) {
      throw error;
    }
    throw new EmailSendError("Falha inesperada ao enviar alerta do contrato.");
  }

  const admin = createSupabaseAdminClient();

  const { data: emailRow, error: emailInsertError } = await admin
    .from("emails")
    .insert({
      project_id: input.projectId,
      from_address: sendResult.from,
      to_address: input.recipientEmail,
      subject,
      sent_at: sendResult.sentAt,
      snippet: text.slice(0, 280),
    })
    .select("id")
    .single();

  if (emailInsertError) {
    throw emailInsertError;
  }

  const emailId = emailRow.id as string;

  const { error: auditError } = await admin.from("audit_log_entries").insert({
    project_id: input.projectId,
    actor_type: "USER",
    actor_user_id: authData.user.id,
    actor_label: null,
    action: "CONTRACT_ALERT_EMAIL_SENT",
    entity_type: "CONTRACT_EVENT",
    entity_id: input.eventId,
    // Resumo compacto — nunca o corpo integral do alerta no log de auditoria.
    detail: `Alerta de contrato (RISCO ${input.alert.severity}) enviado para ${input.recipientEmail}.`,
  });

  if (auditError) {
    throw auditError;
  }

  return {
    emailId,
    provider: sendResult.provider,
    providerMessageId: sendResult.providerMessageId,
    providerThreadId: sendResult.providerThreadId,
    messageIdHeader: sendResult.messageIdHeader,
    sentAt: sendResult.sentAt,
  };
}
