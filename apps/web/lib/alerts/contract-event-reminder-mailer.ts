import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";
import type { AlertSeverity } from "@axion/types";

import { getAppBaseUrl } from "../app-base-url";
import { createAndSendContractAlertBatch } from "../email/create-and-send-contract-alert-batch";
import type { ReminderMailer, ReminderMessage } from "./followup-engine";
import { loadEventAlertContexts } from "./load-event-alert-context";

class ReminderError extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

/**
 * Lembrete de um alerta de EVENTO DE CONTRATO: reenvia o alerta como lote de UM item ao
 * responsável ATUAL (nunca ao anterior), pelo mesmo caminho do envio original — guard do piloto,
 * logo, caixa colorida e botões de ação por item (os links apontam para a página de confirmação;
 * nada é registrado por GET). Os erros viram nomes curtos (sem conteúdo de e-mail).
 */
export class ContractEventReminderMailer implements ReminderMailer {
  async send(message: ReminderMessage): Promise<void> {
    if (message.followup.sourceType !== "CONTRACT_EVENT") throw new ReminderError("ORIGEM_NAO_SUPORTADA");

    const admin = createSupabaseAdminClient();
    const eventId = message.followup.sourceId;
    const projectId = message.followup.projectId;

    const [{ data: event }, { data: assessment }, contexts, { data: config }] = await Promise.all([
      admin.from("contract_events").select("id,project_id,title,description").eq("id", eventId).maybeSingle(),
      admin.from("event_ai_assessments").select("severity,summary").eq("event_id", eventId).maybeSingle(),
      loadEventAlertContexts(admin, [eventId], getAppBaseUrl()),
      admin
        .from("project_weekly_schedule_ingestion_configs")
        .select("pilot_delivery_override_email")
        .eq("project_id", projectId)
        .maybeSingle(),
    ]);

    if (!event || event.project_id !== projectId) throw new ReminderError("EVENTO_AUSENTE");

    const severity = (message.followup.severity ?? assessment?.severity) as AlertSeverity;
    const riskDescription = assessment?.summary?.trim() || event.description?.trim() || "Evento contratual em acompanhamento.";

    try {
      await createAndSendContractAlertBatch({
        projectId,
        recipientUserId: message.recipientUserId,
        deliveryEmail: config?.pilot_delivery_override_email ?? undefined,
        items: [
          {
            eventId: event.id,
            title: event.title,
            severity,
            riskDescription,
            projectName: contexts.get(eventId)?.projectName,
            clauseLabel: contexts.get(eventId)?.clause?.label ?? null,
            clauseText: contexts.get(eventId)?.clause?.text ?? null,
            evidence: contexts.get(eventId)?.evidence ?? [],
            eventUrl: `${getAppBaseUrl()}/${projectId}/ledger/${event.id}`,
          },
        ],
      });
    } catch (error) {
      throw new ReminderError(error instanceof Error && error.name === "EmailSendError" ? "ENVIO_RECUSADO" : "ENVIO_FALHOU");
    }
  }
}
