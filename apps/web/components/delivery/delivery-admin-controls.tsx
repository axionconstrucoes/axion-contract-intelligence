"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addDeliveryItemAction, seedDeliveryChecklistAction } from "@/app/[projectId]/providencias/actions";
import { initialDeliveryActionState } from "@/app/[projectId]/providencias/actions-state";

// Ações de configuração da tabela (gestor/gerente/administrador): cadastrar o checklist inicial
// configurável e acrescentar providências específicas da obra.
export function DeliveryAdminControls({ projectId, hasItems }: { projectId: string; hasItems: boolean }) {
  const [seedState, seedAction, seedPending] = useActionState(
    seedDeliveryChecklistAction.bind(null, projectId),
    initialDeliveryActionState
  );
  const [addState, addAction, addPending] = useActionState(addDeliveryItemAction.bind(null, projectId), initialDeliveryActionState);

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-lg border bg-card p-3">
      {!hasItems ? (
        <form action={seedAction} className="flex flex-col gap-1">
          <Button type="submit" size="sm" disabled={seedPending}>
            {seedPending ? "Cadastrando…" : "Cadastrar checklist inicial"}
          </Button>
          <p className="max-w-xs text-[11px] text-muted-foreground">
            Cria 14 providências sem datas, responsáveis nem comprovações. O checklist não comprova que cada item seja obrigação da construtora:
            confirme a aplicabilidade item a item.
          </p>
          {seedState.error ? <p className="text-xs text-destructive">{seedState.error}</p> : null}
          {seedState.success ? <p className="text-xs text-emerald-700">{seedState.success}</p> : null}
        </form>
      ) : null}

      <form action={addAction} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">
          Nova providência da obra
          <Input name="title" placeholder="Ex.: Licença ambiental de operação" className="w-72" />
        </label>
        <label className="grid gap-1 text-xs">
          Fase
          <Select name="phase" defaultValue="ENTREGA">
            <option value="INICIO">Início da obra</option>
            <option value="ENTREGA">Entrega</option>
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={addPending}>
          {addPending ? "Adicionando…" : "Adicionar"}
        </Button>
        <p className="w-full max-w-xl text-[11px] text-muted-foreground">
          A nova providência começa com grau MÉDIO provisório (nunca crítico por padrão). Depois de criar, use &ldquo;Classificação de risco&rdquo; na linha:
          a sugestão pelos critérios pede cláusula, prazo e a avaliação de iminência e de tempo para mitigação, e só a revisão com justificativa muda o grau.
        </p>
        {addState.error ? <p className="w-full text-xs text-destructive">{addState.error}</p> : null}
        {addState.success ? <p className="w-full text-xs text-emerald-700">{addState.success}</p> : null}
      </form>
    </div>
  );
}
