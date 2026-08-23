// "[CUIDAR DESTE ASSUNTO]" (seção 11-13) — reaproveita sla_actions
// (NUNCA uma tabela paralela de tarefas). Responsável sempre humano
// confirmado (nunca atribuído automaticamente pela IA) e sempre um
// membro real do projeto com e-mail @axion.com.br.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBusinessHoursConfig, resolveMatrixRule } from "../sla/resolve-matrix-rule";
import { computeSlaDeadlines } from "../sla/compute-deadlines";
import type { SlaArea } from "../sla/types";
import { getFinding } from "../additionals/findings/get-findings";
import type { AiFinding } from "../additionals/findings/types";

export interface CreateActionForHistoricalFindingInput {
  findingId: string;
  projectId: string;
  responsibleUserId: string;
  area: SlaArea;
  actionDescription: string;
  dueAt?: string | null;
  note?: string | null;
  createdByUserId: string;
}

export interface CreateActionForHistoricalFindingResult {
  finding: AiFinding;
  slaActionId: string;
}

/**
 * Nesta fase, resolve a Matriz de SLA sempre com [] (cai no default
 * institucional — ver resolve-matrix-rule.ts) em vez de reconsultar
 * sla_matrix_rules/sla_project_settings (que só existem via um módulo
 * "server-only" não reutilizável por scripts/testes) — o default
 * continua uma regra válida e determinística do próprio motor de SLA
 * existente, nunca inventada aqui.
 */
export async function createActionForHistoricalFinding(
  supabase: SupabaseClient,
  input: CreateActionForHistoricalFindingInput
): Promise<CreateActionForHistoricalFindingResult> {
  if (!input.actionDescription.trim()) {
    throw new Error("Descrição da ação é obrigatória.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("project_memberships")
    .select("user_id,profiles(email)")
    .eq("project_id", input.projectId)
    .eq("user_id", input.responsibleUserId)
    .maybeSingle();

  if (membershipError) throw new Error(`Falha ao validar responsável: ${membershipError.message}`);
  if (!membership) {
    throw new Error("Responsável deve ser um membro real já conhecido pelo projeto — nunca atribuído automaticamente pela IA.");
  }

  const responsibleEmail = (membership as unknown as { profiles: { email: string } | null }).profiles?.email ?? "";
  if (!responsibleEmail.toLowerCase().endsWith("@axion.com.br")) {
    throw new Error(`Responsável deve ter e-mail @axion.com.br — recebido: "${responsibleEmail}".`);
  }

  const finding = await getFinding(supabase, input.findingId);
  if (!finding) throw new Error("Finding não encontrado.");

  const rule = resolveMatrixRule([], finding.severity, input.area);
  const createdAt = new Date().toISOString();
  const deadlines = computeSlaDeadlines(createdAt, rule, resolveBusinessHoursConfig(null));

  const { data: slaAction, error: slaActionError } = await supabase
    .from("sla_actions")
    .insert({
      project_id: input.projectId,
      origin: "AI_FINDING",
      related_ai_finding_id: input.findingId,
      title: `Finding histórico: ${finding.findingType}`,
      description: input.actionDescription.trim(),
      risk_level: finding.severity,
      area: input.area,
      responsible_user_id: input.responsibleUserId,
      contractual_deadline: input.dueAt || null,
      assume_due_at: deadlines.assumeDueAt,
      respond_due_at: deadlines.respondDueAt,
      complete_due_at: deadlines.completeDueAt,
      created_by_type: "USER",
      created_by_user_id: input.createdByUserId,
    })
    .select("id")
    .single();

  if (slaActionError) throw new Error(`Falha ao criar ação de SLA: ${slaActionError.message}`);

  const { error: updateError } = await supabase
    .from("ai_findings")
    .update({
      lifecycle_status: "ACTION_CREATED",
      reviewer_note: input.note?.trim() || null,
      reviewed_by_user_id: input.createdByUserId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.findingId);

  if (updateError) throw new Error(`Falha ao vincular ação ao finding: ${updateError.message}`);

  const updatedFinding = await getFinding(supabase, input.findingId);
  if (!updatedFinding) throw new Error("Finding não encontrado após atualização.");

  return { finding: updatedFinding, slaActionId: slaAction.id };
}
