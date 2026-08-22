"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { slaAreaLabels } from "@/lib/labels";
import type { SlaArea } from "@/lib/sla/types";
import { createSlaActionAction, initialCreateSlaActionState } from "@/app/[projectId]/acoes/actions";

const AREA_OPTIONS = Object.keys(slaAreaLabels) as SlaArea[];

export function SlaActionForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(createSlaActionAction, initialCreateSlaActionState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-dashed p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="origin" value="MANUAL" />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Título da ação
          <Input name="title" required placeholder="Ex.: Responder notificação do cliente" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Área responsável
          <Select name="area" defaultValue="ENGENHARIA" required>
            {AREA_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {slaAreaLabels[a]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Nível de risco
          <Select name="riskLevel" defaultValue="MEDIUM" required>
            <option value="LOW">Baixo</option>
            <option value="MEDIUM">Médio</option>
            <option value="HIGH">Alto</option>
            <option value="CRITICAL">Crítico</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Prazo contratual (opcional)
          <Input type="datetime-local" name="contractualDeadline" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Descrição
        <Textarea name="description" rows={2} />
      </label>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Ação criada e sujeita à matriz de SLA.</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Criando…" : "Criar ação"}
      </Button>
    </form>
  );
}
