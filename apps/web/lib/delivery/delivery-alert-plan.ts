// Puro, sem I/O — decide QUAIS providências precisam abrir acompanhamento recorrente numa
// varredura, e para quem. A varredura real (delivery-alert-scan.ts) só lê o banco, chama esta
// função e abre os acompanhamentos; testado em scripts/test-delivery-items.mjs.

import type { AlertSeverity } from "@axion/types";

import { repeatIntervalMs } from "@/lib/alerts/repeat-policy";

import { cnoAlertReasons, selectDueDeliveryAlerts, type DeliveryItem } from "./delivery-items";

export interface PlannedDeliveryFollowup {
  itemId: string;
  severity: AlertSeverity;
  responsibleUserId: string;
  /** Instante de "envio" a registrar: agora − intervalo, para o 1º lembrete ficar devido AGORA. */
  sentAt: string;
  reason: "D_MENOS_60" | "PRAZO_INDIVIDUAL" | "INICIO";
}

export interface DeliveryPlanResult {
  due: number;
  alreadyTracked: number;
  skippedNoRecipient: number;
  toOpen: PlannedDeliveryFollowup[];
}

export function planDeliveryFollowups(input: {
  items: readonly DeliveryItem[];
  projectEndDay: string | null;
  today: string;
  now: Date;
  /** Itens que já têm acompanhamento ABERTO. */
  trackedItemIds: ReadonlySet<string>;
  /** Primeiro administrador ativo da obra — destinatário de itens sem responsável. */
  fallbackAdminUserId: string | null;
}): DeliveryPlanResult {
  const result: DeliveryPlanResult = { due: 0, alreadyTracked: 0, skippedNoRecipient: 0, toOpen: [] };

  const candidates: Array<{ item: DeliveryItem; severity: AlertSeverity; reason: PlannedDeliveryFollowup["reason"] }> = [];
  for (const d of selectDueDeliveryAlerts(input.items, input.projectEndDay, input.today)) {
    candidates.push({ item: d.item, severity: d.severity, reason: d.schedule.basis === "PRAZO_INDIVIDUAL" ? "PRAZO_INDIVIDUAL" : "D_MENOS_60" });
  }
  for (const item of input.items) {
    // Providências de INÍCIO (ex.: CNO) não esperam a janela de 60 dias da entrega.
    if (item.phase === "INICIO" && cnoAlertReasons(item, input.today).length > 0) {
      candidates.push({ item, severity: item.risk ?? "MEDIA", reason: "INICIO" });
    }
  }

  for (const c of candidates) {
    result.due += 1;
    if (input.trackedItemIds.has(c.item.id)) {
      result.alreadyTracked += 1;
      continue;
    }
    const recipient = c.item.responsibleUserId ?? input.fallbackAdminUserId;
    if (!recipient) {
      result.skippedNoRecipient += 1;
      continue;
    }
    result.toOpen.push({
      itemId: c.item.id,
      severity: c.severity,
      responsibleUserId: recipient,
      sentAt: new Date(input.now.getTime() - repeatIntervalMs(c.severity)).toISOString(),
      reason: c.reason,
    });
  }
  return result;
}
