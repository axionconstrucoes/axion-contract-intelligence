"use client";

import { useId, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { slaTimeUnitLabels } from "@/lib/labels";
import type { SlaRiskLevel, SlaTimeUnit } from "@/lib/sla/types";
import type { ResolvedSlaMatrixRule } from "@/lib/sla/resolve-matrix-rule";
import { configureSlaMatrixRuleAction } from "@/app/[projectId]/acoes/actions";
import { initialConfigureSlaMatrixState } from "@/app/[projectId]/acoes/actions-state";

const TIME_UNIT_OPTIONS = Object.keys(slaTimeUnitLabels) as SlaTimeUnit[];

// Portais não existem durante SSR. Gate "montou no navegador?" via
// useSyncExternalStore (nunca setState dentro de useEffect — o lint
// deste projeto proíbe, e com razão: setState síncrono em efeito causa
// uma renderização em cascata extra). getServerSnapshot (false) é
// usado tanto no servidor quanto na PRIMEIRA passada de hidratação do
// cliente — os dois batem, hidratação nunca diverge; getSnapshot
// (true) só entra depois, como uma atualização normal subsequente.
function subscribeNever() {
  return () => {};
}
function getMountedSnapshot() {
  return true;
}
function getServerSnapshot() {
  return false;
}
function useHasMounted(): boolean {
  return useSyncExternalStore(subscribeNever, getMountedSnapshot, getServerSnapshot);
}

const RISK_LABELS: Record<SlaRiskLevel, string> = {
  LOW: "Baixo",
  MEDIUM: "Médio",
  HIGH: "Alto",
  CRITICAL: "Crítico",
};

// As 4 linhas de risco (Baixo/Médio/Alto/Crítico) são <tr> de UMA tabela
// <table> real (semântica de verdade — cabeçalho <thead>/<th scope="col">
// definido uma vez em configuracao/page.tsx, uma linha por risco aqui),
// não mais um CSS Grid disfarçado de tabela.
//
// Um <form> nunca pode envolver <tr>/<td> validamente — a solução aqui é
// exatamente a segunda opção autorizada: cada linha usa um <form id="...">
// EXTERNO à tabela (portalado para document.body, invisível, só com os
// hidden inputs), e cada controle dentro da <tr> (select/input/button)
// referencia esse form pelo atributo HTML `form`, nunca aninhado nele.
// Cada risco continua salvando/auditando de forma totalmente
// independente (mesmo Server Action por linha, sem round-trip das
// outras 3 linhas).
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
  const reactId = useId();
  const formId = `sla-matrix-form-${riskLevel}-${reactId}`;

  const mounted = useHasMounted();

  const externalForm = mounted
    ? createPortal(
        <form id={formId} action={formAction} aria-hidden="true" className="hidden">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="riskLevel" value={riskLevel} />
        </form>,
        document.body
      )
    : null;

  return (
    <>
      {externalForm}
      <tr className="border-t">
        <th scope="row" className="px-2 py-1.5 text-left text-sm font-medium">
          {RISK_LABELS[riskLevel]}
          {rule.isDefault ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">(default)</span> : null}
        </th>

        <td className="px-1 py-1.5">
          <Select form={formId} name="timeUnit" defaultValue={rule.timeUnit} className="h-8 text-xs" aria-label={`Unidade de tempo — ${RISK_LABELS[riskLevel]}`}>
            {TIME_UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {slaTimeUnitLabels[u]}
              </option>
            ))}
          </Select>
        </td>

        <td className="px-1 py-1.5">
          <Input
            form={formId}
            type="number"
            step="0.5"
            min="0.5"
            name="assumeDeadlineValue"
            defaultValue={rule.assumeDeadlineValue}
            required
            aria-label={`Prazo para assumir — ${RISK_LABELS[riskLevel]}`}
            className="h-8 w-full px-1.5 text-xs"
          />
        </td>

        <td className="px-1 py-1.5">
          <Input
            form={formId}
            type="number"
            step="0.5"
            name="respondDeadlineValue"
            defaultValue={rule.respondDeadlineValue ?? ""}
            aria-label={`Prazo para responder — ${RISK_LABELS[riskLevel]}`}
            className="h-8 w-full px-1.5 text-xs"
          />
        </td>

        <td className="px-1 py-1.5">
          <Input
            form={formId}
            type="number"
            step="0.5"
            name="completeDeadlineValue"
            defaultValue={rule.completeDeadlineValue ?? ""}
            aria-label={`Prazo para concluir — ${RISK_LABELS[riskLevel]}`}
            className="h-8 w-full px-1.5 text-xs"
          />
        </td>

        <td className="px-1 py-1.5">
          <Input
            form={formId}
            type="number"
            step="0.5"
            min="0.5"
            name="escalation2AfterValue"
            defaultValue={rule.escalation2AfterValue}
            required
            aria-label={`Até 2º escalão — ${RISK_LABELS[riskLevel]}`}
            className="h-8 w-full px-1.5 text-xs"
          />
        </td>

        <td className="px-1 py-1.5">
          <Input
            form={formId}
            type="number"
            step="0.5"
            min="0.5"
            name="boardAfterValue"
            defaultValue={rule.boardAfterValue}
            required
            aria-label={`Até Diretoria — ${RISK_LABELS[riskLevel]}`}
            className="h-8 w-full px-1.5 text-xs"
          />
        </td>

        <td className="px-1 py-1.5">
          <div className="flex flex-col gap-0.5 text-[10px] leading-tight">
            <label className="flex items-center gap-1" title="Notificar por e-mail">
              <input form={formId} type="checkbox" name="notifyByEmail" defaultChecked={rule.notifyByEmail} />
              E-mail
            </label>
            <label className="flex items-center gap-1" title="Exige confirmação de recebimento">
              <input form={formId} type="checkbox" name="requiresAcknowledgmentConfirmation" defaultChecked={rule.requiresAcknowledgmentConfirmation} />
              Confirmação
            </label>
            <label className="flex items-center gap-1" title="Exige justificativa de atraso">
              <input form={formId} type="checkbox" name="requiresDelayJustification" defaultChecked={rule.requiresDelayJustification} />
              Justificativa
            </label>
          </div>
        </td>

        <td className="px-1 py-1.5">
          <div className="flex flex-col items-start gap-1">
            <div className="flex gap-1.5">
              <Button form={formId} type="submit" size="sm" disabled={pending}>
                {pending ? "Salvando…" : "Salvar"}
              </Button>
              {/* type="reset" nativo, mesmo form externo (atributo form
                  também define o dono do reset, não só do submit) —
                  descarta as edições e volta aos defaultValue/defaultChecked
                  (o que já está salvo), sem round-trip ao servidor. */}
              <Button form={formId} type="reset" size="sm" variant="outline" disabled={pending}>
                Cancelar
              </Button>
            </div>
            {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
            {state.success ? <span className="text-xs text-emerald-600">Salvo.</span> : null}
          </div>
        </td>
      </tr>
    </>
  );
}
