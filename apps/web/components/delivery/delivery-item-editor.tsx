"use client";

import { useActionState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { changeDeliveryStatusAction, updateDeliveryItemAction } from "@/app/[projectId]/providencias/actions";
import { initialDeliveryActionState } from "@/app/[projectId]/providencias/actions-state";
import {
  DELIVERY_STATUS_LABELS,
  DEPENDENCY_LABELS,
  type DeliveryItem,
  type DeliveryStatus,
} from "@/lib/delivery/delivery-items";

export function DeliveryItemEditor({
  projectId,
  item,
  members,
  riskPanel,
}: {
  projectId: string;
  item: DeliveryItem;
  members: Array<{ userId: string; name: string }>;
  /** Painel de classificação de risco (critérios, sugestão, revisão com justificativa e histórico). */
  riskPanel?: ReactNode;
}) {
  const [fieldsState, fieldsAction, fieldsPending] = useActionState(
    updateDeliveryItemAction.bind(null, projectId, item.id),
    initialDeliveryActionState
  );
  const [statusState, statusAction, statusPending] = useActionState(
    changeDeliveryStatusAction.bind(null, projectId, item.id),
    initialDeliveryActionState
  );

  return (
    <details className="group rounded-md border bg-card text-sm">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-primary">Editar</summary>
      <div className="grid gap-4 border-t p-3 lg:grid-cols-2">
        <form action={fieldsAction} className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-foreground">Dados da providência</p>

          <label className="grid gap-1 text-xs">
            Data limite de finalização
            <Input type="date" name="deadline" defaultValue={item.deadline ?? ""} />
          </label>
          <label className="grid gap-1 text-xs">
            Prazo interno antecipado (opcional)
            <Input type="date" name="internal_deadline" defaultValue={item.internalDeadline ?? ""} />
          </label>
          <label className="grid gap-1 text-xs">
            Responsável interno (colaborador ativo da obra)
            <Select name="responsible_user_id" defaultValue={item.responsibleUserId ?? ""}>
              <option value="">A definir</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs">
              Depende de
              <Select name="dependency_kind" defaultValue={item.dependencyKind ?? ""}>
                <option value="">Ninguém externo</option>
                {Object.entries(DEPENDENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1 text-xs">
              Quem (nome da parte externa)
              <Input name="dependency_name" defaultValue={item.dependencyName ?? ""} />
            </label>
          </div>
          {item.checklistKey === "CNO" ? (
            <label className="grid gap-1 text-xs">
              Número do CNO
              <Input name="cno_number" defaultValue={item.cnoNumber ?? ""} />
            </label>
          ) : (
            <input type="hidden" name="cno_number" value={item.cnoNumber ?? ""} />
          )}
          <label className="grid gap-1 text-xs">
            Evidência / documento / protocolo
            <Input name="evidence" defaultValue={item.evidence ?? ""} />
            <span className="text-[11px] text-muted-foreground">Registrar a evidência não conclui a providência.</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="blocks_delivery" defaultChecked={item.blocksDelivery} /> Bloqueia a entrega
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="applicability_confirmed" defaultChecked={item.applicabilityConfirmed} /> Aplicabilidade e
            responsabilidade contratual confirmadas
          </label>

          {fieldsState.error ? <p className="text-xs text-destructive">{fieldsState.error}</p> : null}
          {fieldsState.success ? <p className="text-xs text-emerald-700">{fieldsState.success}</p> : null}
          <Button type="submit" size="sm" disabled={fieldsPending} className="self-start">
            {fieldsPending ? "Salvando…" : "Salvar dados"}
          </Button>
        </form>

        <form action={statusAction} className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-foreground">Situação</p>
          <label className="grid gap-1 text-xs">
            Nova situação
            <Select name="status" defaultValue="">
              <option value="" disabled>
                Selecione
              </option>
              {(Object.keys(DELIVERY_STATUS_LABELS) as DeliveryStatus[])
                .filter((s) => s !== item.status)
                .map((s) => (
                  <option key={s} value={s}>
                    {DELIVERY_STATUS_LABELS[s]}
                  </option>
                ))}
            </Select>
          </label>
          <label className="grid gap-1 text-xs">
            Justificativa (obrigatória para Não aplicável; vale como comprovação ao concluir)
            <Textarea name="justification" rows={2} />
          </label>
          <label className="grid gap-1 text-xs">
            Evidência / documento / protocolo (para concluir)
            <Input name="evidence" defaultValue={item.evidence ?? ""} />
          </label>
          <p className="text-[11px] text-muted-foreground">
            Concluir exige gestor, gerente ou administrador e evidência ou justificativa. Tudo fica no histórico.
          </p>
          {statusState.error ? <p className="text-xs text-destructive">{statusState.error}</p> : null}
          {statusState.success ? <p className="text-xs text-emerald-700">{statusState.success}</p> : null}
          <Button type="submit" size="sm" variant="outline" disabled={statusPending} className="self-start">
            {statusPending ? "Confirmando…" : "Confirmar situação"}
          </Button>
        </form>

        {riskPanel ? (
          <div className="border-t pt-3 lg:col-span-2">
            <p className="mb-2 text-xs font-semibold text-foreground">Grau de risco</p>
            {riskPanel}
          </div>
        ) : null}
      </div>
    </details>
  );
}
