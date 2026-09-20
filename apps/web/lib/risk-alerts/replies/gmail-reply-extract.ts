// Extração PURA de uma mensagem Gmail (format=full) para a linha INBOUND
// de alert_email_messages: cabeçalhos de correlação/autenticação/auto
// e o corpo text/plain (fallback: HTML sem tags). Sem rede, sem I/O.
// O corpo é persistido só em alert_email_messages — nunca em logs.

import type { InboundHeaders } from "./reply-pipeline";

export interface GmailHeader {
  name?: string | null;
  value?: string | null;
}
export interface GmailPart {
  mimeType?: string | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
  headers?: GmailHeader[] | null;
}
export interface GmailMessageLike {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  internalDate?: string | null;
  payload?: GmailPart | null;
}

function header(headers: GmailHeader[] | null | undefined, name: string): string | null {
  const found = (headers ?? []).find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

export function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPart(part: GmailPart | null | undefined, mimeType: string): GmailPart | null {
  if (!part) return null;
  if ((part.mimeType ?? "").toLowerCase() === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

export function extractAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set((value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((a) => a.toLowerCase())));
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Limite do corpo persistido (text/plain preferido; HTML só como fallback, sem tags). Acima disso, truncado com marcador. */
export const MAX_INBOUND_BODY_CHARS = 100_000;

export function limitInboundBody(body: string): string {
  const normalized = body.replace(/\u0000/g, "");
  return normalized.length > MAX_INBOUND_BODY_CHARS
    ? `${normalized.slice(0, MAX_INBOUND_BODY_CHARS)}\n[... truncado pelo ACC: ${normalized.length - MAX_INBOUND_BODY_CHARS} caracteres omitidos ...]`
    : normalized;
}

export interface ExtractedInbound {
  providerMessageId: string;
  providerThreadId: string | null;
  headers: InboundHeaders;
  bodyOriginal: string;
  receivedAt: string;
  isSentByMailbox: boolean;
}

export function extractInboundFromGmail(message: GmailMessageLike, mailbox: string): ExtractedInbound | null {
  if (!message.id || !message.payload) return null;
  const headers = message.payload.headers ?? [];
  const from = extractAddresses(header(headers, "From"))[0] ?? "";
  const references = (header(headers, "References") ?? "").split(/\s+/).filter(Boolean);
  const plain = findPart(message.payload, "text/plain");
  const html = plain ? null : findPart(message.payload, "text/html");
  const body = plain?.body?.data ? decodeBase64Url(plain.body.data) : html?.body?.data ? stripHtml(decodeBase64Url(html.body.data)) : "";
  const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString();
  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId ?? null,
    headers: {
      from,
      to: extractAddresses(header(headers, "To")),
      cc: extractAddresses(header(headers, "Cc")),
      messageId: header(headers, "Message-ID"),
      inReplyTo: header(headers, "In-Reply-To"),
      references,
      replyTo: header(headers, "Reply-To"),
      autoSubmitted: header(headers, "Auto-Submitted"),
      precedence: header(headers, "Precedence"),
      xAutoReply: header(headers, "X-Autoreply") ?? header(headers, "X-Auto-Response-Suppress"),
      xAutoRespond: header(headers, "X-Autorespond"),
      returnPath: header(headers, "Return-Path"),
      contentType: header(headers, "Content-Type"),
      authenticationResults: header(headers, "Authentication-Results"),
      subject: header(headers, "Subject"),
    },
    bodyOriginal: limitInboundBody(body),
    receivedAt,
    isSentByMailbox: (message.labelIds ?? []).includes("SENT") || from === mailbox.toLowerCase() || from.startsWith(`${mailbox.toLowerCase().split("@")[0]}+`),
  };
}
