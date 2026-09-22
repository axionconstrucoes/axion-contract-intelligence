// Composição automática do lote semanal (MÉDIO/BAIXO) — puro, sem I/O,
// deliberadamente sem "server-only" para ser testável por um script Node
// standalone (mesmo padrão de contract-alert-batch-validation.ts e
// pilot-outbound-guard.ts). A ÚNICA função que decide QUAIS eventos
// entram em QUAL lote de QUAL destinatário — run-weekly-contract-alert-
// batches.ts (I/O real) nunca reimplementa este critério, só carrega os
// dados e chama esta função.
//
// CRÍTICO e ALTA nunca entram aqui — continuam no fluxo imediato
// existente (SendContractAlertForm, "Enviar Alerta"), inalterado por
// esta feature.

import type { AlertSeverity } from "@axion/types";

export type ContractEventLifecycleStatus = "NOVO" | "EM_ANALISE" | "CONFRONTADO" | "RESOLVIDO";

/** Severidades elegíveis para o lote semanal automático — nunca ALTA/CRITICA. */
export const WEEKLY_AUTO_ELIGIBLE_SEVERITIES: readonly AlertSeverity[] = ["BAIXA", "MEDIA"];

export interface WeeklyAutoEligibleEventInput {
  eventId: string;
  projectId: string;
  occurredAt: string;
  title: string;
  status: ContractEventLifecycleStatus;
  /** null = evento ainda sem achado de IA (event_ai_assessments) — nunca elegível: não há o que alertar. */
  severity: AlertSeverity | null;
}

// Requisito 6: só eventos ATIVOS (status != RESOLVIDO — ciclo de vida do
// PRÓPRIO evento em contract_events, nunca o estado de resposta de um
// lote), com severidade BAIXA/MEDIA. "ainda não respondido naquele
// ciclo" é responsabilidade de quem chama (alreadyBatchedEventIds
// abaixo) — depende do histórico de lotes já existentes, não é uma
// propriedade do evento isoladamente.
export function isEventEligibleForWeeklyAutoBatch(
  event: Pick<WeeklyAutoEligibleEventInput, "status" | "severity">
): boolean {
  return (
    event.status !== "RESOLVIDO" &&
    event.severity !== null &&
    WEEKLY_AUTO_ELIGIBLE_SEVERITIES.includes(event.severity)
  );
}

export interface WeeklyAutoBatchRecipient {
  projectId: string;
  userId: string;
  email: string;
  name: string;
}

export interface WeeklyAutoBatchCompositionItem {
  eventId: string;
  severity: "BAIXA" | "MEDIA";
  title: string;
  position: number;
}

export interface WeeklyAutoBatchCompositionPlan {
  projectId: string;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string;
  cutoffDate: string;
  items: WeeklyAutoBatchCompositionItem[];
}

export interface PlanWeeklyContractAlertBatchesInput {
  events: readonly WeeklyAutoEligibleEventInput[];
  /**
   * event_id de qualquer contract_alert_batch_item já existente
   * (qualquer lote, qualquer semana, qualquer status) — requisito 4:
   * um evento tratado uma vez nunca reentra em outro lote semanal,
   * mesmo que ainda esteja "pendente" na semana corrente.
   */
  alreadyBatchedEventIds: ReadonlySet<string>;
  /**
   * Destinatário(s) reais de cada projeto, já resolvidos por quem chama
   * a partir da fonte de responsável aprovada (ver
   * run-weekly-contract-alert-batches.ts) — esta função nunca decide
   * QUEM é o destinatário, só QUAIS eventos entram no lote de cada
   * destinatário já informado. Sem nenhum destinatário resolvido, o
   * projeto simplesmente não compõe lote nesta semana (nunca um
   * destinatário inventado).
   */
  recipientsByProject: ReadonlyMap<string, readonly WeeklyAutoBatchRecipient[]>;
  /** Data local (YYYY-MM-DD) da quarta-feira deste fechamento — ver resolveContractAlertBatchWeeklyWindow (contract-alert-batch-weekly-window.ts). Injetada, nunca calculada aqui (mantém esta função pura e determinística). */
  cutoffDate: string;
}

// Requisito 3: nunca mistura projetos diferentes no mesmo lote (agrupa
// por projectId primeiro). Requisito 4: um mesmo eventId nunca aparece
// duas vezes na MESMA lista de itens (Map por eventId antes de agrupar
// remove duplicatas do próprio input; alreadyBatchedEventIds cobre
// duplicação ENTRE execuções/semanas). Ordenação determinística
// (MEDIA antes de BAIXA, depois data do evento, depois eventId) — a
// mesma composição sempre produz a mesma ordem de position.
export function planWeeklyContractAlertBatches(
  input: PlanWeeklyContractAlertBatchesInput
): WeeklyAutoBatchCompositionPlan[] {
  const dedupedEvents = new Map<string, WeeklyAutoEligibleEventInput>();
  for (const event of input.events) {
    dedupedEvents.set(event.eventId, event);
  }

  const eligible = Array.from(dedupedEvents.values()).filter(
    (event) => isEventEligibleForWeeklyAutoBatch(event) && !input.alreadyBatchedEventIds.has(event.eventId)
  );

  const eventsByProject = new Map<string, WeeklyAutoEligibleEventInput[]>();
  for (const event of eligible) {
    const bucket = eventsByProject.get(event.projectId);
    if (bucket) bucket.push(event);
    else eventsByProject.set(event.projectId, [event]);
  }

  const severityRank = (severity: AlertSeverity | null): number => (severity === "MEDIA" ? 0 : 1);

  const plans: WeeklyAutoBatchCompositionPlan[] = [];
  for (const [projectId, projectEvents] of eventsByProject) {
    const recipients = input.recipientsByProject.get(projectId) ?? [];
    if (recipients.length === 0 || projectEvents.length === 0) continue;

    const ordered = [...projectEvents].sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        a.occurredAt.localeCompare(b.occurredAt) ||
        a.eventId.localeCompare(b.eventId)
    );

    const items: WeeklyAutoBatchCompositionItem[] = ordered.map((event, index) => ({
      eventId: event.eventId,
      severity: event.severity as "BAIXA" | "MEDIA",
      title: event.title,
      position: index + 1,
    }));

    for (const recipient of recipients) {
      plans.push({
        projectId,
        recipientUserId: recipient.userId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        cutoffDate: input.cutoffDate,
        items,
      });
    }
  }

  return plans;
}
