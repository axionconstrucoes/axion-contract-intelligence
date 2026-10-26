import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSeverity } from "@axion/types";

// Ligação entre os fluxos de alerta existentes (lote de alertas de contrato) e o acompanhamento
// recorrente (alert_followups — migration 20261027120000). Regras e semântica: followup-engine.ts.

/**
 * Chamado DEPOIS que o provedor aceitou o lote: abre (idempotente) o acompanhamento de cada
 * alerta, com o destinatário como responsável e o primeiro lembrete em envio + intervalo do risco.
 * Nunca lança por causa do acompanhamento — o envio já aconteceu e não deve ser desfeito.
 */
export async function openFollowupsForSentBatch(
  admin: SupabaseClient,
  input: {
    projectId: string;
    recipientUserId: string;
    items: ReadonlyArray<{ eventId: string; severity: AlertSeverity }>;
    sentAt: string;
  }
): Promise<{ opened: number; failed: number }> {
  let opened = 0;
  let failed = 0;
  for (const item of input.items) {
    const { error } = await admin.rpc("alert_followup_open", {
      p_project_id: input.projectId,
      p_source_type: "CONTRACT_EVENT",
      p_source_id: item.eventId,
      p_severity: item.severity,
      p_responsible_user_id: input.recipientUserId,
      p_sent_at: input.sentAt,
    });
    if (error) failed += 1;
    else opened += 1;
  }
  return { opened, failed };
}

export type FollowupAction = "EM_ANDAMENTO" | "ENVIADO_PARA" | "RESOLVIDO";

/**
 * Espelha no acompanhamento a resposta registrada no lote (mesma sessão do usuário — a função SQL
 * confere responsável/administrador da obra). RESOLVIDO interrompe os lembretes; EM ANDAMENTO
 * mantém (sem adiar); ENVIADO P/ troca o responsável.
 */
export async function applyBatchResponsesToFollowups(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    responses: ReadonlyArray<{ eventId: string; action: FollowupAction; assignedUserId?: string | null }>;
  }
): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  for (const response of input.responses) {
    const { error } = await supabase.rpc("alert_followup_apply_action", {
      p_project_id: input.projectId,
      p_source_type: "CONTRACT_EVENT",
      p_source_id: response.eventId,
      p_action: response.action,
      p_assigned_user_id: response.assignedUserId ?? null,
    });
    if (error) failed += 1;
    else applied += 1;
  }
  return { applied, failed };
}
