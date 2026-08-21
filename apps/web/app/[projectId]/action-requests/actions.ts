"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { EmailSendError } from "@/lib/email/email-provider";
import {
  DuplicateNotificationError,
  sendActionRequestNotification,
} from "@/lib/email/send-action-request-notification";

function getRequiredString(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();

  if (!value) {
    throw new Error(`Campo obrigatório ausente: ${key}`);
  }

  return value;
}

// sendActionRequestNotification já resolve auth + membership via RLS
// (createSupabaseServerClient) antes de tocar o admin client — nunca
// duplicamos essa checagem aqui. Falhas conhecidas (já enviada / falha de
// envio) não derrubam a página: o estado real já foi persistido pelo core,
// e o redirect abaixo faz a página renderizar de novo a partir do banco.
export async function sendActionRequestEmailAction(formData: FormData) {
  const projectId = getRequiredString(formData, "projectId");
  const actionRequestId = getRequiredString(formData, "actionRequestId");
  const recipientEmail = getRequiredString(formData, "recipientEmail");
  const subject = getRequiredString(formData, "subject");
  const body = getRequiredString(formData, "body");

  try {
    await sendActionRequestNotification({
      actionRequestId,
      recipientEmail,
      subject,
      body,
    });
  } catch (error) {
    if (!(error instanceof DuplicateNotificationError) && !(error instanceof EmailSendError)) {
      throw error;
    }
  }

  revalidatePath(`/${projectId}/action-requests/${actionRequestId}`);
  redirect(`/${projectId}/action-requests/${actionRequestId}`);
}
