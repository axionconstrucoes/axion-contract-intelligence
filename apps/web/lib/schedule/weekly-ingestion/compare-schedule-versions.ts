// Comparação estruturada entre duas versões extraídas do cronograma
// (MPXJ → schedule_activities / schedule_task_relations) — PURA, sem
// I/O. Produz só FATOS mensuráveis (deltas, contagens, listas); a
// classificação de risco é etapa separada (classify-schedule-risk.ts)
// e depende dos limites configurados por projeto.
//
// Reaproveita os mesmos tipos que o Diretor de Planejamento já usa
// (ContextScheduleActivity/ContextScheduleRelation) — nenhuma segunda
// leitura/estrutura de cronograma foi criada.
//
// Casamento de atividades entre versões: unique_id do MS Project
// (estável entre salvamentos) → external_task_id → (wbs + nome) como
// último recurso. Atividades-resumo (summary) são ignoradas nas
// contagens (só as folhas representam trabalho real).

import type { ContextScheduleActivity, ContextScheduleRelation } from "../../ai/context/types";

export interface ScheduleSnapshot {
  scheduleVersionId: string;
  /** Data de status do MPP (ISO) — referência para "vencida"; null => usa `asOf`. */
  statusDate: string | null;
  activities: ContextScheduleActivity[];
  relations: ContextScheduleRelation[];
}

export interface ScheduleComparisonOptions {
  /** Instante de referência (ISO) quando a versão não traz status_date. */
  asOf: string;
  /** Marcos contratuais identificados por unique_id (config do projeto); vazio => todos os marcos do MPP. */
  contractMilestoneUniqueIds?: string[];
}

export interface ActivityDelta {
  key: string;
  name: string;
  before: string | number | null;
  after: string | number | null;
  deltaDays?: number;
  deltaPercent?: number;
}

export interface ScheduleComparisonMetrics {
  comparedAt: string;
  currentScheduleVersionId: string;
  referenceScheduleVersionId: string;
  matching: { matched: number; addedCount: number; removedCount: number; added: string[]; removed: string[] };
  finalDate: { current: string | null; reference: string | null; slipDays: number | null };
  milestones: { evaluated: number; slippedCount: number; maxSlipDays: number | null; slipped: ActivityDelta[] };
  criticalPath: {
    currentCount: number;
    referenceCount: number;
    enteredCount: number;
    leftCount: number;
    entered: string[];
    left: string[];
  };
  totalFloat: { currentMinDays: number | null; referenceMinDays: number | null; deltaDays: number | null };
  overdue: { currentCount: number; referenceCount: number; deltaCount: number; current: string[] };
  durations: { changedCount: number; maxChangePercent: number | null; changed: ActivityDelta[] };
  relations: { addedCount: number; removedCount: number; changedCount: number };
  progress: { currentPercent: number | null; referencePercent: number | null; deltaPercent: number | null };
  delay: {
    /** planned_end final - baseline_end final (dias) em cada versão; positivo = atraso. */
    currentDelayDays: number | null;
    referenceDelayDays: number | null;
    /** currentDelay - referenceDelay: > 0 agravamento, < 0 recuperação. */
    trendDays: number | null;
    trend: "RECOVERY" | "AGGRAVATION" | "STABLE" | "UNKNOWN";
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value.length === 10 ? `${value}T00:00:00Z` : value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function diffDays(after: string | null | undefined, before: string | null | undefined): number | null {
  const a = dateMs(after);
  const b = dateMs(before);
  if (a === null || b === null) return null;
  return Math.round((a - b) / DAY_MS);
}

/** Normaliza duração/folga para DIAS (unidades MPXJ mais comuns; desconhecida => null, nunca inventada). */
export function toDays(value: number | string | null | undefined, unit: string | null | undefined): number | null {
  const amount = toNumber(value);
  if (amount === null) return null;
  const normalized = (unit ?? "d").trim().toLowerCase();
  switch (normalized) {
    case "d":
    case "day":
    case "days":
    case "ed":
    case "edays":
      return amount;
    case "h":
    case "hr":
    case "hrs":
    case "hour":
    case "hours":
    case "eh":
      return amount / 8;
    case "m":
    case "min":
    case "mins":
    case "minute":
    case "minutes":
    case "em":
      return amount / 480;
    case "w":
    case "wk":
    case "wks":
    case "week":
    case "weeks":
    case "ew":
      return amount * 5;
    case "mo":
    case "mon":
    case "month":
    case "months":
    case "emo":
      return amount * 20;
    default:
      return null;
  }
}

export function activityKey(activity: ContextScheduleActivity): string {
  if (activity.uniqueId) return `uid:${activity.uniqueId}`;
  if (activity.externalTaskId) return `ext:${activity.externalTaskId}`;
  return `wbs:${activity.wbs ?? ""}|${activity.name.trim().toLowerCase()}`;
}

function isLeaf(activity: ContextScheduleActivity): boolean {
  return activity.isSummaryTask !== true;
}

function maxDate(values: Array<string | null>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const ms = dateMs(value);
    if (ms !== null && ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

function overallProgress(activities: ContextScheduleActivity[]): number | null {
  let weighted = 0;
  let weight = 0;
  let simpleSum = 0;
  let simpleCount = 0;
  for (const activity of activities) {
    if (!isLeaf(activity)) continue;
    const percent = toNumber(activity.percentComplete);
    if (percent === null) continue;
    simpleSum += percent;
    simpleCount += 1;
    const days = toDays(activity.durationValue, activity.durationUnit);
    if (days !== null && days > 0) {
      weighted += percent * days;
      weight += days;
    }
  }
  if (weight > 0) return Math.round((weighted / weight) * 100) / 100;
  if (simpleCount > 0) return Math.round((simpleSum / simpleCount) * 100) / 100;
  return null;
}

function overdueKeys(snapshot: ScheduleSnapshot, asOf: string): string[] {
  const reference = dateMs(snapshot.statusDate) ?? dateMs(asOf);
  if (reference === null) return [];
  return snapshot.activities
    .filter((activity) => {
      if (!isLeaf(activity)) return false;
      const end = dateMs(activity.plannedEnd);
      const percent = toNumber(activity.percentComplete);
      const complete = percent !== null ? percent >= 100 : activity.status === "CONCLUIDA";
      return end !== null && end < reference && !complete;
    })
    .map(activityKey);
}

function minFloatDays(activities: ContextScheduleActivity[]): number | null {
  let min: number | null = null;
  for (const activity of activities) {
    if (!isLeaf(activity)) continue;
    const days = toDays(activity.totalFloatValue, activity.totalFloatUnit);
    if (days === null) continue;
    if (min === null || days < min) min = days;
  }
  return min;
}

function relationKeys(snapshot: ScheduleSnapshot, keyByTaskId: Map<string, string>): Set<string> {
  const keys = new Set<string>();
  for (const relation of snapshot.relations) {
    const predecessor = keyByTaskId.get(relation.predecessorTaskId) ?? `uid:${relation.predecessorUniqueId ?? relation.predecessorTaskId}`;
    const successor = keyByTaskId.get(relation.successorTaskId) ?? `uid:${relation.successorUniqueId ?? relation.successorTaskId}`;
    const lag = toNumber(relation.lagValue) ?? 0;
    keys.add(`${predecessor}->${successor}|${relation.relationType}|${lag}${relation.lagUnit ?? ""}`);
  }
  return keys;
}

function delayDays(activities: ContextScheduleActivity[]): number | null {
  const plannedFinal = maxDate(activities.map((activity) => activity.plannedEnd));
  const baselineFinal = maxDate(activities.map((activity) => activity.baselineEnd));
  return diffDays(plannedFinal, baselineFinal);
}

export function compareScheduleSnapshots(
  current: ScheduleSnapshot,
  reference: ScheduleSnapshot,
  options: ScheduleComparisonOptions
): ScheduleComparisonMetrics {
  const currentByKey = new Map(current.activities.map((activity) => [activityKey(activity), activity]));
  const referenceByKey = new Map(reference.activities.map((activity) => [activityKey(activity), activity]));

  const added: string[] = [];
  const removed: string[] = [];
  let matched = 0;
  for (const [key, activity] of currentByKey) {
    if (!isLeaf(activity)) continue;
    if (referenceByKey.has(key)) matched += 1;
    else added.push(activity.name);
  }
  for (const [key, activity] of referenceByKey) {
    if (!isLeaf(activity)) continue;
    if (!currentByKey.has(key)) removed.push(activity.name);
  }

  const currentFinal = maxDate(current.activities.map((activity) => activity.plannedEnd));
  const referenceFinal = maxDate(reference.activities.map((activity) => activity.plannedEnd));

  const contractMilestones = new Set(options.contractMilestoneUniqueIds ?? []);
  const slipped: ActivityDelta[] = [];
  let evaluatedMilestones = 0;
  let maxSlip: number | null = null;
  for (const [key, activity] of currentByKey) {
    if (activity.isMilestone !== true) continue;
    if (contractMilestones.size > 0 && !(activity.uniqueId && contractMilestones.has(activity.uniqueId))) continue;
    const before = referenceByKey.get(key);
    if (!before) continue;
    evaluatedMilestones += 1;
    const delta = diffDays(activity.plannedEnd, before.plannedEnd);
    if (delta === null) continue;
    if (maxSlip === null || delta > maxSlip) maxSlip = delta;
    if (delta > 0) {
      slipped.push({ key, name: activity.name, before: before.plannedEnd, after: activity.plannedEnd, deltaDays: delta });
    }
  }
  slipped.sort((a, b) => (b.deltaDays ?? 0) - (a.deltaDays ?? 0));

  const currentCritical = new Set(
    current.activities.filter((activity) => activity.isCritical === true && isLeaf(activity)).map(activityKey)
  );
  const referenceCritical = new Set(
    reference.activities.filter((activity) => activity.isCritical === true && isLeaf(activity)).map(activityKey)
  );
  const entered = [...currentCritical].filter((key) => !referenceCritical.has(key)).map((key) => currentByKey.get(key)?.name ?? key);
  const left = [...referenceCritical].filter((key) => !currentCritical.has(key)).map((key) => referenceByKey.get(key)?.name ?? key);

  const currentMinFloat = minFloatDays(current.activities);
  const referenceMinFloat = minFloatDays(reference.activities);

  const currentOverdue = overdueKeys(current, options.asOf);
  const referenceOverdue = overdueKeys(reference, options.asOf);

  const changedDurations: ActivityDelta[] = [];
  let maxChangePercent: number | null = null;
  for (const [key, activity] of currentByKey) {
    if (!isLeaf(activity)) continue;
    const before = referenceByKey.get(key);
    if (!before) continue;
    const afterDays = toDays(activity.durationValue, activity.durationUnit);
    const beforeDays = toDays(before.durationValue, before.durationUnit);
    if (afterDays === null || beforeDays === null || afterDays === beforeDays) continue;
    const percent = beforeDays > 0 ? Math.round(((afterDays - beforeDays) / beforeDays) * 10000) / 100 : null;
    if (percent !== null && (maxChangePercent === null || Math.abs(percent) > Math.abs(maxChangePercent))) {
      maxChangePercent = percent;
    }
    changedDurations.push({ key, name: activity.name, before: beforeDays, after: afterDays, deltaPercent: percent ?? undefined });
  }
  changedDurations.sort((a, b) => Math.abs(b.deltaPercent ?? 0) - Math.abs(a.deltaPercent ?? 0));

  const currentKeyByTaskId = new Map(current.activities.map((activity) => [activity.id, activityKey(activity)]));
  const referenceKeyByTaskId = new Map(reference.activities.map((activity) => [activity.id, activityKey(activity)]));
  const currentRelations = relationKeys(current, currentKeyByTaskId);
  const referenceRelations = relationKeys(reference, referenceKeyByTaskId);
  const relationsAdded = [...currentRelations].filter((key) => !referenceRelations.has(key)).length;
  const relationsRemoved = [...referenceRelations].filter((key) => !currentRelations.has(key)).length;

  const currentProgress = overallProgress(current.activities);
  const referenceProgress = overallProgress(reference.activities);

  const currentDelay = delayDays(current.activities);
  const referenceDelay = delayDays(reference.activities);
  const trendDays = currentDelay !== null && referenceDelay !== null ? currentDelay - referenceDelay : null;

  return {
    comparedAt: options.asOf,
    currentScheduleVersionId: current.scheduleVersionId,
    referenceScheduleVersionId: reference.scheduleVersionId,
    matching: { matched, addedCount: added.length, removedCount: removed.length, added: added.slice(0, 50), removed: removed.slice(0, 50) },
    finalDate: { current: currentFinal, reference: referenceFinal, slipDays: diffDays(currentFinal, referenceFinal) },
    milestones: { evaluated: evaluatedMilestones, slippedCount: slipped.length, maxSlipDays: maxSlip, slipped: slipped.slice(0, 50) },
    criticalPath: {
      currentCount: currentCritical.size,
      referenceCount: referenceCritical.size,
      enteredCount: entered.length,
      leftCount: left.length,
      entered: entered.slice(0, 50),
      left: left.slice(0, 50),
    },
    totalFloat: {
      currentMinDays: currentMinFloat,
      referenceMinDays: referenceMinFloat,
      deltaDays: currentMinFloat !== null && referenceMinFloat !== null ? currentMinFloat - referenceMinFloat : null,
    },
    overdue: {
      currentCount: currentOverdue.length,
      referenceCount: referenceOverdue.length,
      deltaCount: currentOverdue.length - referenceOverdue.length,
      current: currentOverdue.map((key) => currentByKey.get(key)?.name ?? key).slice(0, 50),
    },
    durations: { changedCount: changedDurations.length, maxChangePercent, changed: changedDurations.slice(0, 50) },
    relations: { addedCount: relationsAdded, removedCount: relationsRemoved, changedCount: relationsAdded + relationsRemoved },
    progress: {
      currentPercent: currentProgress,
      referencePercent: referenceProgress,
      deltaPercent:
        currentProgress !== null && referenceProgress !== null ? Math.round((currentProgress - referenceProgress) * 100) / 100 : null,
    },
    delay: {
      currentDelayDays: currentDelay,
      referenceDelayDays: referenceDelay,
      trendDays,
      trend: trendDays === null ? "UNKNOWN" : trendDays > 0 ? "AGGRAVATION" : trendDays < 0 ? "RECOVERY" : "STABLE",
    },
  };
}
