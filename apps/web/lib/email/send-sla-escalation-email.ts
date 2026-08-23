import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";
import { EmailSendError } from "./email-provider";
import { getEmailProvider } from "./get-email-provider";
import { buildSlaEscalationEmail, type SlaEscalationEmailInput } from "./templates/sla-escalation-template";

export interface SendSlaEscalationEmailInput {
  projectId: string;
  actionId: string;
  recipientEmail: string;
  email: SlaEscalationEmailInput;
}

export interface SendSlaEscalationEmailResult {
  emailId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId: string;
  messageIdHeader: string;
  sentAt: string;
}

/**
 * Envio do e-mail de escalonamento (seção 12) — chamado SOMENTE pelo
 * motor determinístico de SLA (ver
 * apps/web/app/[projectId]/acoes/actions.ts, processSlaEscalationsAction),
 * nunca por decisão de um Expert (seção 13: "O MOTOR DE SLA pode enviar
 * alertas automáticos determinísticos autorizados pelo sistema" — isso é
 * deliberadamente diferente de sendContractAlertEmail, que exige
 * confirmação humana explícita, porque aqui a autorização já é a regra
 * de SLA configurada, não uma decisão de conteúdo).
 *
 * Escreve em public.emails + audit_log_entries via admin client — mesmo
 * padrão de send-contract-alert-email.ts (nenhuma policy de INSERT
 * existe para essas tabelas sob RLS normal).
 */
export async function sendSlaEscalationEmail(
  input: SendSlaEscalationEmailInput
): Promise<SendSlaEscalationEmailResult> {
  const { subject, html, text } = buildSlaEscalationEmail(input.email);
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
    throw new EmailSendError("Falha inesperada ao enviar e-mail de escalonamento.");
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
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: "sla-engine",
    action: "ACTION_ESCALATED",
    entity_type: "SLA_ACTION",
    entity_id: input.actionId,
    detail: `E-mail de escalonamento enviado para ${input.recipientEmail}.`,
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
