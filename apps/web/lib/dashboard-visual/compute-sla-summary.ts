// Card AÇÕES E ESCALONAMENTOS (seção 13) — "pendentes" = status ainda
// não concluído/cancelado; "vencidas" = status OVERDUE OU algum prazo
// aplicável (assume/respond/complete, o que ainda não ocorreu) já
// passou; "vencem hoje" = o próximo prazo aplicável cai no dia de
// `today`; "escalonadas" = currentEscalationLevel acima do nível-base
// (RESPONSAVEL) OU status ESCALATED.
//
// Puro, sem I/O — `today` é sempre injetado pelo caller.

import type { SlaAction } from "@/lib/sla/types";

const OPEN_STATUSES = new Set(["PENDING", "ACKNOWLEDGED", "IN_PROGRESS", "OVERDUE", "ESCALATED"]);

function nextApplicableDueAt(action: SlaAction): string | null {
  if (!action.acknowledgedAt) return action.assumeDueAt;
  if (!action.completedAt && action.respondDueAt) return action.respondDueAt;
  if (!action.completedAt && action.completeDueAt) return action.completeDueAt;
  return null;
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export interface SlaActionsSummary {
  pending: number;
  overdue: number;
  dueToday: number;
  escalated: number;
}

export function computeSlaActionsSummary(actions: SlaAction[], today: Date): SlaActionsSummary {
  let pending = 0;
  let overdue = 0;
  let dueToday = 0;
  let escalated = 0;

  for (const action of actions) {
    if (OPEN_STATUSES.has(action.status)) pending += 1;
    if (action.status === "ESCALATED" || action.currentEscalationLevel !== "RESPONSAVEL") escalated += 1;

    if (action.status === "COMPLETED" || action.status === "CANCELLED") continue;

    if (action.status === "OVERDUE") {
      overdue += 1;
      continue;
    }

    const dueAt = nextApplicableDueAt(action);
    if (!dueAt) continue;
    const due = new Date(dueAt);
    if (due.getTime() < today.getTime()) overdue += 1;
    else if (isSameUtcDay(due, today)) dueToday += 1;
  }

  return { pending, overdue, dueToday, escalated };
}
