import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { ContractEventReminderMailer } from "./contract-event-reminder-mailer";
import { runReminderCycle, type ReminderCycleResult } from "./followup-engine";
import { SupabaseFollowupStore } from "./followup-supabase-store";

// Um ciclo de lembretes recorrentes. Chamado pelo agendador existente (GitHub Actions →
// /api/cron/alert-reminders). Reivindica só o que está devido AGORA; uma execução atrasada gera
// UM lembrete por alerta (sem acúmulo).
export async function runAlertReminders(now: Date = new Date()): Promise<ReminderCycleResult> {
  return runReminderCycle({
    store: new SupabaseFollowupStore(createSupabaseAdminClient()),
    mailer: new ContractEventReminderMailer(),
    now,
    limit: 50,
  });
}
