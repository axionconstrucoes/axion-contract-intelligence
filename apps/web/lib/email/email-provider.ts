// Puro (só tipos + uma classe de erro), sem I/O — deliberadamente sem
// "server-only" para ser importável tanto pelo bundler do Next.js quanto
// por um script Node standalone (mesmo padrão de
// apps/web/lib/ai/providers/types.ts).
//
// Contrato mínimo de envio de email. "from" NÃO é escolhido pelo caller —
// cada provider resolve internamente sua própria mailbox de envio e a
// devolve em SendEmailResult, nunca a recebe como input arbitrário.
export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  // Corpo HTML opcional — quando presente, o provider envia
  // multipart/alternative (text/plain + text/html); quando ausente,
  // continua exatamente como antes (text/plain puro). Nenhum caller
  // existente precisa mudar.
  html?: string;
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
