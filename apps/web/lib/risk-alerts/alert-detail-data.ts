// Leitura (client de SESSÃO, RLS) do detalhe de um alerta de risco para a
// página /[projectId]/alertas/[caseId]: estado, responsáveis, níveis,
// prazos, próximo escalonamento, timeline (eventos), mensagens (sem corpo
// citado/assinatura), Expert, encaminhamentos e destinatários suprimidos.
// Também resolve o token de link do e-mail (só o hash é comparado; GET
// nunca altera estado) e a lista de destinatários elegíveis para ENVIAR P/.

import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import { membershipAreaLabels, slaEscalationLevelLabels, slaTopLevelReachedLabel } from "@/lib/labels";
import { getSlaAreaResponsibles, getSlaMatrixRules, getSlaProjectSettings } from "@/lib/sla/sla-actions-data";
import { computeEscalation } from "@/lib/sla/compute-escalation";
import { resolveMatrixPolicy, type MatrixPolicy } from "@/lib/sla/resolve-matrix-policy";
import type { SlaRiskLevel } from "@/lib/sla/types";

import { hashActionToken, isActionTokenValid } from "./action-links";
import { ACTIONS_BY_STATE, nextHierarchyLevel } from "./alert-state-machine";
import { ALERT_EXPERT_OPTIONS, suggestExpertForArea } from "./experts/route-alert-expert";
import { describeSuppression } from "./plan-risk-alerts";
import type { AlertActionType, AlertState, RiskSuppressionReason } from "./types";
import { ALERT_STATE_LABELS, DEFAULT_PROJECT_TIMEZONE } from "./types";

export interface ForwardCandidate {
  userId: string;
  name: string;
  email: string;
  area: string | null;
  permission: string;
  matrixPosition: string | null;
  inPilotAllowlist: boolean;
}

export interface AlertDetailView {
  id: string;
  projectId: string;
  title: string;
  reference: string;
  riskLevel: string;
  area: string;
  summary: string;
  impact: string;
  recommendation: string | null;
  visibleCode: string;
  state: AlertState;
  stateLabel: string;
  status: string;
  currentLevel: string;
  currentLevelLabel: string;
  nextLevelLabel: string | null;
  topLevelReachedAt: string | null;
  currentResponsible: { userId: string | null; name: string | null };
  previousResponsible: { userId: string | null; name: string | null };
  slaAction: { id: string; status: string; assumeDueAt: string; respondDueAt: string | null; completeDueAt: string | null; acknowledgedAt: string | null; completedAt: string | null; currentEscalationLevel: string } | null;
  nextScheduledEscalation: { level: string; reasons: string[] } | null;
  policy: MatrixPolicy;
  timeZone: string;
  timeline: Array<{ id: string; at: string; type: string; actorName: string | null; origin: string; fromState: string | null; toState: string | null; fromLevel: string | null; toLevel: string | null; text: string | null; justification: string | null; targetName: string | null; expertId: string | null }>;
  messages: Array<{ id: string; at: string | null; direction: string; senderName: string | null; senderEmail: string | null; classification: string | null; confidence: number | null; expertId: string | null; requiresHumanReview: boolean; status: string; excerpt: string }>;
  forwards: Array<{ id: string; fromName: string | null; toName: string | null; assumeDueAt: string; timeoutAt: string; state: string; actedAt: string | null; returnedAt: string | null; pilotException: boolean }>;
  outbox: Array<{ id: string; type: string; escalationLevel: string | null; status: string; suppressionLabel: string | null; recipientName: string | null; at: string; origin: string }>;
  suppressedCount: number;
  forwardCandidates: ForwardCandidate[];
  expertOptions: typeof ALERT_EXPERT_OPTIONS;
  suggestedExpert: string | null;
  availableActions: AlertActionType[];
  linkAction: { action: AlertActionType; valid: boolean } | null;
  currentUserId: string;
}

export async function getAlertDetailView(projectId: string, caseId: string, options: { token?: string | null; action?: string | null }): Promise<AlertDetailView | null> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: row } = await supabase.from("risk_alert_cases").select("*").eq("id", caseId).eq("project_id", projectId).maybeSingle();
  if (!row) return null;

  const [rules, responsibles, settings, { data: config }, { data: events }, { data: messages }, { data: forwards }, { data: outbox }, { data: members }] = await Promise.all([
    getSlaMatrixRules(projectId),
    getSlaAreaResponsibles(projectId),
    getSlaProjectSettings(projectId),
    supabase.from("project_weekly_schedule_ingestion_configs").select("pilot_recipient_allowlist_user_ids,sender_domain").eq("project_id", projectId).maybeSingle(),
    supabase.from("risk_alert_action_events").select("*").eq("case_id", caseId).order("created_at", { ascending: true }),
    supabase.from("alert_email_messages").select("id,direction,sender_user_id,sender_email,classification,confidence,expert_id,requires_human_review,status,body_clean,sent_at,received_at").eq("case_id", caseId).order("created_at", { ascending: true }),
    supabase.from("risk_alert_forward_assignments").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
    supabase.from("risk_alert_outbox").select("id,notification_type,escalation_level,status,suppression_reason,recipient_user_id,scheduled_for,sent_at,origin").eq("case_id", caseId).order("scheduled_for", { ascending: false }),
    supabase.from("project_memberships").select("user_id,status,permission,area").eq("project_id", projectId).eq("status", "ACTIVE"),
  ]);

  const memberIds = (members ?? []).map((m) => m.user_id as string);
  const extraIds = [row.current_responsible_user_id, row.previous_responsible_user_id, ...(events ?? []).flatMap((e) => [e.actor_user_id, e.target_user_id]), ...(messages ?? []).map((m) => m.sender_user_id), ...(forwards ?? []).flatMap((f) => [f.from_user_id, f.to_user_id]), ...(outbox ?? []).map((o) => o.recipient_user_id)].filter((id): id is string => typeof id === "string");
  const ids = Array.from(new Set([...memberIds, ...extraIds]));
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,name,email").in("id", ids) : { data: [] as Array<{ id: string; name: string | null; email: string | null }> };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const nameOf = (id: string | null | undefined) => (id ? ((profileById.get(id)?.name as string | null) ?? id) : null);

  const riskLevel = (row.risk_level === "REVIEW_REQUIRED" ? "MEDIUM" : row.risk_level) as SlaRiskLevel;
  const policy = resolveMatrixPolicy({ rules, responsibles, settings, area: row.area, riskLevel });
  const timeZone = settings?.timezone ?? DEFAULT_PROJECT_TIMEZONE;
  const allowlist = ((config?.pilot_recipient_allowlist_user_ids as string[] | null) ?? []).filter(Boolean);
  const corporateDomain = ((config?.sender_domain as string | null) ?? "axion.com.br").toLowerCase();

  let slaAction: AlertDetailView["slaAction"] = null;
  let nextScheduledEscalation: AlertDetailView["nextScheduledEscalation"] = null;
  if (row.sla_action_id) {
    const { data: action } = await supabase.from("sla_actions").select("id,status,assume_due_at,respond_due_at,complete_due_at,acknowledged_at,completed_at,current_escalation_level,contractual_deadline").eq("id", row.sla_action_id).maybeSingle();
    if (action) {
      slaAction = { id: action.id, status: action.status, assumeDueAt: action.assume_due_at, respondDueAt: action.respond_due_at, completeDueAt: action.complete_due_at, acknowledgedAt: action.acknowledged_at, completedAt: action.completed_at, currentEscalationLevel: action.current_escalation_level };
      const escalation = computeEscalation({ status: action.status, currentEscalationLevel: action.current_escalation_level, assumeDueAt: action.assume_due_at, respondDueAt: action.respond_due_at, completeDueAt: action.complete_due_at, acknowledgedAt: action.acknowledged_at, completedAt: action.completed_at, contractualDeadline: action.contractual_deadline, now: new Date().toISOString(), rule: policy.rule, businessHoursConfig: policy.businessHours });
      nextScheduledEscalation = { level: slaEscalationLevelLabels[escalation.recommendedLevel], reasons: escalation.reasons };
    }
  }

  const matrixPositionOf = (userId: string) => {
    const positions: string[] = [];
    for (const r of responsibles) {
      if (r.responsibleDirectUserId === userId || r.secondaryResponsibleUserId === userId) positions.push(`Nível 1 · ${r.area}`);
      if (r.escalation1UserId === userId) positions.push(`Nível 2 · ${r.area}`);
      if (r.boardUserId === userId) positions.push(`Nível 3 · ${r.area}`);
    }
    return positions.length ? positions.join("; ") : null;
  };
  const forwardCandidates: ForwardCandidate[] = (members ?? [])
    .filter((m) => m.user_id !== auth.user!.id)
    .map((m) => {
      const profile = profileById.get(m.user_id as string);
      const email = ((profile?.email as string | null) ?? "").toLowerCase();
      return { userId: m.user_id as string, name: (profile?.name as string | null) ?? "", email, area: m.area ? (membershipAreaLabels[m.area as keyof typeof membershipAreaLabels] ?? m.area) : null, permission: m.permission as string, matrixPosition: matrixPositionOf(m.user_id as string), inPilotAllowlist: allowlist.includes(m.user_id as string) };
    })
    // Só usuário corporativo verificado (e-mail do domínio) com profile.
    .filter((c) => c.name && c.email && c.email.split("@")[1] === corporateDomain)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  let linkAction: AlertDetailView["linkAction"] = null;
  if (options.token && options.action) {
    const { data: link } = await supabase.from("risk_alert_action_links").select("action_type,expires_at,used_at").eq("token_hash", hashActionToken(options.token)).eq("case_id", caseId).eq("recipient_user_id", auth.user.id).maybeSingle();
    linkAction = { action: (link?.action_type as AlertActionType) ?? (options.action as AlertActionType), valid: isActionTokenValid(link ? { expiresAt: link.expires_at as string, usedAt: (link.used_at as string | null) ?? null } : null, new Date().toISOString()) && link?.action_type === options.action };
  }

  const state = row.state as AlertState;
  const currentLevel = row.current_level as string;
  const next = nextHierarchyLevel(currentLevel as "RESPONSAVEL");
  return {
    id: row.id,
    projectId,
    title: row.title,
    reference: row.reference ?? "",
    riskLevel: row.risk_level,
    area: row.area,
    summary: row.summary ?? "",
    impact: row.impact ?? "",
    recommendation: row.recommendation ?? null,
    visibleCode: row.visible_code ?? "",
    state,
    stateLabel: ALERT_STATE_LABELS[state] ?? state,
    status: row.status,
    currentLevel,
    currentLevelLabel: slaEscalationLevelLabels[currentLevel as keyof typeof slaEscalationLevelLabels] ?? currentLevel,
    nextLevelLabel: next ? slaEscalationLevelLabels[next] : slaTopLevelReachedLabel,
    topLevelReachedAt: row.top_level_reached_at ?? null,
    currentResponsible: { userId: row.current_responsible_user_id ?? null, name: nameOf(row.current_responsible_user_id) },
    previousResponsible: { userId: row.previous_responsible_user_id ?? null, name: nameOf(row.previous_responsible_user_id) },
    slaAction,
    nextScheduledEscalation,
    policy,
    timeZone,
    timeline: (events ?? []).map((e) => ({ id: e.id, at: e.created_at, type: e.action_type, actorName: nameOf(e.actor_user_id), origin: e.origin, fromState: e.from_state, toState: e.to_state, fromLevel: e.from_level, toLevel: e.to_level, text: e.text_content, justification: e.justification, targetName: nameOf(e.target_user_id), expertId: e.expert_id })),
    messages: (messages ?? []).map((m) => ({ id: m.id, at: m.sent_at ?? m.received_at ?? null, direction: m.direction, senderName: nameOf(m.sender_user_id), senderEmail: m.direction === "INBOUND" ? m.sender_email : null, classification: m.classification, confidence: m.confidence === null ? null : Number(m.confidence), expertId: m.expert_id, requiresHumanReview: Boolean(m.requires_human_review), status: m.status, excerpt: ((m.body_clean as string | null) ?? "").slice(0, 400) })),
    forwards: (forwards ?? []).map((f) => ({ id: f.id, fromName: nameOf(f.from_user_id), toName: nameOf(f.to_user_id), assumeDueAt: f.assume_due_at, timeoutAt: f.timeout_at, state: f.state, actedAt: f.acted_at, returnedAt: f.returned_at, pilotException: Boolean(f.pilot_exception) })),
    outbox: (outbox ?? []).map((o) => ({ id: o.id, type: o.notification_type, escalationLevel: o.escalation_level, status: o.status, suppressionLabel: o.suppression_reason ? describeSuppression(o.suppression_reason as RiskSuppressionReason) : null, recipientName: nameOf(o.recipient_user_id), at: o.sent_at ?? o.scheduled_for, origin: o.origin })),
    suppressedCount: (outbox ?? []).filter((o) => o.status === "SUPPRESSED").length,
    forwardCandidates,
    expertOptions: ALERT_EXPERT_OPTIONS,
    suggestedExpert: suggestExpertForArea(row.area),
    availableActions: ACTIONS_BY_STATE[state] ?? [],
    linkAction,
    currentUserId: auth.user.id,
  };
}
