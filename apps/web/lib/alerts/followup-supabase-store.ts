import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSeverity } from "@axion/types";

import type { ClaimedReminder, Followup, FollowupEvent, FollowupStore } from "./followup-engine";

type ClaimRow = {
  followup_id: string;
  project_id: string;
  source_type: "CONTRACT_EVENT" | "DELIVERY_ITEM";
  source_id: string;
  severity: AlertSeverity;
  responsible_user_id: string;
  slot: string;
  claim_token: string;
};

type FollowupRow = {
  id: string;
  project_id: string;
  source_type: "CONTRACT_EVENT" | "DELIVERY_ITEM";
  source_id: string;
  severity: AlertSeverity;
  status: "OPEN" | "RESOLVED";
  in_progress: boolean;
  responsible_user_id: string;
  next_reminder_at: string | null;
  last_reminder_at: string | null;
  last_sent_slot: string | null;
  claim_token: string | null;
  claimed_until: string | null;
  failure_count: number;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
};

const FOLLOWUP_COLUMNS =
  "id,project_id,source_type,source_id,severity,status,in_progress,responsible_user_id,next_reminder_at,last_reminder_at,last_sent_slot,claim_token,claimed_until,failure_count,resolved_at,resolved_by_user_id,created_at";

const d = (value: string | null): Date | null => (value ? new Date(value) : null);

function toFollowup(row: FollowupRow, history: FollowupEvent[] = []): Followup {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    severity: row.severity,
    status: row.status,
    inProgress: row.in_progress,
    responsibleUserId: row.responsible_user_id,
    nextReminderAt: d(row.next_reminder_at),
    lastReminderAt: d(row.last_reminder_at),
    lastSentSlot: d(row.last_sent_slot),
    claimToken: row.claim_token,
    claimedUntil: d(row.claimed_until),
    failureCount: row.failure_count,
    resolvedAt: d(row.resolved_at),
    resolvedByUserId: row.resolved_by_user_id,
    createdAt: new Date(row.created_at),
    history,
  };
}

/**
 * Armazenamento do ciclo de lembretes sobre as funções SQL alert_followup_* (service role).
 * Nenhuma escrita direta em tabela: todo efeito passa pelas funções com a semântica testada
 * (scripts/test-alert-followups-sql.mjs).
 */
export class SupabaseFollowupStore implements FollowupStore {
  constructor(private readonly admin: SupabaseClient) {}

  async claimDue(limit: number, now: Date): Promise<ClaimedReminder[]> {
    const { data, error } = await this.admin.rpc("alert_followup_claim_due", { p_limit: limit, p_now: now.toISOString() });
    if (error) throw new Error("Falha ao reivindicar lembretes devidos.");
    return ((data ?? []) as ClaimRow[]).map((row) => {
      const slot = new Date(row.slot);
      const followup = toFollowup({
        id: row.followup_id,
        project_id: row.project_id,
        source_type: row.source_type,
        source_id: row.source_id,
        severity: row.severity,
        status: "OPEN",
        in_progress: false,
        responsible_user_id: row.responsible_user_id,
        next_reminder_at: row.slot,
        last_reminder_at: null,
        last_sent_slot: null,
        claim_token: row.claim_token,
        claimed_until: null,
        failure_count: 0,
        resolved_at: null,
        resolved_by_user_id: null,
        created_at: row.slot,
      });
      return { followup, claimToken: row.claim_token, slot };
    });
  }

  async load(id: string): Promise<Followup | null> {
    const { data, error } = await this.admin.from("alert_followups").select(FOLLOWUP_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error("Falha ao reler o acompanhamento.");
    return data ? toFollowup(data as FollowupRow) : null;
  }

  async markSent(id: string, claimToken: string, slot: Date, now: Date): Promise<void> {
    const { error } = await this.admin.rpc("alert_followup_mark_sent", {
      p_followup_id: id,
      p_claim_token: claimToken,
      p_slot: slot.toISOString(),
      p_now: now.toISOString(),
    });
    if (error) throw new Error("Falha ao registrar o lembrete como enviado.");
  }

  async markFailed(id: string, claimToken: string, reason: string, now: Date): Promise<void> {
    const { error } = await this.admin.rpc("alert_followup_mark_failed", {
      p_followup_id: id,
      p_claim_token: claimToken,
      p_reason: reason,
      p_now: now.toISOString(),
    });
    if (error) throw new Error("Falha ao registrar a falha do lembrete.");
  }

  async release(id: string, claimToken: string): Promise<void> {
    const { error } = await this.admin.rpc("alert_followup_release", { p_followup_id: id, p_claim_token: claimToken });
    if (error) throw new Error("Falha ao liberar a reivindicação.");
  }
}
