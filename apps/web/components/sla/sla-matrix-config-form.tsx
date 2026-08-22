"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { slaTimeUnitLabels } from "@/lib/labels";
import type { SlaRiskLevel, SlaTimeUnit } from "@/lib/sla/types";
import type { ResolvedSlaMatrixRule } from "@/lib/sla/resolve-matrix-rule";
import { configureSlaMatrixRuleAction, initialConfigureSlaMatrixState } from "@/app/[projectId]/acoes/actions";

const TIME_UNIT_OPTIONS = Object.keys(slaTimeUnitLabels) as SlaTimeUnit[];

const RISK_LABELS: Record<SlaRiskLevel, string> = {
  LOW: "Baixo",
  MEDIUM: "Médio",
  HIGH: "Alto",
  CRITICAL: "Crítico",
};

// Uma linha por risco — RISCO / PRAZO ASSUMIR / PRAZO RESPONDER / PRAZO
// CONCLUIR / 1º ESCALÃO (tempo) / 2º ESCALÃO (tempo) / DIRETORIA (tempo),
// exatamente a tabela pedida na seção 17. Quem ocupa cada escalão é
// configurado separadamente (SlaAreaResponsiblesForm) — aqui só os prazos.
export function SlaMatrixConfigForm({
  projectId,
  riskLevel,
  rule,
}: {
  projectId: string;
  riskLevel: SlaRiskLevel;
  rule: ResolvedSlaMatrixRule;
}) {
  const [state, formAction, pending] = useActionState(configureSlaMatrixRuleAction, initialConfigureSlaMatrixState);

  return (
    <form action={formAction} className="grid gap-2 rounded-md border p-3 sm:grid-cols-8 sm:items-end">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="riskLevel" value={riskLevel} />

      <div className="sm:col-span-1">
        <p className="text-sm font-medium">{RISK_LABELS[riskLevel]}</p>
        {rule.isDefault ? <p className="text-xs text-muted-foreground">(usando default)</p> : null}
      </div>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Unidade
        <Select name="timeUnit" defaultValue={rule.timeUnit}>
          {TIME_UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {slaTimeUnitLabels[u]}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Prazo assumir
        <Input type="number" step="0.5" min="0.5" name="assumeDeadlineValue" defaultValue={rule.assumeDeadlineValue} required />
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Prazo responder
        <Input type="number" step="0.5" name="respondDeadlineValue" defaultValue={rule.respondDeadlineValue ?? ""} />
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Prazo concluir
        <Input type="number" step="0.5" name="completeDeadlineValue" defaultValue={rule.completeDeadlineValue ?? ""} />
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Até 2º escalão
        <Input type="number" step="0.5" min="0.5" name="escalation2AfterValue" defaultValue={rule.escalation2AfterValue} required />
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Até Diretoria
        <Input type="number" step="0.5" min="0.5" name="boardAfterValue" defaultValue={rule.boardAfterValue} required />
      </label>

      <div className="flex flex-col gap-1 text-xs sm:col-span-8">
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="notifyByEmail" defaultChecked={rule.notifyByEmail} />
            Notificar por e-mail
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="requiresAcknowledgmentConfirmation" defaultChecked={rule.requiresAcknowledgmentConfirmation} />
            Exige confirmação de recebimento
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="requiresDelayJustification" defaultChecked={rule.requiresDelayJustification} />
            Exige justificativa de atraso
          </label>
        </div>
      </div>

      <div className="sm:col-span-8">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        {state.error ? <span className="ml-2 text-xs text-destructive">{state.error}</span> : null}
        {state.success ? <span className="ml-2 text-xs text-emerald-600">Salvo.</span> : null}
      </div>
    </form>
  );
}
