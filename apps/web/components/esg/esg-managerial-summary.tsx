"use client";

import { useMemo, useState } from "react";

import { SeverityBadge } from "@/components/shared/badges";
import { Select } from "@/components/ui/select";
import {
  confrontationSeverityToAlertSeverity,
  esgObligationCategoryLabels,
  esgObligationStatusLabels,
  formatDate,
  type EsgObligationCategory,
  type EsgObligationStatus,
  type EsgRiskLevel,
} from "@/lib/labels";

export interface EsgManagerialRow {
  obligationId: string;
  title: string;
  category: EsgObligationCategory;
  responsibleLabel: string | null;
  latestStatus: EsgObligationStatus | null;
  latestRisk: EsgRiskLevel | null;
  latestReferenceDate: string | null;
}

const STATUS_OPTIONS = Object.keys(esgObligationStatusLabels) as EsgObligationStatus[];
const CATEGORY_OPTIONS = Object.keys(esgObligationCategoryLabels) as EsgObligationCategory[];
const RISK_OPTIONS: EsgRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function EsgManagerialSummary({ rows }: { rows: EsgManagerialRow[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [riskFilter, setRiskFilter] = useState<string>("");
  const [responsibleFilter, setResponsibleFilter] = useState<string>("");
  const [periodFrom, setPeriodFrom] = useState<string>("");
  const [periodTo, setPeriodTo] = useState<string>("");

  const responsibleOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.responsibleLabel).filter((v): v is string => Boolean(v)))),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (statusFilter && r.latestStatus !== statusFilter) return false;
        if (categoryFilter && r.category !== categoryFilter) return false;
        if (riskFilter && r.latestRisk !== riskFilter) return false;
        if (responsibleFilter && r.responsibleLabel !== responsibleFilter) return false;
        if (periodFrom && (!r.latestReferenceDate || r.latestReferenceDate < periodFrom)) return false;
        if (periodTo && (!r.latestReferenceDate || r.latestReferenceDate > periodTo)) return false;
        return true;
      }),
    [rows, statusFilter, categoryFilter, riskFilter, responsibleFilter, periodFrom, periodTo]
  );

  const counts = useMemo(() => {
    const base: Record<EsgObligationStatus | "SEM_COMPROVACAO", number> = {
      CUMPRIDO: 0,
      CUMPRIDO_PARCIALMENTE: 0,
      PENDENTE: 0,
      NAO_CUMPRIDO: 0,
      NAO_APLICAVEL: 0,
      DISPENSADO: 0,
      SEM_COMPROVACAO: 0,
    };
    let riskAlto = 0;
    let riskCritico = 0;
    for (const row of filtered) {
      if (row.latestStatus) base[row.latestStatus] += 1;
      else base.SEM_COMPROVACAO += 1;
      if (row.latestRisk === "HIGH") riskAlto += 1;
      if (row.latestRisk === "CRITICAL") riskCritico += 1;
    }
    return { base, riskAlto, riskCritico };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{filtered.length}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{counts.base.CUMPRIDO}</p>
          <p className="text-xs text-muted-foreground">Cumpridas</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{counts.base.CUMPRIDO_PARCIALMENTE}</p>
          <p className="text-xs text-muted-foreground">Parciais</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{counts.base.PENDENTE + counts.base.SEM_COMPROVACAO}</p>
          <p className="text-xs text-muted-foreground">Pendentes</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">{counts.base.NAO_CUMPRIDO}</p>
          <p className="text-xs text-muted-foreground">Não cumpridas</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-lg font-semibold">
            {counts.riskAlto} / {counts.riskCritico}
          </p>
          <p className="text-xs text-muted-foreground">Risco alto / crítico</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {esgObligationStatusLabels[s]}
            </option>
          ))}
        </Select>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Todas as categorias</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {esgObligationCategoryLabels[c]}
            </option>
          ))}
        </Select>
        <Select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
          <option value="">Todos os riscos</option>
          {RISK_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Select value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          {responsibleOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <input
          type="date"
          value={periodFrom}
          onChange={(e) => setPeriodFrom(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <input
          type="date"
          value={periodTo}
          onChange={(e) => setPeriodTo(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Obrigação</th>
              <th className="p-2">Categoria</th>
              <th className="p-2">Responsável</th>
              <th className="p-2">Último registro</th>
              <th className="p-2">Status</th>
              <th className="p-2">Risco</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.obligationId} className="border-t">
                <td className="p-2">{row.title}</td>
                <td className="p-2">{esgObligationCategoryLabels[row.category]}</td>
                <td className="p-2">{row.responsibleLabel ?? "—"}</td>
                <td className="p-2">{row.latestReferenceDate ? formatDate(row.latestReferenceDate) : "—"}</td>
                <td className="p-2">{row.latestStatus ? esgObligationStatusLabels[row.latestStatus] : "Sem comprovação"}</td>
                <td className="p-2">
                  {row.latestRisk ? <SeverityBadge severity={confrontationSeverityToAlertSeverity[row.latestRisk]} /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
