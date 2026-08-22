"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  configureSlaProjectSettingsAction,
  initialConfigureSlaProjectSettingsState,
} from "@/app/[projectId]/acoes/actions";

// Correção de timezone: o cálculo de horário útil nunca usa UTC como
// horário comercial — ver apps/web/lib/sla/time-units.ts. Default
// institucional da AXION é America/Sao_Paulo, 08:00–18:00.
export function SlaProjectSettingsForm({
  projectId,
  timezone,
  businessDayStartHour,
  businessDayEndHour,
  isDefault,
}: {
  projectId: string;
  timezone: string;
  businessDayStartHour: number;
  businessDayEndHour: number;
  isDefault: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    configureSlaProjectSettingsAction,
    initialConfigureSlaProjectSettingsState
  );

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Timezone do projeto
          <Input name="timezone" defaultValue={timezone} required placeholder="America/Sao_Paulo" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Início do expediente
          <Input type="number" min="0" max="23" name="businessDayStartHour" defaultValue={businessDayStartHour} required />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Fim do expediente
          <Input type="number" min="0" max="23" name="businessDayEndHour" defaultValue={businessDayEndHour} required />
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Horário útil: {String(businessDayStartHour).padStart(2, "0")}:00–{String(businessDayEndHour).padStart(2, "0")}:00,
        segunda a sexta ({timezone}). {isDefault ? "Usando o default institucional — ainda não configurado por este projeto." : ""}
      </p>
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
        Feriados ainda não são considerados nesta versão.
      </p>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">Salvo.</p> : null}

      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
