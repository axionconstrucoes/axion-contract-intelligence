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

const ASCII_ONLY = /^[\x00-\x7f]*$/;

// Remove CR/LF (e NUL) de um valor antes de virar header MIME — a única
// defesa real contra header injection: um valor contendo "\r\nBcc:
// atacante@x.com" (ou qualquer outro header forjado) nunca pode virar uma
// nova linha de header só porque passou raw por um template string. CR/LF
// são ASCII puro (passariam ilesos por ASCII_ONLY abaixo se não fossem
// removidos aqui ANTES do teste) — por isso esta função roda sempre,
// mesmo para valores 100% ASCII.
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").trim();
}

// RFC 2047 "encoded-word" (=?UTF-8?B?<base64>?=) — único jeito seguro de
// colocar texto não-ASCII (acentos, "ç", "—") num header MIME, que por
// definição só pode conter bytes 7-bit. Sem isso, o Subject cru com bytes
// UTF-8 soltos no header é reinterpretado por trechos do transporte/alguns
// clientes como Latin-1 — a causa raiz do mojibake ("Fábrica" -> "FÃ¡brica").
// ASCII puro passa direto, sem custo/risco de dupla codificação. O valor
// já chega aqui sanitizado (sanitizeHeaderValue é chamado por
// buildMimeMessage antes de qualquer header, inclusive o Subject).
export function encodeMimeHeaderValue(value: string): string {
  if (ASCII_ONLY.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

// Companheiro de encodeMimeHeaderValue — decodifica exatamente o formato
// que ela produz. Não é um decodificador RFC 2047 genérico (não precisa
// ser: nenhum outro código deste projeto gera Subject com outro charset/
// encoding) — existe para os testes validarem round-trip exato do Subject
// sem depender de nenhuma lib externa.
export function decodeMimeHeaderValue(value: string): string {
  const match = value.match(/^=\?UTF-8\?B\?([^?]*)\?=$/i);
  if (!match) return value;
  return Buffer.from(match[1], "base64").toString("utf-8");
}

// Corpo (text/plain ou text/html) sempre em UTF-8 e SEMPRE com
// Content-Transfer-Encoding: base64 explícito — nunca deixar implícito
// (o padrão MIME assume "7bit" na ausência do header, e os bytes UTF-8
// multi-byte de "á"/"ç"/"ã"/"—" violam essa suposição; alguns saltos de
// transporte então corrompem/perdem o 8º bit). Base64 evita esse risco
// por completo, sem depender de nenhum salto do transporte ser "8bit
// clean". wrapBase64 (76 col) é a mesma função já usada para a imagem
// inline — nunca duplicada.
function encodeMimeBodyBase64(content: string): string {
  return wrapBase64(Buffer.from(content, "utf-8").toString("base64"));
}

// `from` é sempre o endereço PURO (ex.: "acc_ia@axion.com.br"), nunca um
// header já formatado — formatSenderHeader (chamada uma única vez, aqui
// dentro) é quem adiciona o display-name/"<...>". Passar um valor já
// formatado produz um From duplicado/aninhado; formatSenderHeader agora
// recusa em runtime qualquer valor que contenha "<"/">"/'"' para tornar
// esse erro impossível de passar despercebido.
export function buildMimeMessage(input: SendEmailInput, from: string, messageIdHeader: string): string {
  // Todo valor dinâmico que vira header passa por sanitizeHeaderValue
  // primeiro — nunca confiar que "só é um e-mail"/"só é um UUID" dispensa
  // a sanitização (defesa em profundidade contra header injection).
  const headers = [
    `From: ${sanitizeHeaderValue(formatSenderHeader(from))}`,
    `To: ${sanitizeHeaderValue(input.to)}`,
    `Subject: ${encodeMimeHeaderValue(sanitizeHeaderValue(input.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${sanitizeHeaderValue(messageIdHeader)}`,
    "MIME-Version: 1.0",
  ];

  if (input.replyTo) {
    headers.push(`Reply-To: ${sanitizeHeaderValue(input.replyTo)}`);
  }

  if (!input.html) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: base64");
    return `${headers.join("\r\n")}\r\n\r\n${encodeMimeBodyBase64(input.text)}`;
  }

  const boundary = buildMimeBoundary(input.correlationId);
  const alternativeBody = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBodyBase64(input.text),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBodyBase64(input.html),
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
    .map((image) => {
      const filename = sanitizeHeaderValue(image.filename);
      const mimeType = sanitizeHeaderValue(image.mimeType);
      const cid = sanitizeHeaderValue(image.cid);
      return [
        `--${relatedBoundary}`,
        `Content-Type: ${mimeType}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${cid}>`,
        `Content-Disposition: inline; filename="${filename}"`,
        "",
        wrapBase64(image.contentBase64),
      ].join("\r\n");
    })
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
