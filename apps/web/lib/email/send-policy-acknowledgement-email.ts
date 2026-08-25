import "server-only";

import { randomUUID } from "node:crypto";

import { createSupabaseServerClient } from "@axion/db/server";

import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";
import { getEmailProvider } from "./get-email-provider";

import {
  buildPolicyAcknowledgementEmail,
} from "./templates/policy-acknowledgement-template";

type PolicySendContext = {
  acknowledgement_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  term_title: string;
  term_version: string;
  can_send: boolean;
  is_reminder: boolean;
  resend_available_at: string | null;
  reminder_count: number;
};

function getAccBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();

  if (vercelUrl) {
    return `https://${vercelUrl.replace(/\/+$/, "")}`;
  }

  return "http://localhost:3000";
}

function formatPublicationDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export async function sendPolicyAcknowledgementEmail(input: {
  projectId: string;
  acknowledgementId: string;
}) {
  const supabase = await createSupabaseServerClient();

  const { data: contexts, error: contextError } = await supabase.rpc(
    "get_policy_acknowledgement_send_context",
    {
      p_project_id: input.projectId,
      p_acknowledgement_id: input.acknowledgementId,
    }
  );

  if (contextError) {
    throw new Error(contextError.message);
  }

  const context = (contexts?.[0] ?? null) as PolicySendContext | null;

  if (!context) {
    throw new Error("Contexto de envio do Termo não encontrado.");
  }

  if (!context.can_send) {
    throw new Error(
      context.is_reminder
        ? "O prazo mínimo para reenvio do Termo ainda não foi atingido."
        : "O Termo não está disponível para envio."
    );
  }

  const { data: term, error: termError } = await supabase
    .from("corporate_policy_terms")
    .select("effective_at")
    .eq("code", "RESOURCE_USE_POLICY")
    .eq("version", context.term_version)
    .single();

  if (termError || !term) {
    throw new Error(
      termError?.message ?? "Versão do Termo não encontrada."
    );
  }

  const inlineLogo = await loadAccLogoInlineImage();

  if (!inlineLogo) {
    throw new Error(
      "Logo oficial do ACC não encontrado para o e-mail institucional."
    );
  }

  const approvalUrl =
    `${getAccBaseUrl()}/termo/${context.acknowledgement_id}`;

  const { subject, html, text } =
    buildPolicyAcknowledgementEmail({
      recipientName: context.user_name,
      termTitle: context.term_title,
      termVersion: context.term_version,
      publicationDate: formatPublicationDate(term.effective_at),
      approvalUrl,
      isReminder: context.is_reminder,
      logoCid: inlineLogo.cid,
    });

  const provider = getEmailProvider();

  const sendResult = await provider.send({
    to: context.user_email,
    subject,
    text,
    html,
    correlationId: randomUUID(),
    inlineImages: inlineLogo ? [inlineLogo] : undefined,
  });

  const { error: registerError } = await supabase.rpc(
    "register_policy_acknowledgement_email_sent",
    {
      p_project_id: input.projectId,
      p_acknowledgement_id: context.acknowledgement_id,
      p_provider: sendResult.provider,
      p_provider_message_id: sendResult.providerMessageId,
      p_provider_thread_id: sendResult.providerThreadId,
      p_message_id_header: sendResult.messageIdHeader,
      p_sent_at: sendResult.sentAt,
    }
  );

  if (registerError) {
    throw new Error(
      `E-mail enviado, mas o registro de auditoria falhou: ${registerError.message}`
    );
  }

  return sendResult;
}