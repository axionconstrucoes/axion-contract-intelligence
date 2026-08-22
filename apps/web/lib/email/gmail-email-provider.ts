import "server-only";

import { google } from "googleapis";
import {
  EmailSendError,
  type EmailProvider,
  type SendEmailInput,
  type SendEmailResult,
} from "./email-provider";
import { loadGmailConfig, type GmailConfig } from "./gmail-auth";
import { base64UrlEncode, buildMimeMessage } from "./mime-message";

export { base64UrlEncode, buildMimeMessage };

// Usa OAuth2 da mailbox técnica dedicada (scope gmail.send).
// Não executa consent flow, não armazena refresh token em DB,
// não descobre credenciais e falha fechado (loadGmailConfig)
// se a configuração estiver incompleta.
export class GmailEmailProvider implements EmailProvider {
  private readonly config: GmailConfig;

  constructor() {
    this.config = loadGmailConfig();
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const senderDomain =
      this.config.senderEmail.split("@")[1] ?? "axion.local";

    const messageIdHeader = `<${input.correlationId}@${senderDomain}>`;

    const oauth2Client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret
    );

    oauth2Client.setCredentials({
      refresh_token: this.config.refreshToken,
    });

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client,
    });

    const raw = base64UrlEncode(
      buildMimeMessage(
        input,
        this.config.senderEmail,
        messageIdHeader
      )
    );

    let providerMessageId: string | null | undefined;
    let providerThreadId: string | null | undefined;

    try {
      const response = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw,
        },
      });

      providerMessageId = response.data.id;
      providerThreadId = response.data.threadId;
    } catch {
      // Log propositalmente sanitizado.
      // Nunca registra erro bruto retornado pelo SDK do Google,
      // pois ele pode conter detalhes da requisição.
      console.error(
        "[GmailEmailProvider] falha ao enviar via Gmail API."
      );

      throw new EmailSendError(
        "GmailEmailProvider: falha ao enviar via Gmail API."
      );
    }

    if (!providerMessageId || !providerThreadId) {
      throw new EmailSendError(
        "GmailEmailProvider: resposta do Gmail sem id/threadId."
      );
    }

    return {
      provider: "GMAIL",
      from: this.config.senderEmail,
      providerMessageId,
      providerThreadId,
      messageIdHeader,
      sentAt: new Date().toISOString(),
    };
  }
}