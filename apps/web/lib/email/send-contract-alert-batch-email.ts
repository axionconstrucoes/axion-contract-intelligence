import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";
import { EmailSendError } from "./email-provider";
import { getEmailProvider } from "./get-email-provider";
import { resolveEffectiveRecipient } from "./pilot-outbound-guard";
import {
  buildContractAlertBatchEmail,
  type ContractAlertBatchEmailInput,
} from "./templates/contract-alert-batch-template";

// Mesmo padrão de send-weekly-alert-digest-email.ts: constrói o e-mail,
// aplica o guard de piloto (resolveEffectiveRecipient — nunca uma
// segunda decisão de destinatário efetivo), envia, e só então grava o
// resultado no lote (SENT + effective_recipient_email/provider_message_id/
// sent_at, ou FAILED sem nunca marcar RESPONDED). Chamado tanto pelo job
// semanal automático (run-weekly-contract-alert-batches.ts) quanto —
// futuramente, se a ferramenta administrativa excepcional ganhar um
// botão de envio — pelo caminho manual; a lógica de envio é uma só.
export async function sendContractAlertBatchEmail(input: {
  batchId: string;
  projectId: string;
  intendedRecipientEmail: string;
  email: ContractAlertBatchEmailInput;
}) {
  const built = buildContractAlertBatchEmail(input.email);
  const inlineLogo = loadAccLogoInlineImage();
  const signed = appendAccEmailSignature(built, inlineLogo !== null);
  const resolvedRecipient = resolveEffectiveRecipient(input.intendedRecipientEmail);
  const correlationId = crypto.randomUUID();
  const provider = getEmailProvider();
  const admin = createSupabaseAdminClient();

  let sent;
  try {
    sent = await provider.send({
      to: input.intendedRecipientEmail,
      subject: built.subject,
      text: signed.text,
      html: signed.html,
      inlineImages: inlineLogo ? [inlineLogo] : undefined,
      correlationId,
    });
  } catch (error) {
    await admin
      .from("contract_alert_batches")
      .update({ status: "FAILED", failure_reason: "Falha no envio do lote de alertas." })
      .eq("id", input.batchId)
      .neq("status", "RESPONDED");

    if (error instanceof EmailSendError) throw error;
    throw new EmailSendError("Falha ao enviar o lote de alertas de contrato.");
  }

  // Marca SENT antes de qualquer registro auxiliar — uma falha de
  // auditoria depois que o provedor já aceitou a mensagem nunca deve
  // provocar um segundo e-mail numa repetição do job.
  const { error: batchError } = await admin
    .from("contract_alert_batches")
    .update({
      status: "SENT",
      effective_recipient_email: resolvedRecipient.effectiveRecipientEmail,
      provider_message_id: sent.providerMessageId,
      sent_at: sent.sentAt,
      correlation_id: correlationId,
      failure_reason: null,
    })
    .eq("id", input.batchId)
    .in("status", ["PENDING", "FAILED"]);

  if (batchError) {
    throw new EmailSendError("O e-mail foi aceito pelo provedor, mas o registro do lote falhou.");
  }

  await admin.from("emails").insert({
    project_id: input.projectId,
    from_address: sent.from,
    to_address: input.intendedRecipientEmail,
    subject: built.subject,
    sent_at: sent.sentAt,
    snippet: built.text.slice(0, 280),
  });

  await admin.from("audit_log_entries").insert({
    project_id: input.projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action: "CONTRACT_ALERT_BATCH_SENT",
    entity_type: "CONTRACT_ALERT_BATCH",
    entity_id: input.batchId,
    detail: `Lote de alertas enviado com ${input.email.items.length} evento(s). CorrelationId=${correlationId}.`,
  });

  return { sent, correlationId };
}
