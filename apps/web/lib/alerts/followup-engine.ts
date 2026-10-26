// Puro, sem I/O — regras do ACOMPANHAMENTO RECORRENTE de alertas (lembretes "Repete: …").
// A persistência real vive em alert_followups (migration 20261027120000, funções SQL com a
// MESMA semântica); este módulo é a especificação executável dessas regras, usada pelo
// executor do ciclo de lembretes (runReminderCycle) e pelos testes com relógio simulado e
// transporte de e-mail simulado.
//
// Regras:
//  - O acompanhamento nasce quando o alerta é ENVIADO (aceito pelo provedor): primeiro lembrete
//    em enviado_em + intervalo do risco (24/48/96/168 h — dias corridos).
//  - EM ANDAMENTO mantém o acompanhamento aberto e os lembretes; confirmar de novo NUNCA
//    posterga um lembrete já previsto.
//  - ENVIADO P/ troca o responsável atual (histórico: autor, destinatário, data), NÃO conclui,
//    NÃO reinicia o prazo e direciona os próximos lembretes ao novo responsável.
//  - RESOLVIDO conclui (quem/quando) e interrompe os lembretes futuros.
//  - O lembrete é ancorado na grade do primeiro envio (slot + k·intervalo): uma interrupção do
//    agendamento gera UM lembrete e pula os intermediários — nunca acumula nem deriva.
//  - Falha de envio nunca marca como enviado: o lembrete continua devido e é tentado de novo.
//  - Concorrência: cada lembrete é "reivindicado" (claim com token e validade) antes do envio;
//    duas execuções simultâneas nunca enviam o mesmo slot (e o slot já enviado é ignorado).

import type { AlertSeverity } from "@axion/types";

import { repeatIntervalMs } from "./repeat-policy";

export type FollowupStatus = "OPEN" | "RESOLVED";
export type FollowupSourceType = "CONTRACT_EVENT" | "DELIVERY_ITEM";

export type FollowupEventKind =
  | "CREATED"
  | "IN_PROGRESS_CONFIRMED"
  | "FORWARDED"
  | "RESOLVED"
  | "REMINDER_SENT"
  | "REMINDER_FAILED";

export interface FollowupEvent {
  kind: FollowupEventKind;
  at: Date;
  actorUserId: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  detail?: string;
}

export interface Followup {
  id: string;
  projectId: string;
  sourceType: FollowupSourceType;
  sourceId: string;
  severity: AlertSeverity;
  status: FollowupStatus;
  inProgress: boolean;
  responsibleUserId: string;
  /** Próximo lembrete devido (null só quando RESOLVED). */
  nextReminderAt: Date | null;
  lastReminderAt: Date | null;
  /** Último slot efetivamente enviado — dedupe de reenvio após falha parcial. */
  lastSentSlot: Date | null;
  claimToken: string | null;
  claimedUntil: Date | null;
  failureCount: number;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  createdAt: Date;
  history: FollowupEvent[];
}

export const CLAIM_LEASE_MS = 10 * 60 * 1000;

/** Primeiro slot na grade (slot0 + k·intervalo, k ≥ 1) estritamente depois de `now`. */
export function advanceSlot(slot: Date, now: Date, severity: AlertSeverity): Date {
  const interval = repeatIntervalMs(severity);
  if (slot.getTime() > now.getTime()) return new Date(slot.getTime());
  const missed = Math.floor((now.getTime() - slot.getTime()) / interval) + 1;
  return new Date(slot.getTime() + missed * interval);
}

export function openFollowup(input: {
  id: string;
  projectId: string;
  sourceType: FollowupSourceType;
  sourceId: string;
  severity: AlertSeverity;
  responsibleUserId: string;
  sentAt: Date;
}): Followup {
  return {
    id: input.id,
    projectId: input.projectId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    severity: input.severity,
    status: "OPEN",
    inProgress: false,
    responsibleUserId: input.responsibleUserId,
    nextReminderAt: new Date(input.sentAt.getTime() + repeatIntervalMs(input.severity)),
    lastReminderAt: null,
    lastSentSlot: null,
    claimToken: null,
    claimedUntil: null,
    failureCount: 0,
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: input.sentAt,
    history: [{ kind: "CREATED", at: input.sentAt, actorUserId: null, toUserId: input.responsibleUserId }],
  };
}

export class FollowupRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FollowupRuleError";
  }
}

function assertOpen(f: Followup): void {
  if (f.status !== "OPEN") throw new FollowupRuleError("Este acompanhamento já foi concluído.");
}

/** EM ANDAMENTO: idempotente e SEM efeito sobre o calendário de lembretes. */
export function confirmInProgress(f: Followup, actorUserId: string, now: Date): Followup {
  assertOpen(f);
  return {
    ...f,
    inProgress: true,
    history: [...f.history, { kind: "IN_PROGRESS_CONFIRMED", at: now, actorUserId }],
  };
}

/** ENVIADO P/: troca o responsável; não conclui e não mexe em nextReminderAt. */
export function forwardFollowup(
  f: Followup,
  actorUserId: string,
  toUserId: string,
  now: Date,
  activeMemberUserIds: ReadonlySet<string>
): Followup {
  assertOpen(f);
  if (!activeMemberUserIds.has(toUserId)) {
    throw new FollowupRuleError("O destinatário precisa ser um colaborador ativo vinculado à obra.");
  }
  if (toUserId === f.responsibleUserId) {
    throw new FollowupRuleError("O alerta já está com este responsável.");
  }
  return {
    ...f,
    responsibleUserId: toUserId,
    history: [...f.history, { kind: "FORWARDED", at: now, actorUserId, fromUserId: f.responsibleUserId, toUserId }],
  };
}

/** RESOLVIDO: registra quem/quando e interrompe os lembretes futuros. */
export function resolveFollowup(f: Followup, actorUserId: string, now: Date): Followup {
  assertOpen(f);
  return {
    ...f,
    status: "RESOLVED",
    nextReminderAt: null,
    claimToken: null,
    claimedUntil: null,
    resolvedAt: now,
    resolvedByUserId: actorUserId,
    history: [...f.history, { kind: "RESOLVED", at: now, actorUserId }],
  };
}

/**
 * Quem pode agir (EM ANDAMENTO / ENVIADO P/ / RESOLVIDO): o responsável atual ou um
 * administrador DA MESMA obra. Nunca alguém de outra obra.
 */
export function canActOnFollowup(
  f: Followup,
  actor: { userId: string; projectId: string; isProjectAdmin: boolean }
): boolean {
  if (actor.projectId !== f.projectId) return false;
  return actor.userId === f.responsibleUserId || actor.isProjectAdmin;
}

export function isReminderDue(f: Followup, now: Date): boolean {
  if (f.status !== "OPEN" || !f.nextReminderAt) return false;
  if (f.nextReminderAt.getTime() > now.getTime()) return false;
  if (f.claimedUntil && f.claimedUntil.getTime() > now.getTime()) return false;
  return true;
}

// ---------- armazenamento (interface) ----------

export interface ClaimedReminder {
  followup: Followup;
  claimToken: string;
  /** Slot devido que este envio cobre (chave de idempotência). */
  slot: Date;
}

export interface FollowupStore {
  /** Atômico: reivindica até `limit` lembretes devidos e não reivindicados. */
  claimDue(limit: number, now: Date): Promise<ClaimedReminder[]>;
  /** Estado atual do acompanhamento (releitura antes de enviar). */
  load(id: string): Promise<Followup | null>;
  /** Marca enviado SOMENTE com o token vigente; avança o slot sem acumular. */
  markSent(id: string, claimToken: string, slot: Date, now: Date): Promise<void>;
  /** Libera a reivindicação sem avançar (falha de envio ou estado inválido). */
  markFailed(id: string, claimToken: string, reason: string, now: Date): Promise<void>;
  /** Libera a reivindicação sem registrar falha (acompanhamento já concluído etc.). */
  release(id: string, claimToken: string): Promise<void>;
}

export interface ReminderMessage {
  followup: Followup;
  /** Responsável ATUAL — nunca o anterior. */
  recipientUserId: string;
  /** Chave de idempotência do envio (acompanhamento + slot). */
  idempotencyKey: string;
}

export interface ReminderMailer {
  send(message: ReminderMessage): Promise<void>;
}

export interface ReminderCycleResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Códigos curtos (sem conteúdo de e-mail) por acompanhamento com falha. */
  failures: Array<{ followupId: string; reason: string }>;
}

export function reminderIdempotencyKey(followupId: string, slot: Date): string {
  return `${followupId}:${slot.toISOString()}`;
}

/**
 * Um ciclo de lembretes (executado pelo agendador): reivindica os devidos, REVERIFICA o estado
 * antes de enviar, envia ao responsável atual e só então marca como enviado. Nunca lança por
 * causa de UM envio — um acompanhamento com problema não impede os demais.
 */
export async function runReminderCycle(input: {
  store: FollowupStore;
  mailer: ReminderMailer;
  now: Date;
  limit?: number;
}): Promise<ReminderCycleResult> {
  const result: ReminderCycleResult = { claimed: 0, sent: 0, failed: 0, skipped: 0, failures: [] };
  const claimed = await input.store.claimDue(input.limit ?? 50, input.now);
  result.claimed = claimed.length;

  for (const item of claimed) {
    const id = item.followup.id;
    try {
      const fresh = await input.store.load(id);
      if (!fresh || fresh.status !== "OPEN") {
        await input.store.release(id, item.claimToken);
        result.skipped += 1;
        continue;
      }
      if (fresh.lastSentSlot && fresh.lastSentSlot.getTime() >= item.slot.getTime()) {
        // Slot já enviado (nova tentativa após falha ao gravar): só avança, não reenvia.
        await input.store.markSent(id, item.claimToken, item.slot, input.now);
        result.skipped += 1;
        continue;
      }
      await input.mailer.send({
        followup: fresh,
        recipientUserId: fresh.responsibleUserId,
        idempotencyKey: reminderIdempotencyKey(id, item.slot),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "ERRO_DESCONHECIDO";
      await input.store.markFailed(id, item.claimToken, reason, input.now);
      result.failed += 1;
      result.failures.push({ followupId: id, reason });
      continue;
    }
    try {
      await input.store.markSent(id, item.claimToken, item.slot, input.now);
    } catch {
      // O e-mail JÁ saiu; só a gravação falhou. O mailer é idempotente por chave, então a
      // próxima execução (claim expirado) não duplica o envio — registra e segue.
      result.failures.push({ followupId: id, reason: "MARK_SENT_FALHOU" });
    }
    result.sent += 1;
  }

  return result;
}
