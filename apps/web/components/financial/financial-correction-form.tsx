"use client";

// Correção humana de um valor da aba FINANCEIRO (período + coluna) —
// chama a Server Action que usa a RPC genérica
// validate_weekly_report_sheet_values: o valor ORIGINAL é preservado
// (evento de revisão + data.original), o usuário/data ficam registrados,
// as métricas são recalculadas pelo worker e o dado é sinalizado como
// corrigido. Justificativa obrigatória; só usuário autorizado.

import { useActionState } from "react";
import { correctFinancialValueAction } from "@/app/[projectId]/financeiro/actions";
import { initialEmailRegistryActionState } from "@/app/[projectId]/documentos/emails/actions-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function FinancialCorrectionForm({
  projectId,
  sheetId,
  periods,
  columns,
}: {
  projectId: string;
  sheetId: string;
  periods: string[];
  columns: Array<{ key: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState(correctFinancialValueAction, initialEmailRegistryActionState);
  return (
    <form action={formAction} className="grid gap-2 rounded-md border p-3 text-xs sm:grid-cols-5" aria-label="Corrigir valor financeiro extraído">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sheetId" value={sheetId} />
      <label className="flex flex-col gap-1">
        Período
        <Select name="period" required defaultValue="" aria-label="Período">
          <option value="" disabled>
            Selecione…
          </option>
          {periods.map((period) => (
            <option key={period} value={period}>
              {period}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        Coluna
        <Select name="column" required defaultValue="" aria-label="Coluna">
          <option value="" disabled>
            Selecione…
          </option>
          {columns.map((column) => (
            <option key={column.key} value={column.key}>
              {column.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        Valor correto (formato BR: 1.234,56 ou (1.234,56))
        <Input name="value" required placeholder="1.234,56" aria-label="Valor correto" />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        Justificativa (célula/aba consultada)
        <Input name="justification" required minLength={10} placeholder="Ex.: célula D14 da aba Financeiro lida em 12.500,00" />
      </label>
      <div className="flex items-center gap-2 sm:col-span-5">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Registrando…" : "Registrar correção"}
        </Button>
        {state.error ? <span className="text-destructive" role="alert">{state.error}</span> : null}
        {state.success ? <span className="text-emerald-700" role="status">{state.message}</span> : null}
      </div>
    </form>
  );
}
