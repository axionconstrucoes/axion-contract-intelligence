// Representação legível de um e-mail (seção 8) — usada quando o e-mail
// faz parte da exportação. NUNCA é o arquivo .eml original: o schema
// atual não armazena a mensagem bruta nem anexos (ver
// docs/timeline-export.md, "Limitações conhecidas"), só
// from/to/subject/sent_at/snippet. CC não existe no schema — omitido,
// nunca inventado.

import type { TimelineEmailContext } from "./types";

export function buildEmailTextRepresentation(email: TimelineEmailContext): string {
  return [
    "[Representação legível gerada pelo ACC — não é o arquivo .eml original]",
    "",
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Date: ${email.sentAt}`,
    `Subject: ${email.subject}`,
    "",
    "Corpo (trecho disponível no sistema):",
    email.snippet,
    "",
    "Anexos: não disponíveis (não modelados no sistema nesta fase).",
  ].join("\n");
}

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

/** Sanitiza um nome para uso seguro dentro do pacote ZIP — nunca modifica o conteúdo do arquivo, só o nome do arquivo empacotado. */
export function sanitizeFileNameSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}
