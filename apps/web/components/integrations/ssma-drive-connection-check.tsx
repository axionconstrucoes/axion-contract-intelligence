"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  initialValidateSsmaDriveState,
} from "@/app/[projectId]/integracoes/actions-state";
import {
  validateSsmaDriveSourceAction,
} from "@/app/[projectId]/integracoes/actions";
import { formatDateTime } from "@/lib/labels";

export function SsmaDriveConnectionCheck({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(
    validateSsmaDriveSourceAction,
    initialValidateSsmaDriveState
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background/60 p-2">
      <form action={formAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Validando…" : "Validar pasta SSMA/ESG"}
        </Button>
      </form>

      <p className="text-xs">
        Somente leitura: confirma as 12 subpastas e conta os itens, sem baixar, mover ou alterar arquivos.
      </p>

      {state.checkedAt ? (
        <p className="text-xs">Validação: {formatDateTime(state.checkedAt)}</p>
      ) : null}

      {state.success ? (
        <div className="flex flex-col gap-2 text-xs text-foreground">
          <p className="font-medium">
            Estrutura validada: 12/12 pastas · {state.totalFiles} arquivo(s) · {state.totalFolders} subpasta(s).
          </p>
          <details>
            <summary className="cursor-pointer font-medium">Ver contagem por pasta</summary>
            <ul className="mt-1 space-y-1 pl-4">
              {state.folders.map((folder) => (
                <li key={folder.name}>
                  {folder.name}: {folder.files} arquivo(s), {folder.folders} subpasta(s)
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </div>
  );
}
