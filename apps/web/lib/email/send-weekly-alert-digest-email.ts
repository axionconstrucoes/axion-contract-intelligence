import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";
import { EmailSendError } from "./email-provider";
import { getEmailProvider } from "./get-email-provider";
import { resolveEffectiveRecipient } from "./pilot-outbound-guard";
import {
  buildWeeklyAlertDigestEmail,
  type WeeklyAlertDigestEmailInput,
} from "./templates/weekly-alert-digest-template";

export async function sendWeeklyAlertDigestEmail(input: {
  digestId: string;
  projectId: string;
  recipientEmail: string;
  email: WeeklyAlertDigestEmailInput;
}) {
  const built = buildWeeklyAlertDigestEmail(input.email);
  const inlineLogo = loadAccLogoInlineImage();
  const signed = appendAccEmailSignature(built, inlineLogo !== null);
  const resolvedRecipient = resolveEffectiveRecipient(input.recipientEmail);
  const correlationId = crypto.randomUUID();
  const provider = getEmailProvider();
  const admin = createSupabaseAdminClient();

  let sent;
  try {
    sent = await provider.send({
      to: input.recipientEmail,
      subject: built.subject,
      text: signed.text,
      html: signed.html,
      inlineImages: inlineLogo ? [inlineLogo] : undefined,
      correlationId,
    });
  } catch (error) {
    await admin
      .from("weekly_alert_digests")
      .update({ status: "FAILED", failure_reason: "Falha no envio do resumo semanal." })
      .eq("id", input.digestId)
      .neq("status", "RESPONDED");

    if (error instanceof EmailSendError) throw error;
    throw new EmailSendError("Falha ao enviar o resumo semanal de alertas.");
  }

  // Marca como enviado antes dos registros auxiliares. Assim, uma falha
  // de auditoria depois que o Gmail aceitou a mensagem nunca provoca um
  // segundo e-mail na repetição do agendador.
  const { error: digestError } = await admin
    .from("weekly_alert_digests")
    .update({
      status: "SENT",
      effective_recipient_email: resolvedRecipient.effectiveRecipientEmail,
      provider_message_id: sent.providerMessageId,
      sent_at: sent.sentAt,
      failure_reason: null,
    })
    .eq("id", input.digestId)
    .in("status", ["PENDING", "FAILED"]);

  if (digestError) {
    throw new EmailSendError("O e-mail foi aceito pelo provedor, mas o registro do envio falhou.");
  }

  await admin.from("emails").insert({
    project_id: input.projectId,
    from_address: sent.from,
    to_address: input.recipientEmail,
    subject: built.subject,
    sent_at: sent.sentAt,
    snippet: built.text.slice(0, 280),
  });

  await admin.from("audit_log_entries").insert({
    project_id: input.projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action: "WEEKLY_ALERT_DIGEST_SENT",
    entity_type: "WEEKLY_ALERT_DIGEST",
    entity_id: input.digestId,
    detail: `Resumo semanal enviado com ${built.mediumCount} risco(s) médio(s) e ${built.lowCount} risco(s) baixo(s).`,
  });

  return sent;
}
