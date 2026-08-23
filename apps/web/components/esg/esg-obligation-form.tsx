"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  esgObligationCategoryLabels,
  esgObligationPeriodicityLabels,
  type EsgObligationCategory,
  type EsgObligationPeriodicity,
} from "@/lib/labels";
import { createEsgObligationAction } from "@/app/[projectId]/esg/actions";
import { initialCreateEsgObligationState } from "@/app/[projectId]/esg/actions-state";

const CATEGORY_OPTIONS = Object.keys(esgObligationCategoryLabels) as EsgObligationCategory[];
const PERIODICITY_OPTIONS = Object.keys(esgObligationPeriodicityLabels) as EsgObligationPeriodicity[];

export function EsgObligationForm({
  projectId,
  clauseOptions,
}: {
  projectId: string;
  clauseOptions: Array<{ id: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState(createEsgObligationAction, initialCreateEsgObligationState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-dashed p-4">
      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Título da obrigação
          <Input name="title" required placeholder="Ex.: DDS semanal" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Categoria
          <Select name="category" defaultValue="DDS" required>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {esgObligationCategoryLabels[c]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Periodicidade
          <Select name="periodicity" defaultValue="SEMANAL" required>
            {PERIODICITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {esgObligationPeriodicityLabels[p]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Cláusula/referência (opcional)
          <Select name="clauseId" defaultValue="">
            <option value="">Sem cláusula estruturada vinculada</option>
            {clauseOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Origem contratual (texto livre, quando não há cláusula estruturada)
        <Input name="sourceReference" placeholder="Ex.: Anexo SSMA do contrato, item 3.2" />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Descrição
        <Textarea name="description" rows={2} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Evidência exigida
          <Input name="requiredEvidenceDescription" placeholder="Ex.: Lista de presença + foto" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Penalidade prevista (quando conhecida)
          <Input name="penaltyDescription" placeholder="Ex.: Multa de R$ 5.000,00 por descumprimento" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Responsável (texto livre)
          <Input name="responsibleLabel" placeholder="Ex.: Técnico de Segurança do Trabalho" />
        </label>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Obrigação configurada.</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando…" : "Adicionar obrigação ao checklist"}
      </Button>
    </form>
  );
}
