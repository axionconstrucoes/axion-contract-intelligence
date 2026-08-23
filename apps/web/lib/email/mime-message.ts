// Construção pura da mensagem MIME (raw, base64url) — deliberadamente
// sem "server-only" e sem I/O/credenciais, extraída de
// gmail-email-provider.ts (que continua "server-only", pois é lá que a
// credencial OAuth de fato é usada) para ser testável tanto pelo bundler
// do Next.js quanto por um script Node standalone.

import type { SendEmailInput } from "./email-provider";
import { formatSenderHeader } from "./sender-identity";

export function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Boundary determinístico (nunca Math.random, mesma convenção de IDs
// sintéticos do resto do projeto) — derivado do correlationId, que já é
// único por envio.
export function buildMimeBoundary(correlationId: string): string {
  return `acc-boundary-${correlationId}`;
}

function buildRelatedBoundary(correlationId: string): string {
  return `acc-boundary-${correlationId}-related`;
}

// Base64 "puro" (sem quebras) é aceito pela API do Gmail, mas quebrar em
// linhas de 76 colunas mantém a mensagem compatível com o padrão MIME
// (RFC 2045) para qualquer outro consumidor que venha a processar o raw.
function wrapBase64(content: string): string {
  return content.replace(/(.{76})/g, "$1\r\n");
}

export function buildMimeMessage(input: SendEmailInput, from: string, messageIdHeader: string): string {
  const headers = [
    `From: ${formatSenderHeader(from)}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageIdHeader}`,
    "MIME-Version: 1.0",
  ];

  if (input.replyTo) {
    headers.push(`Reply-To: ${input.replyTo}`);
  }

  if (!input.html) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    return `${headers.join("\r\n")}\r\n\r\n${input.text}`;
  }

  const boundary = buildMimeBoundary(input.correlationId);
  const alternativeBody = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    input.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  if (!input.inlineImages || input.inlineImages.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    return `${headers.join("\r\n")}\r\n\r\n${alternativeBody}`;
  }

  // Imagens inline (ex.: logo da assinatura institucional) exigem
  // envolver o multipart/alternative existente num multipart/related —
  // nunca substituir a estrutura text/plain+text/html já usada.
  const relatedBoundary = buildRelatedBoundary(input.correlationId);
  const imageParts = input.inlineImages
    .map((image) =>
      [
        `--${relatedBoundary}`,
        `Content-Type: ${image.mimeType}; name="${image.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${image.cid}>`,
        `Content-Disposition: inline; filename="${image.filename}"`,
        "",
        wrapBase64(image.contentBase64),
      ].join("\r\n")
    )
    .join("\r\n");

  headers.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);

  const body = [
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    alternativeBody,
    imageParts,
    `--${relatedBoundary}--`,
  ].join("\r\n");

  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}
