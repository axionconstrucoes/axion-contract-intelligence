import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { scanDeliveryAlerts, type DeliveryAlertScanResult } from "../delivery/delivery-alert-scan";
import { ContractEventReminderMailer } from "./contract-event-reminder-mailer";
import { DeliveryItemReminderMailer } from "./delivery-item-reminder-mailer";
import { runReminderCycle, type ReminderCycleResult, type ReminderMailer, type ReminderMessage } from "./followup-engine";
import { SupabaseFollowupStore } from "./followup-supabase-store";

// Roteia o lembrete pela origem do acompanhamento (evento de contrato ou providência de entrega).
class SourceRoutingMailer implements ReminderMailer {
  private readonly contractEvent = new ContractEventReminderMailer();
  private readonly deliveryItem = new DeliveryItemReminderMailer();

  send(message: ReminderMessage): Promise<void> {
    return message.followup.sourceType === "DELIVERY_ITEM" ? this.deliveryItem.send(message) : this.contractEvent.send(message);
  }
}

export interface AlertRemindersRunResult extends ReminderCycleResult {
  deliveryScan: DeliveryAlertScanResult | { error: string };
}

// Um ciclo completo, chamado pelo agendador existente (GitHub Actions → /api/cron/alert-reminders):
//  1) varredura das providências devidas (D−60 / prazo individual / início): abre o acompanhamento;
//  2) ciclo de lembretes: reivindica o que está devido AGORA e envia ao responsável atual.
// Uma execução atrasada gera UM lembrete por alerta (sem acúmulo).
export async function runAlertReminders(now: Date = new Date()): Promise<AlertRemindersRunResult> {
  const admin = createSupabaseAdminClient();

  let deliveryScan: AlertRemindersRunResult["deliveryScan"];
  try {
    deliveryScan = await scanDeliveryAlerts(admin, now);
  } catch {
    // A varredura de providências não pode impedir os lembretes de alertas já abertos.
    deliveryScan = { error: "VARREDURA_FALHOU" };
  }

  const cycle = await runReminderCycle({ store: new SupabaseFollowupStore(admin), mailer: new SourceRoutingMailer(), now, limit: 50 });
  return { ...cycle, deliveryScan };
}
