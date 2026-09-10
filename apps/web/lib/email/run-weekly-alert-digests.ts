import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { getAppBaseUrl } from "../app-base-url";
import { sendWeeklyAlertDigestEmail } from "./send-weekly-alert-digest-email";
import type { WeeklyAlertDigestItem } from "./templates/weekly-alert-digest-template";

type ActionRow = {
  id: string;
  project_id: string;
  responsible_user_id: string;
  title: string;
  description: string;
  risk_level: "MEDIUM" | "LOW";
  complete_due_at: string | null;
};

type ExistingDigest = { id: string; status: "PENDING" | "SENT" | "RESPONDED" | "FAILED" };

function saoPauloWeekDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  const weekday = value("weekday");
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const mondayOffset = dayIndex === 0 ? 6 : dayIndex - 1;
  const midnightUtc = new Date(`${localDate}T00:00:00Z`);
  midnightUtc.setUTCDate(midnightUtc.getUTCDate() - mondayOffset);
  return midnightUtc.toISOString().slice(0, 10);
}

function formatDueAt(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export interface WeeklyDigestRunResult {
  groupsFound: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function runWeeklyAlertDigests(now: Date = new Date()): Promise<WeeklyDigestRunResult> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sla_actions")
    .select("id,project_id,responsible_user_id,title,description,risk_level,complete_due_at")
    .in("risk_level", ["MEDIUM", "LOW"])
    .not("responsible_user_id", "is", null)
    .not("status", "in", "(COMPLETED,CANCELLED)")
    .order("risk_level", { ascending: false })
    .order("title", { ascending: true });

  if (error) throw new Error(`Falha ao carregar alertas do resumo semanal: ${error.message}`);
  const actions = data as unknown as ActionRow[];
  const groups = new Map<string, ActionRow[]>();

  for (const action of actions) {
    const key = `${action.project_id}:${action.responsible_user_id}`;
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }

  const projectIds = Array.from(new Set(actions.map((action) => action.project_id)));
  const userIds = Array.from(new Set(actions.map((action) => action.responsible_user_id)));
  const [{ data: projects }, { data: profiles }] = await Promise.all([
    projectIds.length ? admin.from("projects").select("id,name").in("id", projectIds) : Promise.resolve({ data: [] }),
    userIds.length ? admin.from("profiles").select("id,name,email").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);

  const projectById = new Map((projects ?? []).map((row) => [row.id as string, row.name as string]));
  const profileById = new Map(
    (profiles ?? []).map((row) => [row.id as string, { name: row.name as string, email: row.email as string }])
  );
  const weekDate = saoPauloWeekDate(now);
  const baseUrl = getAppBaseUrl();
  const result: WeeklyDigestRunResult = { groupsFound: groups.size, sent: 0, skipped: 0, failed: 0 };

  for (const groupActions of groups.values()) {
    const first = groupActions[0];
    const projectName = projectById.get(first.project_id);
    const recipient = profileById.get(first.responsible_user_id);
    if (!projectName || !recipient?.email) {
      result.failed += 1;
      continue;
    }

    const { data: existing } = await admin
      .from("weekly_alert_digests")
      .select("id,status")
      .eq("project_id", first.project_id)
      .eq("recipient_user_id", first.responsible_user_id)
      .eq("week_date", weekDate)
      .maybeSingle();

    let digest = existing as ExistingDigest | null;
    if (digest?.status === "SENT" || digest?.status === "RESPONDED") {
      result.skipped += 1;
      continue;
    }

    if (!digest) {
      const { data: created, error: createError } = await admin
        .from("weekly_alert_digests")
        .insert({
          project_id: first.project_id,
          recipient_user_id: first.responsible_user_id,
          week_date: weekDate,
          intended_recipient_email: recipient.email,
        })
        .select("id,status")
        .single();
      if (createError) {
        result.failed += 1;
        continue;
      }
      digest = created as ExistingDigest;

      const ordered = [...groupActions].sort((a, b) => {
        const risk = (a.risk_level === "MEDIUM" ? 0 : 1) - (b.risk_level === "MEDIUM" ? 0 : 1);
        return risk || a.title.localeCompare(b.title, "pt-BR");
      });
      const { error: itemsError } = await admin.from("weekly_alert_digest_items").insert(
        ordered.map((action, index) => ({
          digest_id: digest!.id,
          action_id: action.id,
          position: index + 1,
          risk_level: action.risk_level,
          title_snapshot: action.title,
          description_snapshot: action.description,
          due_at_snapshot: action.complete_due_at,
        }))
      );
      if (itemsError) {
        result.failed += 1;
        continue;
      }
    }

    const { data: itemRows, error: itemError } = await admin
      .from("weekly_alert_digest_items")
      .select("action_id,title_snapshot,description_snapshot,risk_level,due_at_snapshot")
      .eq("digest_id", digest.id)
      .order("position");
    if (itemError || !itemRows?.length) {
      result.failed += 1;
      continue;
    }

    const items: WeeklyAlertDigestItem[] = itemRows.map((item) => ({
      actionId: item.action_id,
      title: item.title_snapshot,
      description: item.description_snapshot,
      riskLevel: item.risk_level,
      dueAt: formatDueAt(item.due_at_snapshot),
    }));

    try {
      await sendWeeklyAlertDigestEmail({
        digestId: digest.id,
        projectId: first.project_id,
        recipientEmail: recipient.email,
        email: {
          recipientName: recipient.name,
          projectName,
          items,
          responseUrl: `${baseUrl}/${first.project_id}/acoes/resumo-semanal/${digest.id}`,
        },
      });
      result.sent += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
