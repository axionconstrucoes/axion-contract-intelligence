"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { configureStartupAction } from "@/app/[projectId]/startup/actions";
import { initialConfigureStartupState } from "@/app/[projectId]/startup/actions-state";
import type { ProjectStartupConfig } from "@/lib/startup/types";

/** Seção 1/4 — as duas datas nunca cortam Timeline/e-mails/documentos/contexto de IA (só classificam finding como histórico). */
export function StartupConfigForm({ projectId, config }: { projectId: string; config: ProjectStartupConfig }) {
  const [state, formAction, pending] = useActionState(configureStartupAction, initialConfigureStartupState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Data de início da obra
          <Input type="date" name="projectStartDate" defaultValue={config.projectStartDate ?? ""} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Data de início operacional ACC
          <Input type="date" name="accOperationalStartDate" defaultValue={config.accOperationalStartDate} />
        </label>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Configuração salva.</p> : null}
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
        {pending ? "Salvando…" : "Salvar datas"}
      </Button>
    </form>
  );
}
