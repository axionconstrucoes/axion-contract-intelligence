// Alerta de AUSÊNCIA do cronograma semanal — único e idempotente por
// (projeto, semana, tipo). Considera "recebido" um intake
// AUTHORIZED_AUTO, APPROVED_HUMAN_REVIEW, PENDING_HUMAN_REVIEW ou
// RECEIVED_DUPLICATE da semana: um envio válido cujo .mpp já era
// conhecido COMPROVA que o envio ocorreu (obrigação semanal cumprida),
// mesmo sem versão nova. A entrega aos destinatários internos
// (config.alertRecipientUserIds) é etapa posterior, fora deste módulo
// (ver docs/weekly-schedule-email-ingestion.md).

import type { AbsenceAlertStore, OpenAbsenceAlert } from "./store";
import type { WeeklyScheduleIngestionConfig } from "./types";
import { isWithinMonitoringWindow } from "./evaluate-weekly-schedule-email";
import { resolveCurrentWeekDeadline } from "./week-window";

export interface AbsenceAlertOutcome {
  projectId: string;
  weekStart: string;
  deadlineAt: string;
  result: "NOT_DUE" | "RECEIVED" | "CREATED" | "ALREADY_ALERTED" | "OUTSIDE_WINDOW" | "DISABLED" | "NO_SCHEDULE_YET" | "STORE_UNSUPPORTED";
  alertId: string | null;
}

/**
 * Alerta de AUSÊNCIA DA PLANILHA DO RELATÓRIO SEMANAL (.xlsx). Mesmas
 * garantias dos demais alertas de ausência: devido só após o prazo
 * semanal (deadline_weekday/deadline_time/timezone da configuração),
 * dentro da janela de monitoramento, quando o cronograma da semana FOI
 * recebido (a planilha viaja no mesmo envio semanal) e NENHUM
 * weekly_report_workbooks está ligado a intake daquela semana. Planilha
 * inválida/pendente de revisão conta como recebida (não é ausência).
 * Idempotente por (projeto, semana, kind) — UNIQUE no banco. Uma nova
 * semana gera um novo alerta; a chegada posterior é tratada por
 * resolveAbsenceAlertsWithEvidence.
 */
export async function createWeeklyWorkbookAbsenceAlert(
  store: AbsenceAlertStore,
  config: WeeklyScheduleIngestionConfig & { workbookAlertEnabled?: boolean },
  now: Date = new Date()
): Promise<AbsenceAlertOutcome> {
  const { weekStart, deadlineAt, isPastDeadline } = resolveCurrentWeekDeadline(now, config);
  const base = { projectId: config.projectId, weekStart, deadlineAt: deadlineAt.toISOString(), alertId: null };

  if (!config.enabled || config.workbookAlertEnabled === false) return { ...base, result: "DISABLED" };
  if (!store.hasWorkbookForWeek) return { ...base, result: "STORE_UNSUPPORTED" };
  if (!isWithinMonitoringWindow(now.toISOString(), config)) return { ...base, result: "OUTSIDE_WINDOW" };
  if (!isPastDeadline) return { ...base, result: "NOT_DUE" };
  if (!(await store.hasReceivedScheduleForWeek(config.projectId, weekStart))) return { ...base, result: "NO_SCHEDULE_YET" };
  if (await store.hasWorkbookForWeek(config.projectId, weekStart)) return { ...base, result: "RECEIVED" };

  const inserted = await store.insertAlert({
    projectId: config.projectId,
    configId: config.id,
    kind: "MISSING_WEEKLY_REPORT_WORKBOOK",
    weekStart,
    deadlineAt: deadlineAt.toISOString(),
    recipientUserIds: config.alertRecipientUserIds,
    detail: `Cronograma semanal recebido na semana de ${weekStart}, mas nenhuma planilha do relatório semanal (.xlsx) foi identificada nos anexos até o prazo-limite ${deadlineAt.toISOString()}.`,
  });
  if (!inserted.created) return { ...base, result: "ALREADY_ALERTED" };

  await store.writeAudit({
    projectId: config.projectId,
    action: "WEEKLY_REPORT_WORKBOOK_MISSING_ALERT_CREATED",
    entityType: "WEEKLY_SCHEDULE_INGESTION_ALERT",
    entityId: inserted.id ?? `${config.projectId}:${weekStart}:WORKBOOK`,
    detail: `Alerta de ausência da planilha do relatório semanal criado para a semana de ${weekStart}.`,
  });
  return { ...base, result: "CREATED", alertId: inserted.id };
}

export interface AbsenceResolutionOutcome {
  projectId: string;
  examined: number;
  resolved: number;
  resolvedAlertIds: string[];
}

/**
 * Chegada posterior da evidência resolve o alerta de ausência (resolved_at)
 * — e, por consequência, o caso de risco correspondente é encerrado pelo
 * ciclo de alertas (INGESTION_ALERT closed = resolved_at). Idempotente:
 * cada alerta é resolvido uma única vez; o que ainda não tem evidência
 * permanece aberto. Não cria, não reabre, não apaga nada.
 */
export async function resolveAbsenceAlertsWithEvidence(store: AbsenceAlertStore, projectId: string): Promise<AbsenceResolutionOutcome> {
  const outcome: AbsenceResolutionOutcome = { projectId, examined: 0, resolved: 0, resolvedAlertIds: [] };
  if (!store.listOpenAbsenceAlerts || !store.resolveAbsenceAlert) return outcome;
  const open: OpenAbsenceAlert[] = await store.listOpenAbsenceAlerts(projectId);
  for (const alert of open) {
    outcome.examined += 1;
    const hasEvidence = await absenceEvidenceExists(store, alert);
    if (!hasEvidence) continue;
    const detailSuffix = ` Evidência recebida posteriormente (${alert.kind}, semana de ${alert.weekStart}); alerta resolvido automaticamente.`;
    const resolved = await store.resolveAbsenceAlert(alert.id, `Resolvido:${detailSuffix}`);
    if (!resolved) continue;
    outcome.resolved += 1;
    outcome.resolvedAlertIds.push(alert.id);
    await store.writeAudit({
      projectId,
      action: "WEEKLY_ABSENCE_ALERT_RESOLVED",
      entityType: "WEEKLY_SCHEDULE_INGESTION_ALERT",
      entityId: alert.id,
      detail: `Alerta de ausência ${alert.kind} da semana de ${alert.weekStart} resolvido: evidência recebida posteriormente.`,
    });
  }
  return outcome;
}

async function absenceEvidenceExists(store: AbsenceAlertStore, alert: OpenAbsenceAlert): Promise<boolean> {
  switch (alert.kind) {
    case "MISSING_WEEKLY_SCHEDULE":
      return store.hasReceivedScheduleForWeek(alert.projectId, alert.weekStart);
    case "MISSING_S_CURVE":
      return store.hasSCurveForWeek(alert.projectId, alert.weekStart);
    case "MISSING_WEEKLY_REPORT_WORKBOOK":
      return store.hasWorkbookForWeek ? store.hasWorkbookForWeek(alert.projectId, alert.weekStart) : false;
    default:
      return false;
  }
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
