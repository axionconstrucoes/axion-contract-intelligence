// Puro (só tipos + uma classe de erro), sem I/O — deliberadamente sem
// "server-only" para ser importável tanto pelo bundler do Next.js quanto
// por um script Node standalone (mesmo padrão de
// apps/web/lib/ai/providers/types.ts).
//
// Imagem embutida por Content-ID (ex.: logo da assinatura institucional
// ACC) — só tem efeito quando `html` também está presente (vira
// multipart/related envolvendo o multipart/alternative existente).
// `contentBase64` já vem codificado (nunca lido de disco aqui — isso é
// responsabilidade de quem monta o SendEmailInput).
export interface InlineImageAttachment {
  cid: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
}

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
  // Imagens inline referenciadas por "cid:" dentro de `html` — ignorado
  // quando `html` está ausente. Nenhum caller existente precisa mudar.
  inlineImages?: InlineImageAttachment[];
  replyTo?: string;
  // Contexto que AUTORIZA um Reply-To: só mensagens de uma conversa de
  // alerta de risco (outbox + conversa válidas) podem pedir Reply-To, e
  // mesmo assim o guard do piloto valida formato/caixa/domínio/token
  // (lib/email/pilot-outbound-guard.ts: resolveGuardedReplyTo). Sem este
  // contexto, qualquer Reply-To é removido em modo piloto.
  replyToContext?: AlertReplyToContext;
  // Continuidade de thread (respostas do ACC dentro da mesma conversa de
  // alerta): In-Reply-To / References. Nunca destinatários — o guard do
  // piloto não precisa tocá-los.
  inReplyTo?: string;
  references?: string[];
  correlationId: string;
}

export interface AlertReplyToContext {
  kind: "RISK_ALERT_CONVERSATION";
  outboxId: string;
  conversationId: string;
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
