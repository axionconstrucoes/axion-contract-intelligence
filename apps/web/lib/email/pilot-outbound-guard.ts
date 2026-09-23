// Trava global de e-mail do piloto — ponto único e obrigatório de
// proteção contra envio real a destinatários originais durante o
// piloto. Puro, sem I/O real (só lê variáveis de ambiente já
// recebidas por parâmetro) — deliberadamente sem "server-only" para
// poder ser chamado tanto por GmailEmailProvider ("server-only")
// quanto por FakeEmailProvider (deliberadamente sem "server-only",
// para ser testável por um script Node standalone) — nenhum dos dois
// pode enviar sem passar por aqui primeiro.
//
// Regra fail-closed (mesmo idioma já usado em gmail-auth.ts):
// - Somente o valor EXATO "production" libera destinatários originais.
// - Ausente, "pilot", vazio ou qualquer outro valor mantém o piloto
//   ativo — nunca abre a porta por engano.
// - Em modo piloto, somente os destinatários fixos da allowlist podem
//   receber mensagens. O destinatário de contingência configurado por
//   ACC_PILOT_RECIPIENT continua sendo Reynaldo; mensagens destinadas a
//   qualquer outra pessoa são redirecionadas para ele.
// - Sem qualquer desligamento automático por data/relógio — controlado
//   inteiramente por configuração de ambiente.

import { ACC_GO_LIVE_DATE } from "../acc-go-live";
import { ALERT_REPLY_MAILBOX_ENV, validateAlertReplyTo, type AlertReplyToRejection } from "./alert-reply-address";
import { EmailSendError, type SendEmailInput } from "./email-provider";

export const ACC_EXPECTED_PILOT_RECIPIENT = "reynaldo@axion.com.br";
export const ACC_PILOT_ALLOWED_RECIPIENTS = [
  ACC_EXPECTED_PILOT_RECIPIENT,
  "ricardo.silva@axion.com.br",
  "carlos.evandro@axion.com.br",
  "rosana.mendes@axion.com.br",
] as const;
export const PILOT_SUBJECT_PREFIX = "[TESTE CONTROLADO] ";

// Caixas INSTITUCIONAIS do ACC (não são pessoas): destino do override de
// entrega do piloto (project_weekly_schedule_ingestion_configs.
// pilot_delivery_override_email). Enviar para a própria caixa do ACC é
// intrinsecamente interno, por isso é admitido em modo piloto — a lista
// fixa de participantes acima permanece intacta.
export const ACC_PILOT_INSTITUTIONAL_MAILBOXES = ["axion@axion.com.br", "crm@axion.com.br"] as const;

// Extensão CONTROLADA da allowlist do piloto por ambiente — ponto único.
// ACC_PILOT_ADDITIONAL_RECIPIENTS = lista separada por vírgula de
// e-mails corporativos (mesmo domínio do destinatário piloto) que também
// podem receber a própria mensagem em modo piloto (ex.: novos
// participantes de um piloto específico). Regras fail-closed: entradas
// inválidas ou fora do domínio corporativo são IGNORADAS (nunca
// liberadas), o valor nunca é gravado em nenhum arquivo do repositório e
// a allowlist de cada fluxo (ex.: alertas de risco, por user_id) continua
// sendo a restrição efetiva — esta lista só decide o redirecionamento do
// provider. Sem a variável, comportamento idêntico ao anterior.
export const ACC_PILOT_ADDITIONAL_RECIPIENTS_ENV = "ACC_PILOT_ADDITIONAL_RECIPIENTS";
const ACC_PILOT_CORPORATE_DOMAIN = ACC_EXPECTED_PILOT_RECIPIENT.split("@")[1];

export function parsePilotAdditionalRecipients(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  return Array.from(
    new Set(
      rawValue
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => isValidEmailAddress(item) && item.split("@")[1] === ACC_PILOT_CORPORATE_DOMAIN)
    )
  );
}

/** Allowlist efetiva do provider em modo piloto: fixa + adicionais válidos do ambiente. */
export function resolvePilotAllowedRecipients(env: Pick<PilotOutboundGuardEnv, "additionalRecipients"> = defaultEnv()): string[] {
  return Array.from(new Set([...ACC_PILOT_ALLOWED_RECIPIENTS, ...ACC_PILOT_INSTITUTIONAL_MAILBOXES, ...parsePilotAdditionalRecipients(env.additionalRecipients)]));
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export interface PilotOutboundGuardEnv {
  outboundMode?: string;
  pilotRecipient?: string;
  /** Conteúdo de ACC_PILOT_ADDITIONAL_RECIPIENTS (ver parsePilotAdditionalRecipients). */
  additionalRecipients?: string;
  /** Caixa inbound OFICIAL do ACC (GOOGLE_GMAIL_INBOUND_MAILBOX) — única caixa admitida no Reply-To dos alertas. */
  alertReplyMailbox?: string;
  /** Registro de Reply-To removido (motivo apenas — nunca endereço/token). Default: console.warn. */
  onReplyToRemoved?: (reason: ReplyToRemovalReason) => void;
  now?: Date;
}

function defaultEnv(): PilotOutboundGuardEnv {
  return {
    outboundMode: process.env.ACC_OUTBOUND_MODE,
    pilotRecipient: process.env.ACC_PILOT_RECIPIENT,
    additionalRecipients: process.env[ACC_PILOT_ADDITIONAL_RECIPIENTS_ENV],
    alertReplyMailbox: process.env[ALERT_REPLY_MAILBOX_ENV],
    now: new Date(),
  };
}

// ------------------------------------------------------------------
// Reply-To: caminho PRINCIPAL da resposta pelo corpo do e-mail aos
// alertas de risco. Preservado SOMENTE quando todas valem:
//   - a mensagem declara replyToContext de uma conversa de alerta
//     (outbox + conversa válidas — ids UUID);
//   - o endereço é exatamente <caixa-acc>+alerta-<token>@<domínio da caixa>
//     (caixa = GOOGLE_GMAIL_INBOUND_MAILBOX, monitorada pelo worker);
//   - sem CR/LF, sem caracteres de injeção, domínio/caixa permitidos,
//     token opaco válido (nunca um id previsível).
// Qualquer outro Reply-To (externo, arbitrário, sem contexto) é removido
// e o motivo registrado — sem endereço nem token no log. O destinatário
// final continua sendo decidido por resolveEffectiveRecipient (o Reply-To
// nunca redireciona a mensagem para uma pessoa). Fallback de correlação
// quando removido: In-Reply-To / References / código visível.
// ------------------------------------------------------------------
export type ReplyToRemovalReason = "REPLY_CONTEXT_MISSING" | "REPLY_CONTEXT_INVALID" | AlertReplyToRejection;

export interface GuardedReplyTo {
  replyTo: string | undefined;
  removedReason: ReplyToRemovalReason | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveGuardedReplyTo(input: Pick<SendEmailInput, "replyTo" | "replyToContext">, env: Pick<PilotOutboundGuardEnv, "alertReplyMailbox"> = defaultEnv()): GuardedReplyTo {
  if (input.replyTo === undefined || input.replyTo === null || input.replyTo === "") return { replyTo: undefined, removedReason: null };
  const context = input.replyToContext;
  if (!context) return { replyTo: undefined, removedReason: "REPLY_CONTEXT_MISSING" };
  if (context.kind !== "RISK_ALERT_CONVERSATION" || !UUID_PATTERN.test(context.outboxId ?? "") || !UUID_PATTERN.test(context.conversationId ?? "")) {
    return { replyTo: undefined, removedReason: "REPLY_CONTEXT_INVALID" };
  }
  const validation = validateAlertReplyTo(input.replyTo, env.alertReplyMailbox);
  if (!validation.ok) return { replyTo: undefined, removedReason: validation.reason };
  return { replyTo: validation.address, removedReason: null };
}

function reportReplyToRemoved(env: PilotOutboundGuardEnv, reason: ReplyToRemovalReason): void {
  if (env.onReplyToRemoved) {
    env.onReplyToRemoved(reason);
    return;
  }
  // Só o motivo: nunca o endereço original, nunca o token.
  console.warn(`[pilot-outbound-guard] Reply-To removido (${reason}).`);
}

function dateInSaoPaulo(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Único valor que desliga o piloto — qualquer outra coisa (incluindo
// ausência) mantém a proteção ativa.
export function resolveOutboundMode(env: PilotOutboundGuardEnv = defaultEnv()): "PRODUCTION" | "PILOT" {
  // Mesmo que a variável de produção tenha sido ativada antes da hora,
  // nenhum destinatário externo à allowlist é liberado até o início do
  // dia 22/09/2026 em São Paulo. Depois do marco, a passagem para
  // produção continua deliberadamente manual e exige o valor exato.
  if (dateInSaoPaulo(env.now ?? new Date()) < ACC_GO_LIVE_DATE) {
    return "PILOT";
  }

  const raw = (env.outboundMode ?? "").trim();
  return raw === "production" ? "PRODUCTION" : "PILOT";
}

function ensureSubjectPrefixed(subject: string): string {
  return subject.startsWith(PILOT_SUBJECT_PREFIX) ? subject : `${PILOT_SUBJECT_PREFIX}${subject}`;
}

// Fonte ÚNICA de resolução de destinatário efetivo — modo (pilot/
// production), destinatário efetivamente usado e destinatário
// originalmente pretendido (sempre preservado, nunca perdido). Chamada
// tanto por applyPilotOutboundGuard (envio real, abaixo) quanto por
// apps/web/lib/email-actions/issue-tokens.ts (emissão dos botões de
// e-mail acionável) — nenhum dos dois lê ACC_OUTBOUND_MODE/
// ACC_PILOT_RECIPIENT ou reimplementa esta decisão por conta própria;
// nenhum outro lugar do projeto pode fazê-lo. Mesma regra fail-closed
// de sempre: só "production" exato libera o destinatário pretendido;
// em piloto, ACC_PILOT_RECIPIENT precisa ser válido e bater com o
// destinatário de contingência autorizado, senão lança antes de qualquer
// efeito. Se o destinatário original estiver na lista de testadores, ele é
// preservado; qualquer outro é redirecionado para Reynaldo.
export interface ResolvedEmailRecipient {
  mode: "PRODUCTION" | "PILOT";
  intendedRecipientEmail: string;
  effectiveRecipientEmail: string;
}

export function resolveEffectiveRecipient(
  intendedRecipientEmail: string,
  env: PilotOutboundGuardEnv = defaultEnv()
): ResolvedEmailRecipient {
  const mode = resolveOutboundMode(env);

  if (mode === "PRODUCTION") {
    return { mode, intendedRecipientEmail, effectiveRecipientEmail: intendedRecipientEmail };
  }

  const rawRecipient = (env.pilotRecipient ?? "").trim();

  if (!isValidEmailAddress(rawRecipient) || rawRecipient.toLowerCase() !== ACC_EXPECTED_PILOT_RECIPIENT) {
    throw new EmailSendError(
      "Modo piloto ativo: ACC_PILOT_RECIPIENT ausente, inválido ou diferente do destinatário piloto autorizado — envio bloqueado."
    );
  }

  const normalizedIntendedRecipient = intendedRecipientEmail.trim().toLowerCase();
  const effectiveRecipientEmail = resolvePilotAllowedRecipients(env).includes(normalizedIntendedRecipient)
    ? normalizedIntendedRecipient
    : ACC_EXPECTED_PILOT_RECIPIENT;

  return { mode, intendedRecipientEmail, effectiveRecipientEmail };
}

// Único ponto de decisão: chamado obrigatoriamente no início de
// GmailEmailProvider.send() e FakeEmailProvider.send() — nunca depois
// de qualquer efeito colateral (chamada de rede, construção de MIME).
// Em modo produção, devolve o input intocado (salvo validação do
// Reply-To de conversas de alerta). Em modo piloto, devolve uma cópia com
// to/subject reescritos, Reply-To validado/removido e cc/bcc removidos
// (defensivo — SendEmailInput não tem esses campos hoje, mas isso
// impede uma regressão silenciosa se forem adicionados no futuro sem
// atualizar este arquivo). O destinatário originalmente pretendido
// (input.to) nunca é devolvido nem embutido em nenhum header — quem
// chama continua livre para registrá-lo em auditoria/metadados
// separadamente, exatamente como os três fluxos de envio já fazem
// hoje com input.recipientEmail.
export function applyPilotOutboundGuard(input: SendEmailInput, env: PilotOutboundGuardEnv = defaultEnv()): SendEmailInput {
  const resolved = resolveEffectiveRecipient(input.to, env);

  if (resolved.mode === "PRODUCTION") {
    // Fluxos legados (sem replyToContext) seguem intocados. Mensagens de
    // conversa de alerta têm o Reply-To validado também em produção — um
    // Reply-To externo/arbitrário nunca sai com a identidade do ACC.
    if (!input.replyToContext) return input;
    const replyTo = resolveGuardedReplyTo(input, env);
    if (replyTo.removedReason) reportReplyToRemoved(env, replyTo.removedReason);
    return { ...input, replyTo: replyTo.replyTo };
  }

  const guarded = { ...input } as SendEmailInput & Record<string, unknown>;
  guarded.to = resolved.effectiveRecipientEmail;
  guarded.subject = ensureSubjectPrefixed(input.subject);
  // Reply-To: só o endereço opaco da própria caixa do ACC sobrevive — e
  // somente para conversas de alerta (ver resolveGuardedReplyTo). O
  // destinatário efetivo já foi decidido acima; o Reply-To nunca o altera.
  const replyTo = resolveGuardedReplyTo(input, env);
  if (replyTo.removedReason) reportReplyToRemoved(env, replyTo.removedReason);
  guarded.replyTo = replyTo.replyTo;
  // Defensivo: SendEmailInput não declara cc/bcc hoje — se forem
  // adicionados no futuro sem atualizar este guard, o teste estrutural
  // em scripts/test-pilot-outbound-guard.mjs falha antes que isso vire
  // um vazamento real.
  delete guarded.cc;
  delete guarded.bcc;

  return guarded;
}
