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
// - Em modo piloto, ACC_PILOT_RECIPIENT precisa ser um e-mail válido E
//   exatamente igual a ACC_EXPECTED_PILOT_RECIPIENT; ausente, inválido
//   ou diferente bloqueia o envio inteiro (lança antes de qualquer
//   chamada de rede).
// - Sem qualquer desligamento automático por data/relógio — controlado
//   inteiramente por configuração de ambiente.

import { EmailSendError, type SendEmailInput } from "./email-provider";

export const ACC_EXPECTED_PILOT_RECIPIENT = "reynaldo@axion.com.br";
export const PILOT_SUBJECT_PREFIX = "[TESTE CONTROLADO] ";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export interface PilotOutboundGuardEnv {
  outboundMode?: string;
  pilotRecipient?: string;
}

function defaultEnv(): PilotOutboundGuardEnv {
  return {
    outboundMode: process.env.ACC_OUTBOUND_MODE,
    pilotRecipient: process.env.ACC_PILOT_RECIPIENT,
  };
}

// Único valor que desliga o piloto — qualquer outra coisa (incluindo
// ausência) mantém a proteção ativa.
export function resolveOutboundMode(env: PilotOutboundGuardEnv = defaultEnv()): "PRODUCTION" | "PILOT" {
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
// em piloto, ACC_PILOT_RECIPIENT precisa ser válido e bater
// exatamente com ACC_EXPECTED_PILOT_RECIPIENT, senão lança antes de
// qualquer efeito.
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

  return { mode, intendedRecipientEmail, effectiveRecipientEmail: ACC_EXPECTED_PILOT_RECIPIENT };
}

// Único ponto de decisão: chamado obrigatoriamente no início de
// GmailEmailProvider.send() e FakeEmailProvider.send() — nunca depois
// de qualquer efeito colateral (chamada de rede, construção de MIME).
// Em modo produção, devolve o input intocado. Em modo piloto, devolve
// uma cópia com to/subject/replyTo reescritos e cc/bcc removidos
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
    return input;
  }

  const guarded = { ...input } as SendEmailInput & Record<string, unknown>;
  guarded.to = resolved.effectiveRecipientEmail;
  guarded.subject = ensureSubjectPrefixed(input.subject);
  guarded.replyTo = undefined;
  // Defensivo: SendEmailInput não declara cc/bcc hoje — se forem
  // adicionados no futuro sem atualizar este guard, o teste estrutural
  // em scripts/test-pilot-outbound-guard.mjs falha antes que isso vire
  // um vazamento real.
  delete guarded.cc;
  delete guarded.bcc;

  return guarded;
}
