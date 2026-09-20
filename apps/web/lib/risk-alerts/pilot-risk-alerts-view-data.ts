// Leitura (client de SESSÃO, RLS) do estado dos alertas de risco do
// projeto para a tela de configuração — somente exibição. Prazos e
// níveis vêm da Matriz (resolveMatrixPolicy); nada aqui é editável.

import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import { getSlaAreaResponsibles, getSlaMatrixRules, getSlaProjectSettings } from "@/lib/sla/sla-actions-data";
import { resolveMatrixPolicy, type MatrixPolicy } from "@/lib/sla/resolve-matrix-policy";
import type { SlaArea, SlaRiskLevel } from "@/lib/sla/types";

import { describeNextDigest } from "./digest-window";
import { describeSuppression } from "./plan-risk-alerts";
import type { RiskSuppressionReason } from "./types";
import { DEFAULT_PROJECT_TIMEZONE } from "./types";

export interface PilotRecipientView {
  userId: string;
  name: string | null;
  email: string | null;
  membershipStatus: string | null;
  valid: boolean;
  problem: string | null;
}

export interface PilotRiskAlertsView {
  configured: boolean;
  ingestionEnabled: boolean;
  riskAlertsEnabled: boolean;
  timeZone: string;
  nextDigest: string;
  lastDigest: { window: string; sentAt: string | null; status: string } | null;
  recipients: PilotRecipientView[];
  allowlistStatus: "OK" | "MISSING";
  levels: Array<{ area: SlaArea; policy: MatrixPolicy; level1: string[]; level2: string | null; level3: string | null }>;
  recentOutbox: Array<{
    id: string;
    type: string;
    escalationLevel: string | null;
    riskLevel: string;
    status: string;
    suppressionReason: string | null;
    suppressionLabel: string | null;
    recipientName: string | null;
    scheduledFor: string;
    sentAt: string | null;
    attemptCount: number;
  }>;
  suppressedCount: number;
  openCases: { high: number; critical: number; medium: number; low: number; reviewRequired: number };
}

const AREAS: SlaArea[] = ["PLANEJAMENTO", "FINANCEIRO", "ESG_SSMA"];

export async function getPilotRiskAlertsView(projectId: string, nowIso: string = new Date().toISOString()): Promise<PilotRiskAlertsView> {
  const supabase = await createSupabaseServerClient();
  const [{ data: config }, rules, responsibles, settings] = await Promise.all([
    supabase
      .from("project_weekly_schedule_ingestion_configs")
      .select("enabled,risk_alerts_enabled,pilot_recipient_allowlist_user_ids,sender_domain")
      .eq("project_id", projectId)
      .maybeSingle(),
    getSlaMatrixRules(projectId),
    getSlaAreaResponsibles(projectId),
    getSlaProjectSettings(projectId),
  ]);

  const timeZone = settings?.timezone ?? DEFAULT_PROJECT_TIMEZONE;
  const allowlist = ((config?.pilot_recipient_allowlist_user_ids as string[] | null) ?? []).filter(Boolean);
  const userIds = new Set<string>(allowlist);
  for (const row of responsibles) {
    for (const id of [row.responsibleDirectUserId, row.secondaryResponsibleUserId, row.escalation1UserId, row.boardUserId]) if (id) userIds.add(id);
  }
  const ids = Array.from(userIds);
  const [{ data: members }, { data: profiles }] = await Promise.all([
    ids.length ? supabase.from("project_memberships").select("user_id,status").eq("project_id", projectId).in("user_id", ids) : Promise.resolve({ data: [] as Array<{ user_id: string; status: string }> }),
    ids.length ? supabase.from("profiles").select("id,name,email").in("id", ids) : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; email: string | null }> }),
  ]);
  const statusById = new Map((members ?? []).map((m) => [m.user_id as string, m.status as string]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const nameOf = (id: string | null) => (id ? (profileById.get(id)?.name ?? id) : null);
  const corporateDomain = ((config?.sender_domain as string | null) ?? "axion.com.br").toLowerCase();

  const recipients: PilotRecipientView[] = allowlist.map((userId) => {
    const profile = profileById.get(userId);
    const membershipStatus = statusById.get(userId) ?? null;
    const email = (profile?.email as string | null) ?? null;
    const problem = membershipStatus !== "ACTIVE" ? "sem membership ACTIVE" : !email ? "sem e-mail" : email.toLowerCase().split("@")[1] !== corporateDomain ? "e-mail fora do domínio corporativo" : null;
    return { userId, name: (profile?.name as string | null) ?? null, email, membershipStatus, valid: problem === null, problem };
  });

  const levels = AREAS.map((area) => {
    const policy = resolveMatrixPolicy({ rules, responsibles, settings, area, riskLevel: "HIGH" as SlaRiskLevel });
    return {
      area,
      policy,
      level1: [policy.level1UserId, policy.level1SecondaryUserId].filter(Boolean).map((id) => nameOf(id) ?? "") as string[],
      level2: nameOf(policy.level2UserId),
      level3: nameOf(policy.level3UserId),
    };
  });

  const [{ data: outbox }, { data: lastDigest }, { data: cases }] = await Promise.all([
    supabase
      .from("risk_alert_outbox")
      .select("id,notification_type,escalation_level,risk_level,status,suppression_reason,recipient_user_id,scheduled_for,sent_at,attempt_count")
      .eq("project_id", projectId)
      .order("scheduled_for", { ascending: false })
      .limit(20),
    supabase
      .from("risk_alert_outbox")
      .select("digest_window,sent_at,status")
      .eq("project_id", projectId)
      .eq("notification_type", "DIGEST")
      .order("scheduled_for", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("risk_alert_cases").select("risk_level,status").eq("project_id", projectId).eq("status", "OPEN"),
  ]);
  const recipientIds = Array.from(new Set((outbox ?? []).map((row) => row.recipient_user_id as string).filter((id) => !profileById.has(id))));
  if (recipientIds.length) {
    const { data: extra } = await supabase.from("profiles").select("id,name,email").in("id", recipientIds);
    for (const p of extra ?? []) profileById.set(p.id as string, p);
  }
  const { count: suppressedCount } = await supabase
    .from("risk_alert_outbox")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "SUPPRESSED");

  const openCases = { high: 0, critical: 0, medium: 0, low: 0, reviewRequired: 0 };
  for (const row of cases ?? []) {
    const level = row.risk_level as string;
    if (level === "HIGH") openCases.high += 1;
    else if (level === "CRITICAL") openCases.critical += 1;
    else if (level === "MEDIUM") openCases.medium += 1;
    else if (level === "LOW") openCases.low += 1;
    else openCases.reviewRequired += 1;
  }

  return {
    configured: Boolean(config),
    ingestionEnabled: Boolean(config?.enabled),
    riskAlertsEnabled: Boolean(config?.risk_alerts_enabled),
    timeZone,
    nextDigest: describeNextDigest(nowIso, timeZone),
    lastDigest: lastDigest ? { window: lastDigest.digest_window as string, sentAt: (lastDigest.sent_at as string | null) ?? null, status: lastDigest.status as string } : null,
    recipients,
    allowlistStatus: allowlist.length > 0 ? "OK" : "MISSING",
    levels,
    recentOutbox: (outbox ?? []).map((row) => ({
      id: row.id as string,
      type: row.notification_type as string,
      escalationLevel: (row.escalation_level as string | null) ?? null,
      riskLevel: row.risk_level as string,
      status: row.status as string,
      suppressionReason: (row.suppression_reason as string | null) ?? null,
      suppressionLabel: row.suppression_reason ? describeSuppression(row.suppression_reason as RiskSuppressionReason) : null,
      recipientName: nameOf(row.recipient_user_id as string),
      scheduledFor: row.scheduled_for as string,
      sentAt: (row.sent_at as string | null) ?? null,
      attemptCount: Number(row.attempt_count ?? 0),
    })),
    suppressedCount: suppressedCount ?? 0,
    openCases,
  };
}
