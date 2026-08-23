// Card PRAZO (seção 12). "Prazo final vigente"/"Alteração"/"Prazo
// aprovado" são sempre NÃO DISPONÍVEL hoje (nenhum campo formaliza
// essas datas/dias) — nunca considerar "solicitado" (identificação
// técnica em contract_changes) como "aprovado" (regra explícita do
// requisito).

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureInfo } from "@/components/shared/feature-info";
import { formatDate } from "@/lib/labels";
import type { DeadlineSummary } from "@/lib/dashboard-visual/compute-deadline-summary";
import { SourceLine, ValuePlaceholder } from "./value-placeholder";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{children}</span>
    </div>
  );
}

export function DeadlineCard({ summary }: { summary: DeadlineSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Prazo
          <FeatureInfo helpId="dashboard-visual-deadline" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Data inicial">{summary.startDate ? formatDate(summary.startDate) : <ValuePlaceholder />}</Field>
          <Field label="Prazo final original">{summary.originalEndDate ? formatDate(summary.originalEndDate) : <ValuePlaceholder />}</Field>
          <Field label="Prazo final vigente">
            <ValuePlaceholder note="Nenhuma extensão de prazo com data vigente formalizada" />
          </Field>
          <Field label="Alteração">
            <ValuePlaceholder />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Prazo solicitado">
            {summary.requestedExtensionSourceCount > 0 ? (
              <>
                {summary.requestedExtensionDays} dia(s)
                <SourceLine text={`Alterações Contratuais identificadas (${summary.requestedExtensionSourceCount})`} />
              </>
            ) : (
              <ValuePlaceholder note="Nenhuma extensão tecnicamente identificada" />
            )}
          </Field>
          <Field label="Prazo aprovado">
            <ValuePlaceholder note="Aprovação formal de extensão ainda não modelada" />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
