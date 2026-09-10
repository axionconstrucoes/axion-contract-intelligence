import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

export type WeeklyDigestResponse = "AWARE" | "STUDYING" | "RESOLVED" | "FORWARDED";

export interface WeeklyDigestViewItem {
  id: string;
  actionId: string;
  position: number;
  riskLevel: "MEDIUM" | "LOW";
  title: string;
  description: string;
  dueAt: string | null;
  response: WeeklyDigestResponse | null;
  directedToUserId: string | null;
}

export interface WeeklyDigestView {
  id: string;
  projectId: string;
  projectName: string;
  recipientUserId: string;
  recipientName: string;
  weekDate: string;
  status: "PENDING" | "SENT" | "RESPONDED" | "FAILED";
  respondedAt: string | null;
  items: WeeklyDigestViewItem[];
}

export async function getWeeklyAlertDigest(projectId: string, digestId: string): Promise<WeeklyDigestView | null> {
  const supabase = await createSupabaseServerClient();
  const { data: digest, error } = await supabase
    .from("weekly_alert_digests")
    .select("id,project_id,recipient_user_id,week_date,status,responded_at")
    .eq("id", digestId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !digest) return null;

  const [{ data: project }, { data: recipient }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).single(),
    supabase.from("profiles").select("name").eq("id", digest.recipient_user_id).single(),
    supabase
      .from("weekly_alert_digest_items")
      .select("id,action_id,position,risk_level,title_snapshot,description_snapshot,due_at_snapshot,response,directed_to_user_id")
      .eq("digest_id", digestId)
      .order("position"),
  ]);

  if (itemsError) return null;

  return {
    id: digest.id,
    projectId: digest.project_id,
    projectName: project?.name ?? "Projeto",
    recipientUserId: digest.recipient_user_id,
    recipientName: recipient?.name ?? "Responsável",
    weekDate: digest.week_date,
    status: digest.status,
    respondedAt: digest.responded_at,
    items: (items ?? []).map((item) => ({
      id: item.id,
      actionId: item.action_id,
      position: item.position,
      riskLevel: item.risk_level,
      title: item.title_snapshot,
      description: item.description_snapshot,
      dueAt: item.due_at_snapshot,
      response: item.response,
      directedToUserId: item.directed_to_user_id,
    })),
  } as WeeklyDigestView;
}
