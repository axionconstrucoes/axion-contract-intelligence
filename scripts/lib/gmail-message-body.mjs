const MAX_BODY_CHARS = 1_000_000;

function decodeBase64Url(value) {
  if (!value) return "";
  return Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

function collectParts(part, mimeType, output = []) {
  if (!part) return output;

  if (
    String(part.mimeType ?? "").toLowerCase() === mimeType &&
    part.body?.data
  ) {
    output.push(decodeBase64Url(part.body.data));
  }

  for (const child of part.parts ?? []) {
    collectParts(child, mimeType, output);
  }

  return output;
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToText(html) {
  return decodeEntities(
    String(html ?? "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
}

function limit(value) {
  const text = String(value ?? "").replace(/\u0000/g, "");

  if (text.length <= MAX_BODY_CHARS) {
    return text;
  }

  return (
    text.slice(0, MAX_BODY_CHARS) +
    `\n[... truncado pelo ACC: ${
      text.length - MAX_BODY_CHARS
    } caracteres omitidos ...]`
  );
}

export function extractGmailBody(message) {
  const payload = message?.payload;

  if (!payload) {
    return {
      bodyText: "",
      bodyHtml: "",
    };
  }

  const plainParts = collectParts(payload, "text/plain");
  const htmlParts = collectParts(payload, "text/html");

  let bodyText = plainParts.join("\n\n").trim();
  let bodyHtml = htmlParts.join("\n").trim();

  // Mensagens simples podem ter o corpo direto no payload raiz.
  if (!bodyText && !bodyHtml && payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    const mime = String(payload.mimeType ?? "").toLowerCase();

    if (mime === "text/html") {
      bodyHtml = decoded;
    } else {
      bodyText = decoded;
    }
  }

  if (!bodyText && bodyHtml) {
    bodyText = htmlToText(bodyHtml);
  }

  return {
    bodyText: limit(bodyText),
    bodyHtml: limit(bodyHtml),
  };
}
