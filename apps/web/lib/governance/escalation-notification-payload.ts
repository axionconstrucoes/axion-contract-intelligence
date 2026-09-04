// Infraestrutura de representação para uma futura notificação real do
// superior hierárquico — NUNCA envia nada (nem e-mail, nem push). O
// envio é deliberadamente uma etapa separada e futura.
//
// Monta o conteúdo necessário inteiramente a partir do que
// rejectAiFinding() já buscou/devolveu — nenhuma chamada extra ao
// banco, nenhum dado inventado. Quando a severidade não exigiu
// escalonamento (LOW/MEDIUM), não há o que notificar: retorna null.

import type { RejectAiFindingResult, RelevantRecommendationSeverity } from "./reject-relevant-recommendation";

export interface EscalationNotificationPayload {
  projectId: string;
  findingId: string;
  findingType: string;
  severity: RelevantRecommendationSeverity;
  /** Recomendação original do Expert/curadoria — nunca reescrita aqui. */
  recommendation: string;
  interpretation: string;
  /** Decisão humana — sempre "REJECTED" nesta função (é o único caso que gera este payload). */
  humanDecision: "REJECTED";
  reviewedByUserId: string;
  reviewedAt: string;
  reviewerNote: string;
  slaActionId: string;
  escalationId: string | null;
  /** Superior resolvido em sla_area_responsibles — null quando ausente (ver escalationTargetResolved). */
  escalationTargetUserId: string | null;
  /**
   * false quando nenhum responsável está configurado para a área — um
   * futuro envio de notificação NUNCA deve afirmar "avisamos o
   * superior" quando este campo é false; deve, em vez disso, sinalizar
   * a lacuna de configuração (ver auditoria: ai
   * ESCALATION_TARGET_NOT_CONFIGURED em audit_log_entries).
   */
  escalationTargetResolved: boolean;
}

/**
 * null quando a rejeição não exigiu escalonamento (severidade
 * LOW/MEDIUM, ou finding.reviewerNote/reviewedBy ainda ausentes por
 * algum motivo inesperado) — nunca monta um payload incompleto/
 * inventado.
 */
export function buildEscalationNotificationPayload(result: RejectAiFindingResult): EscalationNotificationPayload | null {
  if (!result.slaActionId) {
    return null;
  }

  const { finding } = result;

  if (!finding.reviewedByUserId || !finding.reviewedAt) {
    return null;
  }

  return {
    projectId: finding.projectId,
    findingId: finding.id,
    findingType: finding.findingType,
    severity: finding.severity as RelevantRecommendationSeverity,
    recommendation: finding.recommendation,
    interpretation: finding.interpretation,
    humanDecision: "REJECTED",
    reviewedByUserId: finding.reviewedByUserId,
    reviewedAt: finding.reviewedAt,
    reviewerNote: finding.reviewerNote ?? "",
    slaActionId: result.slaActionId,
    escalationId: result.escalationId,
    escalationTargetUserId: result.escalationTargetUserId,
    escalationTargetResolved: result.escalationTargetResolved,
  };
}
