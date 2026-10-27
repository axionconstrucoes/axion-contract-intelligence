import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { planDeliveryFollowups } from "./delivery-alert-plan";
import { DELIVERY_ITEM_COLUMNS, toDeliveryItem, type DeliveryItemRow } from "./delivery-mappers";

export interface DeliveryAlertScanResult {
  itemsOpen: number;
  due: number;
  opened: number;
  alreadyTracked: number;
  skippedNoRecipient: number;
  failed: number;
}

function todayInSaoPaulo(now: Date): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Varredura dos alertas de providências (D−60, prazos individuais e providências de início).
 * NÃO envia e-mail: apenas ABRE (idempotente) o acompanhamento recorrente compartilhado
 * (alert_followups, origem DELIVERY_ITEM) de cada item devido que ainda não tem um aberto, com o
 * primeiro lembrete devido AGORA — quem envia é o ciclo de lembretes (com reivindicação atômica e
 * nova tentativa), então uma varredura concorrente ou repetida nunca duplica o primeiro alerta.
 * Sem estado: ativar um item dentro da janela o torna devido na próxima execução.
 */
export async function scanDeliveryAlerts(admin: SupabaseClient, now: Date): Promise<DeliveryAlertScanResult> {
  const result: DeliveryAlertScanResult = { itemsOpen: 0, due: 0, opened: 0, alreadyTracked: 0, skippedNoRecipient: 0, failed: 0 };
  const today = todayInSaoPaulo(now);

  const { data: rows, error } = await admin
    .from("project_delivery_items")
    .select(`project_id,${DELIVERY_ITEM_COLUMNS}`)
    .in("status", ["PENDENTE", "EM_ANDAMENTO"]);
  if (error) {
    // Módulo ainda não habilitado neste ambiente (migration não aplicada): nada a varrer.
    if (["42P01", "PGRST205", "PGRST200"].includes(error.code ?? "")) return result;
    throw new Error("Falha ao carregar as providências para varredura.");
  }

  const itemRows = (rows ?? []) as unknown as Array<DeliveryItemRow & { project_id: string }>;
  result.itemsOpen = itemRows.length;
  if (itemRows.length === 0) return result;

  const projectIds = Array.from(new Set(itemRows.map((r) => r.project_id)));
  const [{ data: projects }, { data: admins }, { data: openFollowups }] = await Promise.all([
    admin.from("projects").select("id,baseline_end_date").in("id", projectIds),
    admin
      .from("project_memberships")
      .select("project_id,user_id")
      .in("project_id", projectIds)
      .eq("status", "ACTIVE")
      .eq("permission", "ADMINISTRADOR")
      .order("user_id", { ascending: true }),
    admin
      .from("alert_followups")
      .select("source_id")
      .eq("source_type", "DELIVERY_ITEM")
      .eq("status", "OPEN")
      .in("project_id", projectIds),
  ]);

  const endByProject = new Map((projects ?? []).map((p) => [p.id as string, p.baseline_end_date ? String(p.baseline_end_date).slice(0, 10) : null]));
  const fallbackAdminByProject = new Map<string, string>();
  for (const a of admins ?? []) if (!fallbackAdminByProject.has(a.project_id as string)) fallbackAdminByProject.set(a.project_id as string, a.user_id as string);
  const tracked = new Set((openFollowups ?? []).map((f) => f.source_id as string));

  for (const projectId of projectIds) {
    const plan = planDeliveryFollowups({
      items: itemRows.filter((r) => r.project_id === projectId).map(toDeliveryItem),
      projectEndDay: endByProject.get(projectId) ?? null,
      today,
      now,
      trackedItemIds: tracked,
      fallbackAdminUserId: fallbackAdminByProject.get(projectId) ?? null,
    });
    result.due += plan.due;
    result.alreadyTracked += plan.alreadyTracked;
    result.skippedNoRecipient += plan.skippedNoRecipient;

    for (const planned of plan.toOpen) {
      const { error: openError } = await admin.rpc("alert_followup_open", {
        p_project_id: projectId,
        p_source_type: "DELIVERY_ITEM",
        p_source_id: planned.itemId,
        p_severity: planned.severity,
        p_responsible_user_id: planned.responsibleUserId,
        p_sent_at: planned.sentAt,
      });
      if (openError) result.failed += 1;
      else {
        result.opened += 1;
        tracked.add(planned.itemId);
      }
    }
  }
  return result;
}
