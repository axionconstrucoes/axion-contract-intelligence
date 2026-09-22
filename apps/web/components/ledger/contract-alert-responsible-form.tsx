"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { configureContractAlertResponsibleAction } from "@/app/[projectId]/ledger/lote-alertas/responsible-actions";
import { initialConfigureContractAlertResponsibleState } from "@/app/[projectId]/ledger/lote-alertas/responsible-actions-state";

export type EligibleContractAlertResponsible = { userId: string; email: string; name: string };

// "Responsável pelos alertas contratuais" — a ÚNICA fonte de
// destinatário do lote semanal automático (BAIXO/MÉDIO). Só ADMINISTRADOR
// vê este formulário (checado de novo no servidor); membros sem essa
// permissão veem só o texto atual (ver page.tsx), nunca este <form>.
// Destinatário é sempre escolhido dentre membros ACTIVE do projeto —
// nunca digitado livremente, mesmo padrão de SendContractAlertForm.
export function ContractAlertResponsibleForm({
  projectId,
  eligibleUsers,
  currentResponsibleUserId,
}: {
  projectId: string;
  eligibleUsers: EligibleContractAlertResponsible[];
  currentResponsibleUserId: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    configureContractAlertResponsibleAction,
    initialConfigureContractAlertResponsibleState
  );

  const hasEligibleUsers = eligibleUsers.length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <input type="hidden" name="projectId" value={projectId} />

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Responsável pelos alertas contratuais
        {hasEligibleUsers ? (
          <div className="flex flex-wrap gap-2">
            <Select
              name="responsibleUserId"
              required
              defaultValue={currentResponsibleUserId ?? ""}
              className="max-w-xs"
            >
              <option value="" disabled>
                Selecione um usuário ativo do projeto
              </option>
              {eligibleUsers.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name} — {u.email}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={pending} size="sm">
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-destructive">Nenhum usuário ativo neste projeto para configurar.</p>
        )}
      </label>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">Salvo.</p> : null}
    </form>
  );
}
