import type {
  EmailDeliveryDirection,
  EmailDeliveryStatus,
  Notification,
  NotificationEmailDelivery,
  NotificationKind,
  NotificationRecipient,
  NotificationRecipientType,
  NotificationStatus,
} from "@axion/types";

export type NotificationRow = {
  id: string;
  project_id: string;
  action_request_id: string;
  kind: NotificationKind;
  status: NotificationStatus;
  subject: string;
  body: string;
  created_by_type: "SYSTEM" | "USER" | "LEGACY";
  created_by_user_id: string | null;
  created_by_label: string | null;
  created_at: string;
  sent_at: string | null;
};

export function mapNotificationRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    projectId: row.project_id,
    actionRequestId: row.action_request_id,
    kind: row.kind,
    status: row.status,
    subject: row.subject,
    body: row.body,
    createdByType: row.created_by_type,
    createdByUserId: row.created_by_user_id,
    createdByLabel: row.created_by_label,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

export type NotificationRecipientRow = {
  notification_id: string;
  project_id: string;
  recipient_type: NotificationRecipientType;
  recipient_user_id: string | null;
  recipient_email: string | null;
  created_at: string;
};

export function mapNotificationRecipientRow(row: NotificationRecipientRow): NotificationRecipient {
  return {
    notificationId: row.notification_id,
    projectId: row.project_id,
    recipientType: row.recipient_type,
    recipientUserId: row.recipient_user_id,
    recipientEmail: row.recipient_email,
    createdAt: row.created_at,
  };
}

export type NotificationEmailDeliveryRow = {
  id: string;
  notification_id: string;
  project_id: string;
  recipient_email: string;
  direction: EmailDeliveryDirection;
  status: EmailDeliveryStatus;
  email_id: string | null;
  correlation_id: string;
  provider: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  message_id_header: string | null;
  reply_to_delivery_id: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
};

export function mapNotificationEmailDeliveryRow(
  row: NotificationEmailDeliveryRow
): NotificationEmailDelivery {
  return {
    id: row.id,
    notificationId: row.notification_id,
    projectId: row.project_id,
    recipientEmail: row.recipient_email,
    direction: row.direction,
    status: row.status,
    emailId: row.email_id,
    correlationId: row.correlation_id,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    providerThreadId: row.provider_thread_id,
    messageIdHeader: row.message_id_header,
    replyToDeliveryId: row.reply_to_delivery_id,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  };
}
