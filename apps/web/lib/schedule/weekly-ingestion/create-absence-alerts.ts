// Alerta de AUSÊNCIA do cronograma semanal — único e idempotente por
// (projeto, semana, tipo). Considera "recebido" um intake
// AUTHORIZED_AUTO, APPROVED_HUMAN_REVIEW, PENDING_HUMAN_REVIEW ou
// RECEIVED_DUPLICATE da semana: um envio válido cujo .mpp já era
// conhecido COMPROVA que o envio ocorreu (obrigação semanal cumprida),
// mesmo sem versão nova. A entrega aos destinatários internos
// (config.alertRecipientUserIds) é etapa posterior, fora deste módulo
// (ver docs/weekly-schedule-email-ingestion.md).

import type { AbsenceAlertStore } from "./store";
import type { WeeklyScheduleIngestionConfig } from "./types";
import { isWithinMonitoringWindow } from "./evaluate-weekly-schedule-email";
import { resolveCurrentWeekDeadline } from "./week-window";

export interface AbsenceAlertOutcome {
  projectId: string;
  weekStart: string;
  deadlineAt: string;
  result: "NOT_DUE" | "RECEIVED" | "CREATED" | "ALREADY_ALERTED" | "OUTSIDE_WINDOW" | "DISABLED" | "NO_SCHEDULE_YET";
  alertId: string | null;
}

export async function createWeeklyAbsenceAlert(
  store: AbsenceAlertStore,
  config: WeeklyScheduleIngestionConfig,
  now: Date = new Date()
): Promise<AbsenceAlertOutcome> {
  const { weekStart, deadlineAt, isPastDeadline } = resolveCurrentWeekDeadline(now, config);
  const base = { projectId: config.projectId, weekStart, deadlineAt: deadlineAt.toISOString(), alertId: null };

  if (!config.enabled) return { ...base, result: "DISABLED" };
  if (!isWithinMonitoringWindow(now.toISOString(), config)) return { ...base, result: "OUTSIDE_WINDOW" };
  if (!isPastDeadline) return { ...base, result: "NOT_DUE" };

  if (await store.hasReceivedScheduleForWeek(config.projectId, weekStart)) {
    return { ...base, result: "RECEIVED" };
  }

  const inserted = await store.insertAlert({
    projectId: config.projectId,
    configId: config.id,
    kind: "MISSING_WEEKLY_SCHEDULE",
    weekStart,
    deadlineAt: deadlineAt.toISOString(),
    recipientUserIds: config.alertRecipientUserIds,
    detail:
      `Nenhum cronograma semanal (.mpp) autorizado foi recebido na semana de ${weekStart} ` +
      `até o prazo-limite ${deadlineAt.toISOString()} (${config.timezone}).`,
  });

  if (!inserted.created) return { ...base, result: "ALREADY_ALERTED" };

  await store.writeAudit({
    projectId: config.projectId,
    action: "WEEKLY_SCHEDULE_MISSING_ALERT_CREATED",
    entityType: "WEEKLY_SCHEDULE_INGESTION_ALERT",
    entityId: inserted.id ?? `${config.projectId}:${weekStart}`,
    detail: `Alerta de ausência do cronograma semanal criado para a semana de ${weekStart}.`,
  });

  return { ...base, result: "CREATED", alertId: inserted.id };
}

/**
 * Alerta de AUSÊNCIA DA CURVA S (configurável: só quando
 * config.sCurveAlertEnabled). Devido quando o prazo semanal passou, o
 * cronograma semanal FOI recebido e nenhuma Curva S foi identificada
 * nos anexos daquela semana. Idempotente por (projeto, semana, kind).
 */
export async function createWeeklySCurveAbsenceAlert(
  store: AbsenceAlertStore,
  config: WeeklyScheduleIngestionConfig & { sCurveAlertEnabled?: boolean },
  now: Date = new Date()
): Promise<AbsenceAlertOutcome> {
  const { weekStart, deadlineAt, isPastDeadline } = resolveCurrentWeekDeadline(now, config);
  const base = { projectId: config.projectId, weekStart, deadlineAt: deadlineAt.toISOString(), alertId: null };

  if (!config.enabled || config.sCurveAlertEnabled === false) return { ...base, result: "DISABLED" };
  if (!isWithinMonitoringWindow(now.toISOString(), config)) return { ...base, result: "OUTSIDE_WINDOW" };
  if (!isPastDeadline) return { ...base, result: "NOT_DUE" };
  if (!(await store.hasReceivedScheduleForWeek(config.projectId, weekStart))) return { ...base, result: "NO_SCHEDULE_YET" };
  if (await store.hasSCurveForWeek(config.projectId, weekStart)) return { ...base, result: "RECEIVED" };

  const inserted = await store.insertAlert({
    projectId: config.projectId,
    configId: config.id,
    kind: "MISSING_S_CURVE",
    weekStart,
    deadlineAt: deadlineAt.toISOString(),
    recipientUserIds: config.alertRecipientUserIds,
    detail: `Relatório semanal recebido na semana de ${weekStart}, mas nenhuma Curva S foi identificada nos anexos até o prazo-limite ${deadlineAt.toISOString()}.`,
  });
  if (!inserted.created) return { ...base, result: "ALREADY_ALERTED" };

  await store.writeAudit({
    projectId: config.projectId,
    action: "WEEKLY_S_CURVE_MISSING_ALERT_CREATED",
    entityType: "WEEKLY_SCHEDULE_INGESTION_ALERT",
    entityId: inserted.id ?? `${config.projectId}:${weekStart}:S_CURVE`,
    detail: `Alerta de ausência da Curva S criado para a semana de ${weekStart}.`,
  });
  return { ...base, result: "CREATED", alertId: inserted.id };
}
