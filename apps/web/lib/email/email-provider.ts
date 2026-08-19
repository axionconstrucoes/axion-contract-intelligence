import "server-only";

// Contrato mínimo de envio de email. "from" NÃO é escolhido pelo caller —
// cada provider resolve internamente sua própria mailbox de envio e a
// devolve em SendEmailResult, nunca a recebe como input arbitrário.
export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  correlationId: string;
}

// Resultado normalizado — nunca expõe a resposta raw do provider ao domínio.
export interface SendEmailResult {
  provider: string;
  from: string;
  providerMessageId: string;
  providerThreadId: string;
  messageIdHeader: string;
  sentAt: string; // ISO datetime
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

// Erro sanitizado de envio — nunca deve carregar secrets/tokens/headers brutos.
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}
