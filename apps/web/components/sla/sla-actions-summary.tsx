"use client";

import { useMemo, useState } from "react";

import { SeverityBadge } from "@/components/shared/badges";
import { Select } from "@/components/ui/select";
import {
  confrontationSeverityToAlertSeverity,
  formatDateTime,
  slaActionOriginLabels,
  slaActionStatusLabels,
  slaAreaLabels,
  slaEscalationLevelLabels,
} from "@/lib/labels";
import { formatDurationBetween } from "@/lib/sla/format-duration";
import type { SlaAction, SlaActionStatus, SlaArea, SlaEscalationLevel, SlaRiskLevel } from "@/lib/sla/types";

const RISK_OPTIONS: SlaRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const RISK_CHECKBOX_LABELS: Record<SlaRiskLevel, string> = {
  LOW: "Baixo",
  MEDIUM: "Médio",
  HIGH: "Alto",
  CRITICAL: "Crítico",
};
const STATUS_OPTIONS: SlaActionStatus[] = ["PENDING", "IN_PROGRESS", "OVERDUE", "ESCALATED", "COMPLETED"];

function relevantDueAt(action: SlaAction): string | null {
  if (!action.acknowledgedAt) return action.assumeDueAt;
  if (!action.completedAt && action.completeDueAt) return action.completeDueAt;
  return null;
}

export function SlaActionsSummary({
  actions,
  areas,
  responsibleOptions,
}: {
  actions: SlaAction[];
  areas: SlaArea[];
  responsibleOptions: string[];
}) {
  const [riskFilter, setRiskFilter] = useState<Set<SlaRiskLevel>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<SlaActionStatus>>(new Set());
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [responsibleFilter, setResponsibleFilter] = useState<string>("");
  const [levelFilter, setLevelFilter] = useState<string>("");

  const now = useMemo(() => new Date().toISOString(), []);

  function toggleSet<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  const filtered = useMemo(
    () =>
      actions.filter((a) => {
        if (riskFilter.size > 0 && !riskFilter.has(a.riskLevel)) return false;
        if (statusFilter.size > 0 && !statusFilter.has(a.status)) return false;
        if (areaFilter && a.area !== areaFilter) return false;
        if (responsibleFilter && a.responsibleName !== responsibleFilter) return false;
        if (levelFilter && a.currentEscalationLevel !== levelFilter) return false;
        return true;
      }),
    [actions, riskFilter, statusFilter, areaFilter, responsibleFilter, levelFilter]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{filtered.length}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{filtered.filter((a) => a.status === "OVERDUE").length}</p>
          <p className="text-xs text-muted-foreground">Vencidas</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{filtered.filter((a) => a.status === "ESCALATED").length}</p>
          <p className="text-xs text-muted-foreground">Escaladas</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">
            {filtered.filter((a) => a.riskLevel === "HIGH" || a.riskLevel === "CRITICAL").length}
          </p>
          <p className="text-xs text-muted-foreground">Risco alto/crítico</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{filtered.filter((a) => a.status === "COMPLETED").length}</p>
          <p className="text-xs text-muted-foreground">Concluídas</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-muted-foreground">Risco</legend>
          {RISK_OPTIONS.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={riskFilter.has(r)} onChange={() => toggleSet(riskFilter, r, setRiskFilter)} />
              {RISK_CHECKBOX_LABELS[r]}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-muted-foreground">Status</legend>
          {STATUS_OPTIONS.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={statusFilter.has(s)}
                onChange={() => toggleSet(statusFilter, s, setStatusFilter)}
              />
              {slaActionStatusLabels[s]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Área</span>
          <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
            <option value="">Todas</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {slaAreaLabels[a]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Responsável</span>
          <Select value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)}>
            <option value="">Todos</option>
            {responsibleOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Escalão</span>
          <Select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
            <option value="">Todos</option>
            {(["RESPONSAVEL", "ESCALAO_1", "ESCALAO_2", "DIRETORIA"] as SlaEscalationLevel[]).map((l) => (
              <option key={l} value={l}>
                {slaEscalationLevelLabels[l]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Ação</th>
              <th className="p-2">Risco</th>
              <th className="p-2">Área</th>
              <th className="p-2">Responsável</th>
              <th className="p-2">Prazo</th>
              <th className="p-2">Status</th>
              <th className="p-2">Escalão</th>
              <th className="p-2">Tempo restante / vencido há</th>
              <th className="p-2">Origem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((action) => {
              const dueAt = relevantDueAt(action);
              const overdue = dueAt ? dueAt < now : false;
              return (
                <tr key={action.id} className="border-t">
                  <td className="p-2">{action.title}</td>
                  <td className="p-2">
                    <SeverityBadge severity={confrontationSeverityToAlertSeverity[action.riskLevel]} />
                  </td>
                  <td className="p-2">{slaAreaLabels[action.area]}</td>
                  <td className="p-2">{action.responsibleName ?? "—"}</td>
                  <td className="p-2">{dueAt ? formatDateTime(dueAt) : "—"}</td>
                  <td className="p-2">{slaActionStatusLabels[action.status]}</td>
                  <td className="p-2">{slaEscalationLevelLabels[action.currentEscalationLevel]}</td>
                  <td className="p-2">
                    {dueAt
                      ? overdue
                        ? `vencido há ${formatDurationBetween(dueAt, now)}`
                        : `restam ${formatDurationBetween(now, dueAt)}`
                      : "—"}
                  </td>
                  <td className="p-2">{slaActionOriginLabels[action.origin]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
