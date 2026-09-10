"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { slaAreaLabels } from "@/lib/labels";
import type { SlaArea } from "@/lib/sla/types";
import { configureSlaAreaResponsiblesAction } from "@/app/[projectId]/acoes/actions";
import { initialConfigureSlaResponsiblesState } from "@/app/[projectId]/acoes/actions-state";

// Matriz operacional de três níveis. O campo legado de 2º escalão não
// é exposto: Nível 1 = responsável direto, Nível 2 = gerência e
// Nível 3 = diretoria.
export function SlaAreaResponsiblesForm({
  projectId,
  area,
  responsibleDirectUserId,
  secondaryResponsibleUserId,
  escalation1UserId,
  boardUserId,
  members,
}: {
  projectId: string;
  area: SlaArea;
  responsibleDirectUserId: string | null;
  secondaryResponsibleUserId: string | null;
  escalation1UserId: string | null;
  boardUserId: string | null;
  members: Array<{ userId: string; name: string }>;
}) {
  const supportsSecondaryResponsible = area === "ENGENHARIA" || area === "PLANEJAMENTO";
  const fullRowClassName = supportsSecondaryResponsible ? "sm:col-span-6" : "sm:col-span-5";
  const [state, formAction, pending] = useActionState(
    configureSlaAreaResponsiblesAction,
    initialConfigureSlaResponsiblesState
  );

  return (
    <form
      action={formAction}
      className={`grid gap-2 rounded-md border p-3 sm:items-end ${
        supportsSecondaryResponsible ? "sm:grid-cols-6" : "sm:grid-cols-5"
      }`}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="area" value={area} />

      <p className="text-sm font-medium sm:col-span-1">{slaAreaLabels[area]}</p>

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Nível 1 · Responsável
        <Select name="responsibleDirectUserId" defaultValue={responsibleDirectUserId ?? ""}>
          <option value="">Não definido</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>

      {supportsSecondaryResponsible ? (
        <label className="flex flex-col gap-1 text-xs sm:col-span-1">
          Nível 1 · Corresponsável
          <Select name="secondaryResponsibleUserId" defaultValue={secondaryResponsibleUserId ?? ""}>
            <option value="">Não definido</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1 text-xs sm:col-span-1">
        Nível 2 · Gerência
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
        Nível 3 · Diretoria
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

      <p className={`text-xs text-muted-foreground ${fullRowClassName}`}>
        Se o Nível 2 não estiver definido, o alerta será escalonado diretamente para o Nível 3.
      </p>
      {state.error ? (
        <p className={`text-xs text-destructive ${fullRowClassName}`}>{state.error}</p>
      ) : null}
      {state.success ? (
        <p className={`text-xs text-emerald-600 ${fullRowClassName}`}>Salvo.</p>
      ) : null}
    </form>
  );
}
