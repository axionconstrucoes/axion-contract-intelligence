import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import type {
  SlaAction,
  SlaActionEscalation,
  SlaAreaResponsibles,
  SlaMatrixRule,
  SlaProjectSettings,
} from "./types";

type ProjectSettingsRow = {
  project_id: string;
  timezone: string;
  business_day_start_hour: number;
  business_day_end_hour: number;
  updated_at: string;
};

type AreaResponsiblesRow = {
  id: string;
  project_id: string;
  area: string;
  responsible_direct_user_id: string | null;
  escalation_1_user_id: string | null;
  escalation_2_user_id: string | null;
  board_user_id: string | null;
  updated_at: string;
};

type MatrixRuleRow = {
  id: string;
  project_id: string;
  risk_level: string;
  area: string | null;
  time_unit: string;
  assume_deadline_value: number;
  respond_deadline_value: number | null;
  complete_deadline_value: number | null;
  escalation_2_after_value: number;
  board_after_value: number;
  notify_by_email: boolean;
  requires_acknowledgment_confirmation: boolean;
  requires_delay_justification: boolean;
  is_default: boolean;
  active: boolean;
};

type ActionRow = {
  id: string;
  project_id: string;
  origin: string;
  origin_expert_id: string | null;
  title: string;
  description: string;
  risk_level: string;
  area: string;
  responsible_user_id: string | null;
  status: string;
  current_escalation_level: string;
  contractual_deadline: string | null;
  assume_due_at: string;
  respond_due_at: string | null;
  complete_due_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completion_note: string | null;
  related_event_id: string | null;
  related_document_version_id: string | null;
  related_esg_obligation_submission_id: string | null;
  related_action_request_id: string | null;
  related_ai_finding_id: string | null;
  created_by_type: string;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type EscalationRow = {
  id: string;
  action_id: string;
  project_id: string;
  from_level: string;
  to_level: string;
  reason: string;
  notified_user_id: string | null;
  escalated_at: string;
};

type ProfileRow = { id: string; name: string };

async function resolveProfileNames(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userIds: Array<string | null>
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase.from("profiles").select("id,name").in("id", ids);
  if (error) throw new Error(`Falha ao carregar responsáveis: ${error.message}`);

  return new Map((data as unknown as ProfileRow[]).map((p) => [p.id, p.name]));
}

export async function getSlaAreaResponsibles(projectId: string): Promise<SlaAreaResponsibles[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sla_area_responsibles")
    .select("*")
    .eq("project_id", projectId)
    .order("area", { ascending: true });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar responsáveis por área: ${error.message}`);
  }

  const rows = data as unknown as AreaResponsiblesRow[];
  if (rows.length === 0) return [];

  const namesByUserId = await resolveProfileNames(supabase, [
    ...rows.map((r) => r.responsible_direct_user_id),
    ...rows.map((r) => r.escalation_1_user_id),
    ...rows.map((r) => r.escalation_2_user_id),
    ...rows.map((r) => r.board_user_id),
  ]);

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    area: row.area as SlaAreaResponsibles["area"],
    responsibleDirectUserId: row.responsible_direct_user_id,
    responsibleDirectName: row.responsible_direct_user_id ? (namesByUserId.get(row.responsible_direct_user_id) ?? null) : null,
    escalation1UserId: row.escalation_1_user_id,
    escalation1Name: row.escalation_1_user_id ? (namesByUserId.get(row.escalation_1_user_id) ?? null) : null,
    escalation2UserId: row.escalation_2_user_id,
    escalation2Name: row.escalation_2_user_id ? (namesByUserId.get(row.escalation_2_user_id) ?? null) : null,
    boardUserId: row.board_user_id,
    boardName: row.board_user_id ? (namesByUserId.get(row.board_user_id) ?? null) : null,
    updatedAt: row.updated_at,
  }));
}

export async function getSlaMatrixRules(projectId: string): Promise<SlaMatrixRule[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sla_matrix_rules")
    .select("*")
    .eq("project_id", projectId)
    .order("risk_level", { ascending: true });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar matriz de SLA: ${error.message}`);
  }

  const rows = data as unknown as MatrixRuleRow[];

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    riskLevel: row.risk_level as SlaMatrixRule["riskLevel"],
    area: row.area as SlaMatrixRule["area"],
    timeUnit: row.time_unit as SlaMatrixRule["timeUnit"],
    assumeDeadlineValue: row.assume_deadline_value,
    respondDeadlineValue: row.respond_deadline_value,
    completeDeadlineValue: row.complete_deadline_value,
    escalation2AfterValue: row.escalation_2_after_value,
    boardAfterValue: row.board_after_value,
    notifyByEmail: row.notify_by_email,
    requiresAcknowledgmentConfirmation: row.requires_acknowledgment_confirmation,
    requiresDelayJustification: row.requires_delay_justification,
    isDefault: row.is_default,
    active: row.active,
  }));
}

function mapActionRow(row: ActionRow, namesByUserId: Map<string, string>): SlaAction {
  return {
    id: row.id,
    projectId: row.project_id,
    origin: row.origin as SlaAction["origin"],
    originExpertId: row.origin_expert_id,
    title: row.title,
    description: row.description,
    riskLevel: row.risk_level as SlaAction["riskLevel"],
    area: row.area as SlaAction["area"],
    responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_user_id ? (namesByUserId.get(row.responsible_user_id) ?? null) : null,
    status: row.status as SlaAction["status"],
    currentEscalationLevel: row.current_escalation_level as SlaAction["currentEscalationLevel"],
    contractualDeadline: row.contractual_deadline,
    assumeDueAt: row.assume_due_at,
    respondDueAt: row.respond_due_at,
    completeDueAt: row.complete_due_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByUserId: row.acknowledged_by_user_id,
    completedAt: row.completed_at,
    completedByUserId: row.completed_by_user_id,
    completionNote: row.completion_note,
    relatedEventId: row.related_event_id,
    relatedDocumentVersionId: row.related_document_version_id,
    relatedEsgObligationSubmissionId: row.related_esg_obligation_submission_id,
    relatedActionRequestId: row.related_action_request_id,
    relatedAiFindingId: row.related_ai_finding_id,
    createdByType: row.created_by_type as SlaAction["createdByType"],
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getSlaActions(projectId: string): Promise<SlaAction[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sla_actions")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar ações: ${error.message}`);
  }

  const rows = data as unknown as ActionRow[];
  if (rows.length === 0) return [];

  const namesByUserId = await resolveProfileNames(supabase, rows.map((r) => r.responsible_user_id));

  return rows.map((row) => mapActionRow(row, namesByUserId));
}

export async function getSlaAction(actionId: string): Promise<SlaAction | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from("sla_actions").select("*").eq("id", actionId).maybeSingle();

  if (error) {
    if (error.code === "22P02") return null;
    throw new Error(`Falha ao carregar ação: ${error.message}`);
  }
  if (!data) return null;

  const row = data as unknown as ActionRow;
  const namesByUserId = await resolveProfileNames(supabase, [row.responsible_user_id]);

  return mapActionRow(row, namesByUserId);
}

export async function getSlaActionEscalations(actionId: string): Promise<SlaActionEscalation[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sla_action_escalations")
    .select("*")
    .eq("action_id", actionId)
    .order("escalated_at", { ascending: false });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar histórico de escalonamento: ${error.message}`);
  }

  const rows = data as unknown as EscalationRow[];

  return rows.map((row) => ({
    id: row.id,
    actionId: row.action_id,
    projectId: row.project_id,
    fromLevel: row.from_level as SlaActionEscalation["fromLevel"],
    toLevel: row.to_level as SlaActionEscalation["toLevel"],
    reason: row.reason as SlaActionEscalation["reason"],
    notifiedUserId: row.notified_user_id,
    escalatedAt: row.escalated_at,
  }));
}

export async function getSlaActionEscalationsForProject(projectId: string): Promise<SlaActionEscalation[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sla_action_escalations")
    .select("*")
    .eq("project_id", projectId)
    .order("escalated_at", { ascending: false });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar histórico de escalonamento do projeto: ${error.message}`);
  }

  const rows = data as unknown as EscalationRow[];

  return rows.map((row) => ({
    id: row.id,
    actionId: row.action_id,
    projectId: row.project_id,
    fromLevel: row.from_level as SlaActionEscalation["fromLevel"],
    toLevel: row.to_level as SlaActionEscalation["toLevel"],
    reason: row.reason as SlaActionEscalation["reason"],
    notifiedUserId: row.notified_user_id,
    escalatedAt: row.escalated_at,
  }));
}

/**
 * Timezone/expediente configurados do projeto — null quando o projeto
 * ainda não configurou (o caller deve então cair no default institucional
 * AXION_DEFAULT_BUSINESS_HOURS_CONFIG, nunca inventar um valor aqui).
 */
export async function getSlaProjectSettings(projectId: string): Promise<SlaProjectSettings | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sla_project_settings")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") return null;
    throw new Error(`Falha ao carregar configuração de horário útil do projeto: ${error.message}`);
  }
  if (!data) return null;

  const row = data as unknown as ProjectSettingsRow;

  return {
    projectId: row.project_id,
    timezone: row.timezone,
    businessDayStartHour: row.business_day_start_hour,
    businessDayEndHour: row.business_day_end_hour,
    updatedAt: row.updated_at,
  };
}
