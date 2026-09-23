import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { getAppBaseUrl } from "../app-base-url";
import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";
import { EmailSendError } from "./email-provider";
import { getEmailProvider } from "./get-email-provider";
import { resolveEffectiveRecipient } from "./pilot-outbound-guard";
import {
  buildContractAlertBatchEmail,
  type ContractAlertBatchEmailItem,
} from "./templates/contract-alert-batch-template";

export type ContractAlertBatchSourceItem = Omit<ContractAlertBatchEmailItem, "respondItemUrl">;

export interface CreateAndSendContractAlertBatchInput {
  projectId: string;
  recipientUserId: string;
  items: ContractAlertBatchSourceItem[];
}

export interface CreateAndSendContractAlertBatchResult {
  batchId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId: string;
  messageIdHeader: string;
  sentAt: string;
}

function uniqueEventIds(items: readonly ContractAlertBatchSourceItem[]): string[] {
  return Array.from(new Set(items.map((item) => item.eventId)));
}

export async function createAndSendContractAlertBatch(
  input: CreateAndSendContractAlertBatchInput
): Promise<CreateAndSendContractAlertBatchResult> {
  if (!input.projectId || !input.recipientUserId || input.items.length === 0) {
    throw new EmailSendError("Dados insuficientes para criar o lote de alertas de contrato.");
  }

  const eventIds = uniqueEventIds(input.items);
  if (eventIds.length !== input.items.length) {
    throw new EmailSendError("O lote de alertas contém eventos duplicados.");
  }

  const admin = createSupabaseAdminClient();

  const [{ data: project, error: projectError }, { data: membership, error: membershipError }, { data: recipient, error: recipientError }] =
    await Promise.all([
      admin.from("projects").select("id,name").eq("id", input.projectId).maybeSingle(),
      admin
        .from("project_memberships")
        .select("user_id,status")
        .eq("project_id", input.projectId)
        .eq("user_id", input.recipientUserId)
        .eq("status", "ACTIVE")
        .maybeSingle(),
      admin.from("profiles").select("id,name,email").eq("id", input.recipientUserId).maybeSingle(),
    ]);

  if (projectError || !project) {
    throw new EmailSendError("Projeto do lote de alertas não encontrado.");
  }
  if (membershipError || !membership) {
    throw new EmailSendError("O destinatário não é um usuário ativo deste projeto.");
  }
  if (recipientError || !recipient?.email) {
    throw new EmailSendError("Destinatário do lote de alertas não encontrado.");
  }

  const { data: eventRows, error: eventError } = await admin
    .from("contract_events")
    .select("id,project_id")
    .in("id", eventIds);

  if (
    eventError ||
    !eventRows ||
    eventRows.length !== eventIds.length ||
    eventRows.some((event) => event.project_id !== input.projectId)
  ) {
    throw new EmailSendError("O lote contém evento ausente ou pertencente a outro projeto.");
  }

  const correlationId = crypto.randomUUID();
  const resolvedRecipient = resolveEffectiveRecipient(recipient.email);

  const { data: batch, error: batchError } = await admin
    .from("contract_alert_batches")
    .insert({
      project_id: input.projectId,
      recipient_user_id: input.recipientUserId,
      intended_recipient_email: recipient.email,
      correlation_id: correlationId,
    })
    .select("id")
    .single();

  if (batchError || !batch?.id) {
    throw new EmailSendError("Falha ao criar o lote de alertas de contrato.");
  }

  const batchId = batch.id as string;

  const { error: itemsError } = await admin.from("contract_alert_batch_items").insert(
    input.items.map((item, index) => ({
      batch_id: batchId,
      event_id: item.eventId,
      position: index + 1,
      severity: item.severity,
      title_snapshot: item.title,
    }))
  );

  if (itemsError) {
    await admin
      .from("contract_alert_batches")
      .update({ status: "FAILED", failure_reason: "Falha ao registrar os itens do lote." })
      .eq("id", batchId)
      .eq("status", "PENDING");
    throw new EmailSendError("Falha ao registrar os itens do lote de alertas.");
  }

  const baseUrl = getAppBaseUrl();
  const batchUrl = `${baseUrl}/${input.projectId}/ledger/lote-alertas/${batchId}`;
  const emailItems: ContractAlertBatchEmailItem[] = input.items.map((item) => ({
    ...item,
    respondItemUrl: `${batchUrl}#evento-${item.eventId}`,
  }));

  const inlineLogo = loadAccLogoInlineImage();
  const built = buildContractAlertBatchEmail({
    recipientName: recipient.name ?? null,
    projectName: project.name,
    batchUrl,
    items: emailItems,
    hasInlineLogo: inlineLogo !== null,
  });
  const signed = appendAccEmailSignature(built, inlineLogo !== null, false);
  const provider = getEmailProvider();

  let sent;
  try {
    sent = await provider.send({
      to: recipient.email,
      subject: built.subject,
      text: signed.text,
      html: signed.html,
      inlineImages: inlineLogo ? [inlineLogo] : undefined,
      correlationId,
    });
  } catch (error) {
    await admin
      .from("contract_alert_batches")
      .update({ status: "FAILED", failure_reason: "Falha no envio do lote de alertas de contrato." })
      .eq("id", batchId)
      .neq("status", "RESPONDED");

    if (error instanceof EmailSendError) throw error;
    throw new EmailSendError("Falha ao enviar o lote de alertas de contrato.");
  }

  // O provedor já aceitou a mensagem. Persistimos SENT antes dos registros
  // auxiliares para impedir reenvio acidental caso auditoria/e-mails falhem.
  const { error: sentUpdateError } = await admin
    .from("contract_alert_batches")
    .update({
      status: "SENT",
      effective_recipient_email: resolvedRecipient.effectiveRecipientEmail,
      provider_message_id: sent.providerMessageId,
      sent_at: sent.sentAt,
      failure_reason: null,
    })
    .eq("id", batchId)
    .in("status", ["PENDING", "FAILED"]);

  if (sentUpdateError) {
    throw new EmailSendError("O e-mail foi aceito pelo provedor, mas o registro do lote enviado falhou.");
  }

  await admin.from("emails").insert({
    project_id: input.projectId,
    from_address: sent.from,
    to_address: recipient.email,
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
    entity_id: batchId,
    detail: `Lote de alertas de contrato enviado com ${input.items.length} evento(s). CorrelationId=${correlationId}.`,
  });

  return {
    batchId,
    provider: sent.provider,
    providerMessageId: sent.providerMessageId,
    providerThreadId: sent.providerThreadId,
    messageIdHeader: sent.messageIdHeader,
    sentAt: sent.sentAt,
  };
}
