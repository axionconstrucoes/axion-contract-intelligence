import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@axion/db/admin";
import { EmailSendError } from "./email-provider";
import { getEmailProvider } from "./get-email-provider";

export class NotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

export class DuplicateNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateNotificationError";
  }
}

export interface SendActionRequestNotificationInput {
  actionRequestId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface SendActionRequestNotificationResult {
  notificationId: string;
  deliveryId: string;
  emailId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId: string;
  messageIdHeader: string;
  sentAt: string;
}

// Resultado da resolução de autorização — entregue por qualquer um dos
// dois wrappers (user-scoped/system-scoped) ao núcleo. Deliberadamente
// carrega "id" + "projectId" (não só projectId) para deixar explícito que
// a autorização ocorreu para ESTE ActionRequest específico.
export interface ResolvedActionRequest {
  id: string;
  projectId: string;
}

/**
 * Núcleo comum (Camada B, integração server-only) — nunca chamado
 * diretamente por uma rota; só pelos wrappers user-scoped/system-scoped
 * depois que a resolução de autorização de cada um já confirmou o
 * ActionRequest e seu projeto. Usa o admin client para os writes técnicos
 * (Notification/Recipient/Delivery/Email), que não têm policy de INSERT
 * sob RLS normal. Lógica de Notification/Recipient/Delivery/Email/
 * provider nunca duplicada entre os wrappers.
 *
 * Consistência: sem transação multi-step real (Supabase JS não oferece
 * isso de forma simples). Sequência deliberada — PENDING primeiro, depois
 * o envio externo, só então os updates finais — para que qualquer falha
 * intermediária deixe um estado auditável/recuperável (nunca um envio
 * real "esquecido" como PENDING para sempre sem rastro).
 *
 * Idempotência: mitigada por um check-then-insert (recusa se já existir
 * Notification INITIAL PENDING/SENT para o mesmo ActionRequest). Isso NÃO
 * é uma garantia atômica — uma condição de corrida entre duas chamadas
 * simultâneas ainda é teoricamente possível sem uma constraint de banco
 * dedicada, que exigiria migration (fora de escopo deste lote).
 */
export async function performActionRequestNotification(
  resolved: ResolvedActionRequest,
  input: SendActionRequestNotificationInput
): Promise<SendActionRequestNotificationResult> {
  const projectId = resolved.projectId;
  const admin = createSupabaseAdminClient();

  const { data: existingNotification, error: existingError } = await admin
    .from("notifications")
    .select("id")
    .eq("action_request_id", resolved.id)
    .eq("kind", "INITIAL")
    .in("status", ["PENDING", "SENT"])
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingNotification) {
    throw new DuplicateNotificationError(
      `Já existe uma Notification INITIAL (PENDING ou SENT) para o ActionRequest ${resolved.id}.`
    );
  }

  const correlationId = randomUUID();

  const { data: notificationRow, error: notificationInsertError } = await admin
    .from("notifications")
    .insert({
      project_id: projectId,
      action_request_id: resolved.id,
      kind: "INITIAL",
      status: "PENDING",
      subject: input.subject,
      body: input.body,
      created_by_type: "SYSTEM",
    })
    .select("id")
    .single();

  if (notificationInsertError) {
    throw notificationInsertError;
  }

  const notificationId = notificationRow.id as string;

  const { error: recipientInsertError } = await admin.from("notification_recipients").insert({
    notification_id: notificationId,
    project_id: projectId,
    recipient_type: "EMAIL",
    recipient_email: input.recipientEmail,
  });

  if (recipientInsertError) {
    throw recipientInsertError;
  }

  const { data: deliveryRow, error: deliveryInsertError } = await admin
    .from("notification_email_deliveries")
    .insert({
      notification_id: notificationId,
      project_id: projectId,
      recipient_email: input.recipientEmail,
      direction: "OUTBOUND",
      status: "PENDING",
      correlation_id: correlationId,
    })
    .select("id")
    .single();

  if (deliveryInsertError) {
    throw deliveryInsertError;
  }

  const deliveryId = deliveryRow.id as string;

  const provider = getEmailProvider();

  let sendResult;
  try {
    sendResult = await provider.send({
      to: input.recipientEmail,
      subject: input.subject,
      text: input.body,
      correlationId,
    });
  } catch (error) {
    const { error: failedUpdateError } = await admin
      .from("notification_email_deliveries")
      .update({ status: "FAILED" })
      .eq("id", deliveryId);

    if (failedUpdateError) {
      throw failedUpdateError;
    }

    if (error instanceof EmailSendError) {
      throw error;
    }
    throw new EmailSendError("Falha inesperada ao enviar notificação.");
  }

  const { data: emailRow, error: emailInsertError } = await admin
    .from("emails")
    .insert({
      project_id: projectId,
      from_address: sendResult.from,
      to_address: input.recipientEmail,
      subject: input.subject,
      sent_at: sendResult.sentAt,
      snippet: input.body.slice(0, 280),
    })
    .select("id")
    .single();

  if (emailInsertError) {
    throw emailInsertError;
  }

  const emailId = emailRow.id as string;

  const { error: deliveryUpdateError } = await admin
    .from("notification_email_deliveries")
    .update({
      status: "SENT",
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
      provider_thread_id: sendResult.providerThreadId,
      message_id_header: sendResult.messageIdHeader,
      email_id: emailId,
      sent_at: sendResult.sentAt,
    })
    .eq("id", deliveryId);

  if (deliveryUpdateError) {
    throw deliveryUpdateError;
  }

  const { error: notificationUpdateError } = await admin
    .from("notifications")
    .update({ status: "SENT", sent_at: sendResult.sentAt })
    .eq("id", notificationId);

  if (notificationUpdateError) {
    throw notificationUpdateError;
  }

  return {
    notificationId,
    deliveryId,
    emailId,
    provider: sendResult.provider,
    providerMessageId: sendResult.providerMessageId,
    providerThreadId: sendResult.providerThreadId,
    messageIdHeader: sendResult.messageIdHeader,
    sentAt: sendResult.sentAt,
  };
}
