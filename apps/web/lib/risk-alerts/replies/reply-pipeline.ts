// Pipeline PURO de processamento de respostas por e-mail aos alertas:
//   1. filtro (autoresposta / bounce / próprio ACC / loop);
//   2. correlação (In-Reply-To -> References -> Reply-To opaco -> código visível);
//   3. autorização (profile/membership ACTIVE, identidade corporativa,
//      allowlist ou exceção manual, Authentication-Results quando disponível);
//   4. limpeza (texto novo × citado × assinatura);
//   5. classificação determinística com confiança.
// O texto da resposta NUNCA é executado como instrução: só é classificado.
// Ambíguo => REVIEW_REQUIRED; sem identificação => PENDING_HUMAN_REVIEW.

import { createHash, randomBytes } from "node:crypto";

import { ALERT_REPLY_TAG, buildAlertReplyAddress } from "@/lib/email/alert-reply-address";

import type { ReplyClassification, ReplyCorrelationMethod } from "../types";

// ------------------------------------------------------------------
// Reply-To opaco / código visível
// ------------------------------------------------------------------
export const REPLY_TOKEN_PREFIX = ALERT_REPLY_TAG;
export const VISIBLE_CODE_PREFIX = "ACC-ALERTA:";

export function generateReplyToken(): string {
  // 24 bytes aleatórios, base64url — imprevisível; só o hash é persistido.
  return randomBytes(24).toString("base64url");
}

export function hashReplyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * <caixa-acc>+alerta-<token>@domínio — mesmo formato que o guard global
 * valida (lib/email/alert-reply-address.ts). A caixa é a inbound OFICIAL
 * monitorada pelo worker (GOOGLE_GMAIL_INBOUND_MAILBOX), nunca a caixa
 * pessoal de quem envia. Sem ids previsíveis nem secrets.
 */
export function buildOpaqueReplyTo(mailbox: string, token: string): string {
  return buildAlertReplyAddress(mailbox, token);
}

export function extractReplyTokens(addresses: string[]): string[] {
  const tokens: string[] = [];
  for (const address of addresses) {
    const match = /\+alerta-([A-Za-z0-9_-]{16,})@/i.exec(address);
    if (match) tokens.push(match[1]);
  }
  return tokens;
}

export function extractVisibleCodes(text: string): string[] {
  return Array.from(new Set([...text.matchAll(/ACC-ALERTA:([A-Z0-9]{8})/gi)].map((m) => m[1].toUpperCase())));
}

// ------------------------------------------------------------------
// 1. Filtro de mensagens automáticas / bounce / próprio / loop
// ------------------------------------------------------------------
export interface InboundHeaders {
  from: string;
  to: string[];
  cc?: string[];
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  replyTo?: string | null;
  autoSubmitted?: string | null;
  precedence?: string | null;
  xAutoReply?: string | null;
  xAutoRespond?: string | null;
  returnPath?: string | null;
  contentType?: string | null;
  authenticationResults?: string | null;
  subject?: string | null;
}

export type InboundFilterVerdict = "OK" | "IGNORED_AUTO_REPLY" | "IGNORED_BOUNCE" | "IGNORED_SELF" | "IGNORED_LOOP";

export function filterInboundMessage(headers: InboundHeaders, context: { accMailboxes: string[]; seenMessageIds: Set<string>; maxReferences?: number }): InboundFilterVerdict {
  const from = headers.from.trim().toLowerCase();
  const auto = (headers.autoSubmitted ?? "").toLowerCase();
  const precedence = (headers.precedence ?? "").toLowerCase();
  if ((auto && auto !== "no") || headers.xAutoReply || headers.xAutoRespond || precedence === "auto_reply" || precedence === "bulk" || precedence === "junk") return "IGNORED_AUTO_REPLY";
  if (/^(auto|automatic reply|resposta automática|out of office|ausência|fora do escritório)/i.test((headers.subject ?? "").trim())) return "IGNORED_AUTO_REPLY";
  if (
    /^mailer-daemon@|^postmaster@|noreply|no-reply|^bounce/i.test(from) ||
    (headers.returnPath ?? "").trim() === "<>" ||
    /multipart\/report/i.test(headers.contentType ?? "") ||
    /^(undeliverable|delivery status notification|mail delivery failed|falha na entrega)/i.test((headers.subject ?? "").trim())
  ) {
    return "IGNORED_BOUNCE";
  }
  if (context.accMailboxes.some((mailbox) => mailbox.toLowerCase() === from || from.startsWith(`${mailbox.toLowerCase().split("@")[0]}+`))) return "IGNORED_SELF";
  if (headers.messageId && context.seenMessageIds.has(headers.messageId)) return "IGNORED_LOOP";
  if (headers.references.length > (context.maxReferences ?? 40)) return "IGNORED_LOOP";
  return "OK";
}

// ------------------------------------------------------------------
// 2. Correlação com o alerta (ordem obrigatória)
// ------------------------------------------------------------------
export interface CorrelationIndex {
  /** Message-ID (com <>) de e-mails enviados -> caseId. */
  byMessageId: Map<string, string>;
  /** hash do token do Reply-To -> caseId. */
  byReplyTokenHash: Map<string, string>;
  /** código visível -> caseId. */
  byVisibleCode: Map<string, string>;
}

export interface CorrelationResult {
  caseId: string | null;
  method: ReplyCorrelationMethod;
  ambiguous: boolean;
}

export function correlateReply(headers: InboundHeaders, bodyText: string, index: CorrelationIndex): CorrelationResult {
  const normalize = (id: string) => id.trim().replace(/^<?/, "<").replace(/>?$/, ">");
  if (headers.inReplyTo) {
    const caseId = index.byMessageId.get(normalize(headers.inReplyTo));
    if (caseId) return { caseId, method: "IN_REPLY_TO", ambiguous: false };
  }
  const referenced = Array.from(new Set(headers.references.map(normalize).map((id) => index.byMessageId.get(id)).filter((id): id is string => Boolean(id))));
  if (referenced.length === 1) return { caseId: referenced[0], method: "REFERENCES", ambiguous: false };
  if (referenced.length > 1) return { caseId: null, method: "REFERENCES", ambiguous: true };
  const tokens = extractReplyTokens([...headers.to, ...(headers.cc ?? [])]);
  const byToken = Array.from(new Set(tokens.map((t) => index.byReplyTokenHash.get(hashReplyToken(t))).filter((id): id is string => Boolean(id))));
  if (byToken.length === 1) return { caseId: byToken[0], method: "REPLY_TO_TOKEN", ambiguous: false };
  if (byToken.length > 1) return { caseId: null, method: "REPLY_TO_TOKEN", ambiguous: true };
  const codes = extractVisibleCodes(`${headers.subject ?? ""}\n${bodyText}`);
  const byCode = Array.from(new Set(codes.map((c) => index.byVisibleCode.get(c)).filter((id): id is string => Boolean(id))));
  if (byCode.length === 1) return { caseId: byCode[0], method: "VISIBLE_CODE", ambiguous: false };
  if (byCode.length > 1) return { caseId: null, method: "VISIBLE_CODE", ambiguous: true };
  return { caseId: null, method: "NONE", ambiguous: false };
}

// ------------------------------------------------------------------
// 3. Autorização do remetente
// ------------------------------------------------------------------
export interface ReplySenderContext {
  senderEmail: string;
  /** profile encontrado pelo e-mail corporativo (único). */
  profile: { userId: string; email: string; active: boolean } | null;
  membershipStatus: string | null;
  /** destinatários originais/encaminhados válidos do alerta (user_ids). */
  alertRecipientUserIds: string[];
  allowlistUserIds: string[];
  /** encaminhamento manual ativo para este usuário (exceção do piloto). */
  activeForwardToUserId: string | null;
  corporateDomain: string;
  authenticationResults: string | null;
}

export type ReplyAuthorization =
  | { authorized: true; userId: string; note: string | null }
  | { authorized: false; reason: "UNKNOWN_SENDER" | "PROFILE_INACTIVE" | "MEMBERSHIP_INACTIVE" | "NOT_RECIPIENT" | "NOT_CORPORATE" | "AUTH_FAILED" | "NOT_ALLOWLISTED" };

export function parseAuthenticationResults(value: string | null): { spf: string | null; dkim: string | null; dmarc: string | null } {
  if (!value) return { spf: null, dkim: null, dmarc: null };
  const pick = (name: string) => {
    const match = new RegExp(`${name}=(pass|fail|softfail|neutral|none|temperror|permerror|policy)`, "i").exec(value);
    return match ? match[1].toLowerCase() : null;
  };
  return { spf: pick("spf"), dkim: pick("dkim"), dmarc: pick("dmarc") };
}

export function authorizeReply(ctx: ReplySenderContext): ReplyAuthorization {
  const sender = ctx.senderEmail.trim().toLowerCase();
  if (sender.split("@")[1] !== ctx.corporateDomain.toLowerCase()) return { authorized: false, reason: "NOT_CORPORATE" };
  if (!ctx.profile || ctx.profile.email.toLowerCase() !== sender) return { authorized: false, reason: "UNKNOWN_SENDER" };
  if (!ctx.profile.active) return { authorized: false, reason: "PROFILE_INACTIVE" };
  if (ctx.membershipStatus !== "ACTIVE") return { authorized: false, reason: "MEMBERSHIP_INACTIVE" };
  const auth = parseAuthenticationResults(ctx.authenticationResults);
  if ([auth.spf, auth.dkim, auth.dmarc].some((v) => v === "fail" || v === "permerror")) return { authorized: false, reason: "AUTH_FAILED" };
  const userId = ctx.profile.userId;
  const isRecipient = ctx.alertRecipientUserIds.includes(userId) || ctx.activeForwardToUserId === userId;
  if (!isRecipient) return { authorized: false, reason: "NOT_RECIPIENT" };
  const allowlisted = ctx.allowlistUserIds.includes(userId) || ctx.activeForwardToUserId === userId;
  if (!allowlisted) return { authorized: false, reason: "NOT_ALLOWLISTED" };
  const note = ctx.authenticationResults ? null : "Authentication-Results indisponível — identidade validada por profile/membership/domínio corporativo.";
  return { authorized: true, userId, note };
}

// ------------------------------------------------------------------
// 4. Limpeza do corpo (texto novo × citado × assinatura)
// ------------------------------------------------------------------
export interface ParsedReplyBody {
  clean: string;
  quoted: string;
  signature: string;
}

const QUOTE_HEADER_PATTERNS = [
  /^Em .{3,80} escreveu:\s*$/im,
  /^On .{3,80} wrote:\s*$/im,
  /^-{2,}\s*(Original Message|Mensagem original)\s*-{2,}\s*$/im,
  /^(De|From):\s.+\n(Enviad[oa]|Sent|Date|Data):\s.+/im,
  /^_{10,}\s*$/m,
];
const SIGNATURE_PATTERNS = [/^-- \s*$/m, /^(Atenciosamente|Att\.?,?|Abraços?|Cordialmente|Obrigad[oa]|Regards|Best regards|Kind regards)[,.]?\s*$/im, /^(Enviado do meu|Sent from my) /im];

export function parseReplyBody(raw: string): ParsedReplyBody {
  const text = raw.replace(/\r\n?/g, "\n");
  let cut = text.length;
  for (const pattern of QUOTE_HEADER_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  const firstQuoteLine = text.search(/^>/m);
  if (firstQuoteLine >= 0 && firstQuoteLine < cut) cut = firstQuoteLine;
  let head = text.slice(0, cut);
  const quoted = text.slice(cut).trim();
  let signature = "";
  let sigCut = head.length;
  for (const pattern of SIGNATURE_PATTERNS) {
    const match = pattern.exec(head);
    if (match && match.index > 0 && match.index < sigCut) sigCut = match.index;
  }
  if (sigCut < head.length) {
    signature = head.slice(sigCut).trim();
    head = head.slice(0, sigCut);
  }
  return { clean: head.trim(), quoted, signature };
}

// ------------------------------------------------------------------
// 5. Classificação determinística (nunca executa instruções do texto)
// ------------------------------------------------------------------
export interface ReplyClassificationResult {
  classification: ReplyClassification;
  confidence: number;
  ambiguous: boolean;
  matched: string[];
}

const RULES: Array<{ classification: ReplyClassification; patterns: RegExp[] }> = [
  { classification: "QUESTION_TO_EXPERT", patterns: [/\b(especialista|expert|consultar|parecer)\b/i, /\?\s*$/m] },
  { classification: "REQUEST_MORE_INFORMATION", patterns: [/\b(mais informa[çc][õo]es|preciso de mais|detalhar|esclarecer|qual (é|foi)|poderia informar)\b/i] },
  { classification: "DISAGREEMENT", patterns: [/\b(discordo|n[ãa]o concordo|n[ãa]o procede|incorreto|equivocad[oa]|contesto)\b/i] },
  { classification: "DECISION", patterns: [/\b(decid[io]|autorizo|aprovo|reprovo|determino|fica definido)\b/i] },
  { classification: "JUSTIFICATION", patterns: [/\b(justificativa|motivo|porque|devido a|em raz[ãa]o de|atras(o|ou) por)\b/i] },
  { classification: "STATUS_UPDATE", patterns: [/\b(andamento|status|providenci(a|ando)|em execu[çc][ãa]o|previs[ãa]o|estamos|conclu[íi]do em|resolvid[oa]|tratad[oa])\b/i] },
  { classification: "ACKNOWLEDGEMENT", patterns: [/\b(ciente|de acordo|ok|recebido|estou ciente|tomei ci[êe]ncia|confirmo o recebimento|assumo)\b/i] },
];

const INJECTION_PATTERNS = [/ignore (all|previous|as) instru/i, /system prompt/i, /voc[êe] (agora )?[ée] (um|o) (assistente|sistema)/i, /execute|run the following|delete|drop table/i];

export function classifyReply(cleanText: string): ReplyClassificationResult {
  const text = cleanText.trim();
  if (!text) return { classification: "UNCLASSIFIED", confidence: 0, ambiguous: true, matched: [] };
  // Tentativas de instrução ao sistema são só texto: nunca viram ação.
  if (INJECTION_PATTERNS.some((p) => p.test(text))) return { classification: "UNCLASSIFIED", confidence: 0.1, ambiguous: true, matched: ["INJECTION_LIKE"] };
  const hits = RULES.map((rule) => ({ rule, count: rule.patterns.filter((p) => p.test(text)).length })).filter((h) => h.count > 0);
  if (hits.length === 0) return { classification: "UNCLASSIFIED", confidence: 0.2, ambiguous: true, matched: [] };
  hits.sort((a, b) => b.count - a.count);
  const [best, second] = hits;
  const ambiguous = Boolean(second && second.count === best.count) || text.length < 4;
  const confidence = Math.min(0.95, 0.5 + best.count * 0.2 - (second ? 0.1 : 0));
  return { classification: best.rule.classification, confidence: Number(confidence.toFixed(2)), ambiguous, matched: hits.map((h) => h.rule.classification) };
}

/** Só ACKNOWLEDGEMENT e STATUS_UPDATE inequívocos viram ação formal (respectivamente OTHER com texto e TAKING_ACTION); o resto é registro/revisão. */
export function replyToFormalAction(result: ReplyClassificationResult): "TAKING_ACTION" | "OTHER" | "EXPERT_CONSULTATION" | null {
  if (result.ambiguous || result.confidence < 0.6) return null;
  if (result.classification === "STATUS_UPDATE") return "TAKING_ACTION";
  if (result.classification === "ACKNOWLEDGEMENT") return "OTHER";
  if (result.classification === "QUESTION_TO_EXPERT") return "EXPERT_CONSULTATION";
  return null;
}
