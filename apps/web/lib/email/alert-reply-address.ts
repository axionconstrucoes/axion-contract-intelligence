// Endereço de resposta (Reply-To) dos alertas de risco — PURO, sem I/O.
//
// Formato ÚNICO aceito:  <caixa-acc>+alerta-<token-opaco>@<domínio-configurado>
//   ex.: acc+alerta-Qm9vayB0aGUgc3RhZ2U@axion.com.br
//
// A caixa-acc é a caixa inbound OFICIAL monitorada pelo worker
// (GOOGLE_GMAIL_INBOUND_MAILBOX — a mesma variável que a fase `replies`
// lê no GitHub Actions). Nada aqui inventa domínio ou caixa: sem a
// variável não existe Reply-To válido e o guard remove o header.
//
// O token é aleatório (base64url, 16–64 caracteres), nunca um id do
// banco, nunca dados pessoais — e só o seu sha256 é persistido. Este
// módulo é compartilhado pelo guard global (lib/email) e pelo pipeline de
// respostas (lib/risk-alerts) para que os dois falem exatamente o mesmo
// formato.

export const ALERT_REPLY_MAILBOX_ENV = "GOOGLE_GMAIL_INBOUND_MAILBOX";
export const ALERT_REPLY_TAG = "alerta-";

const MAILBOX_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPLY_ADDRESS_PATTERN = /^([a-z0-9][a-z0-9._-]{0,63})\+alerta-([A-Za-z0-9_-]+)@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i;
// Qualquer coisa que permita quebrar/encadear headers ou disfarçar o
// endereço: controle, espaço, aspas, <>, vírgula/ponto-e-vírgula,
// parênteses, colchetes, barra invertida, dois-pontos, não-ASCII.
const HEADER_INJECTION_PATTERN = /[\u0000-\u001f\u007f-\uffff\s"'<>,;:()[\]\\]/;

export type AlertReplyToRejection =
  | "MISSING"
  | "CRLF"
  | "HEADER_INJECTION"
  | "MAILBOX_NOT_CONFIGURED"
  | "FORMAT_INVALID"
  | "DOMAIN_NOT_ALLOWED"
  | "MAILBOX_MISMATCH"
  | "TOKEN_INVALID"
  | "TOKEN_LOOKS_LIKE_IDENTIFIER";

export type AlertReplyToValidation = { ok: true; address: string; token: string; mailbox: string } | { ok: false; reason: AlertReplyToRejection };

/** Caixa inbound normalizada (minúsculas) ou null quando ausente/inválida. */
export function normalizeAlertReplyMailbox(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return MAILBOX_PATTERN.test(normalized) ? normalized : null;
}

export function isValidAlertReplyToken(token: string): boolean {
  return TOKEN_PATTERN.test(token) && !UUID_LIKE_PATTERN.test(token);
}

/** <caixa>+alerta-<token>@<domínio> — lança quando a caixa ou o token não servem (nunca monta endereço parcial). */
export function buildAlertReplyAddress(mailbox: string, token: string): string {
  const normalized = normalizeAlertReplyMailbox(mailbox);
  if (!normalized) throw new Error("Caixa inbound do ACC ausente ou inválida para o Reply-To do alerta.");
  if (!isValidAlertReplyToken(token)) throw new Error("Token do Reply-To inválido.");
  const [local, domain] = normalized.split("@");
  return `${local}+${ALERT_REPLY_TAG}${token}@${domain}`;
}

/**
 * Validação completa do Reply-To de um alerta contra a caixa configurada.
 * Ordem: presença → CR/LF → injeção → caixa configurada → formato →
 * domínio → caixa → token. Nunca devolve o token em mensagens de erro.
 */
export function validateAlertReplyTo(replyTo: string | null | undefined, configuredMailbox: string | null | undefined): AlertReplyToValidation {
  const raw = replyTo ?? "";
  if (!raw.trim()) return { ok: false, reason: "MISSING" };
  if (/[\r\n]/.test(raw)) return { ok: false, reason: "CRLF" };
  if (HEADER_INJECTION_PATTERN.test(raw)) return { ok: false, reason: "HEADER_INJECTION" };
  const mailbox = normalizeAlertReplyMailbox(configuredMailbox);
  if (!mailbox) return { ok: false, reason: "MAILBOX_NOT_CONFIGURED" };
  const match = REPLY_ADDRESS_PATTERN.exec(raw);
  if (!match) return { ok: false, reason: "FORMAT_INVALID" };
  const [, local, token, domain] = match;
  const [mailboxLocal, mailboxDomain] = mailbox.split("@");
  if (domain.toLowerCase() !== mailboxDomain) return { ok: false, reason: "DOMAIN_NOT_ALLOWED" };
  if (local.toLowerCase() !== mailboxLocal) return { ok: false, reason: "MAILBOX_MISMATCH" };
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "TOKEN_INVALID" };
  if (UUID_LIKE_PATTERN.test(token)) return { ok: false, reason: "TOKEN_LOOKS_LIKE_IDENTIFIER" };
  return { ok: true, address: `${mailboxLocal}+${ALERT_REPLY_TAG}${token}@${mailboxDomain}`, token, mailbox };
}
