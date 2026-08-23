"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { slaAreaLabels } from "@/lib/labels";
import type { SlaArea } from "@/lib/sla/types";
import { configureSlaAreaResponsiblesAction } from "@/app/[projectId]/acoes/actions";
import { initialConfigureSlaResponsiblesState } from "@/app/[projectId]/acoes/actions-state";

// ÁREA → RESPONSÁVEL DIRETO → 1º ESCALÃO → 2º ESCALÃO → DIRETORIA
// (seção 4). Cada nível é opcional — nem todo projeto/área terá os
// quatro definidos.
export function SlaAreaResponsiblesForm({
  projectId,
  area,
  responsibleDirectUserId,
  escalation1UserId,
  escalation2UserId,
  boardUserId,
  members,
}: {
  projectId: string;
  area: SlaArea;
  responsibleDirectUserId: string | null;
  escalation1UserId: string | null;
  escalation2UserId: string | null;
  boardUserId: string | null;
  members: Array<{ userId: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(
    configureSlaAreaResponsiblesAction,
    initialConfigureSlaResponsiblesState
  );

  return (
    <form action={formAction} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6 sm:items-end">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="area" value={area} />

      <p className="text-sm font-medium sm:col-span-1">{slaAreaLabels[area]}</p>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Responsável direto
        <Select name="responsibleDirectUserId" defaultValue={responsibleDirectUserId ?? ""}>
          <option value="">Não definido</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        1º Escalão
        <Select name="escalation1UserId" defaultValue={escalation1UserId ?? ""}>
          <option value="">Não definido</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        2º Escalão
        <Select name="escalation2UserId" defaultValue={escalation2UserId ?? ""}>
          <option value="">Não definido</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Diretoria
        <Select name="boardUserId" defaultValue={boardUserId ?? ""}>
          <option value="">Não definido</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>

      <div className="sm:col-span-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      {state.error ? <p className="text-xs text-destructive sm:col-span-6">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600 sm:col-span-6">Salvo.</p> : null}
    </form>
  );
}
