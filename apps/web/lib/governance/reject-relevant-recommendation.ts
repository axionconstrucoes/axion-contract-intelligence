// Governança de rejeição de recomendações/findings relevantes — módulo
// central único. A IA recomenda, o humano decide; mas rejeitar uma
// recomendação ALTO/CRÍTICO nunca pode ser um descarte silencioso.
//
// Reaproveita integralmente o que já existe — nenhum motor paralelo:
//   * ai_findings.severity usa o MESMO enum de sla_actions.risk_level
//     (LOW/MEDIUM/HIGH/CRITICAL) — nenhum enum novo é criado aqui.
//   * sla_actions/sla_action_escalations/escalate_sla_action (motor de
//     SLA já existente, ver apps/web/lib/sla/**) — a rejeição só cria o
//     vínculo (origin='AI_FINDING', related_ai_finding_id) e chama o
//     mesmo mecanismo de escalonamento, nunca uma segunda lógica.
//   * A transição (UPDATE do finding + INSERT da sla_action + chamada a
//     escalate_sla_action) é feita inteira dentro da função de banco
//     reject_relevant_finding() (SECURITY DEFINER, uma única transação
//     implícita) — nunca uma sequência frágil de chamadas independentes
//     só no cliente. Ver
//     supabase/migrations/20260904120000_rejection_escalation_governance.sql.
//
// Único ponto de entrada para "rejeitar um finding" no código do ACC —
// updateFindingLifecycle (caminho de ACKNOWLEDGED/RESOLVED, inalterado)
// delega aqui especificamente para REJECTED, e é isso que evita
// duplicar esta regra em mais de um lugar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSlaDeadlines } from "../sla/compute-deadlines";
import { resolveBusinessHoursConfig, resolveMatrixRule } from "../sla/resolve-matrix-rule";
import type { SlaArea } from "../sla/types";
import { getFinding } from "../additionals/findings/get-findings";
import type { AiFinding } from "../additionals/findings/types";

/** Únicas duas severidades que disparam a política — usa o enum existente, nunca um novo. */
export const RELEVANT_RECOMMENDATION_SEVERITIES = ["HIGH", "CRITICAL"] as const;
export type RelevantRecommendationSeverity = (typeof RELEVANT_RECOMMENDATION_SEVERITIES)[number];

export function isRelevantRecommendationSeverity(severity: string): severity is RelevantRecommendationSeverity {
  return (RELEVANT_RECOMMENDATION_SEVERITIES as readonly string[]).includes(severity);
}

export interface JustificationCheckResult {
  valid: boolean;
  error: string | null;
}

/**
 * NULL, string vazia e string só com espaços/tabs/quebras de linha são
 * todas inválidas — mesma regra usada pelo banco (ver constraint
 * ai_findings_high_risk_rejection_requires_justification e a validação
 * em reject_relevant_finding()). Esta função é a MESMA que a UI usa para
 * orientar o usuário antes de submeter — nunca a única proteção (o banco
 * também valida, ver migration).
 */
export function validateRejectionJustification(
  severity: string,
  reviewerNote: string | null | undefined
): JustificationCheckResult {
  if (!isRelevantRecommendationSeverity(severity)) {
    return { valid: true, error: null };
  }

  const hasContent = typeof reviewerNote === "string" && /\S/.test(reviewerNote);
  if (!hasContent) {
    return {
      valid: false,
      error: `Justificativa é obrigatória para rejeitar uma recomendação de severidade ${severity === "HIGH" ? "ALTO" : "CRÍTICO"}.`,
    };
  }

  return { valid: true, error: null };
}

export interface RejectAiFindingInput {
  findingId: string;
  reviewerNote: string | null;
  /**
   * Obrigatório apenas quando o finding é HIGH/CRITICAL — é a área
   * organizacional cuja cadeia de escalonamento (sla_area_responsibles)
   * deve receber a ação. ai_findings não carrega uma classificação de
   * área própria (lacuna de dado registrada em
   * docs/sla-escalation.md/relatório da implementação) — por isso quem
   * decide a rejeição precisa indicar a área, mesmo padrão já aceito em
   * apps/web/lib/startup/create-action-for-historical-finding.ts.
   */
  area?: SlaArea | null;
}

export interface RejectAiFindingResult {
  finding: AiFinding;
  /** Ação de SLA vinculada — null quando a severidade não exige escalonamento (LOW/MEDIUM). */
  slaActionId: string | null;
  /** Registro em sla_action_escalations criado pela escalada imediata — null quando não houve escalonamento. */
  escalationId: string | null;
  /** true quando o finding já estava REJECTED e esta chamada só devolveu o vínculo já existente (idempotência). */
  alreadyExisted: boolean;
}

/**
 * Único caminho de domínio para rejeitar um ai_finding. Severidade
 * LOW/MEDIUM: comportamento equivalente ao update direto anterior (sem
 * exigir justificativa, sem escalonamento). Severidade HIGH/CRITICAL:
 * justificativa obrigatória, cria a sla_action vinculada e escalona
 * imediatamente RESPONSAVEL -> ESCALAO_1 (a rejeição em si é o evento
 * que exige escalonamento — nunca "esperar o SLA vencer depois").
 *
 * A validação aqui é defesa em profundidade para dar um erro claro
 * antes de ir ao banco — a proteção real e definitiva é a constraint +
 * a função reject_relevant_finding() (ver migration), nunca só esta
 * checagem client/server-action-side.
 */
export async function rejectAiFinding(supabase: SupabaseClient, input: RejectAiFindingInput): Promise<RejectAiFindingResult> {
  const finding = await getFinding(supabase, input.findingId);
  if (!finding) {
    throw new Error("Finding não encontrado.");
  }

  const relevant = isRelevantRecommendationSeverity(finding.severity);

  const justification = validateRejectionJustification(finding.severity, input.reviewerNote);
  if (!justification.valid) {
    throw new Error(justification.error ?? "Justificativa inválida.");
  }

  if (relevant && !input.area) {
    throw new Error("Área é obrigatória para rejeitar uma recomendação ALTO/CRÍTICO (define quem recebe o escalonamento).");
  }

  let assumeDueAt: string | null = null;
  let respondDueAt: string | null = null;
  let completeDueAt: string | null = null;

  if (relevant) {
    // Matriz resolvida sem sobrescrita de projeto — mesma decisão já
    // tomada em create-action-for-historical-finding.ts: reconsultar
    // sla_matrix_rules/sla_project_settings exigiria um módulo
    // "server-only" adicional aqui; o default institucional do motor de
    // SLA já existente continua uma regra válida e determinística,
    // nunca inventada.
    const rule = resolveMatrixRule([], finding.severity, input.area as SlaArea);
    const deadlines = computeSlaDeadlines(new Date().toISOString(), rule, resolveBusinessHoursConfig(null));
    assumeDueAt = deadlines.assumeDueAt;
    respondDueAt = deadlines.respondDueAt;
    completeDueAt = deadlines.completeDueAt;
  }

  const { data, error } = await supabase.rpc("reject_relevant_finding", {
    p_finding_id: input.findingId,
    p_reviewer_note: input.reviewerNote,
    p_area: relevant ? input.area : null,
    p_assume_due_at: assumeDueAt,
    p_respond_due_at: respondDueAt,
    p_complete_due_at: completeDueAt,
  });

  if (error) {
    throw new Error(`Falha ao rejeitar finding: ${error.message}`);
  }

  const row = (data as { sla_action_id: string | null; escalation_id: string | null; already_existed: boolean }[])[0];

  const updatedFinding = await getFinding(supabase, input.findingId);
  if (!updatedFinding) {
    throw new Error("Finding não encontrado após a rejeição.");
  }

  return {
    finding: updatedFinding,
    slaActionId: row?.sla_action_id ?? null,
    escalationId: row?.escalation_id ?? null,
    alreadyExisted: row?.already_existed ?? false,
  };
}
