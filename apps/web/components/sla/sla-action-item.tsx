"use client";

import { useActionState } from "react";

import { SeverityBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  confrontationSeverityToAlertSeverity,
  formatDateTime,
  slaActionOriginLabels,
  slaActionStatusLabels,
  slaAreaLabels,
  slaEscalationLevelLabels,
  slaEscalationReasonLabels,
} from "@/lib/labels";
import type { SlaAction, SlaActionEscalation } from "@/lib/sla/types";
import {
  assumeSlaActionAction,
  completeSlaActionAction,
  initialAssumeSlaActionState,
  initialCompleteSlaActionState,
  initialReassignSlaActionState,
  initialStartSlaActionState,
  reassignSlaActionAction,
  startSlaActionAction,
} from "@/app/[projectId]/acoes/actions";

export function SlaActionItem({
  projectId,
  action,
  escalations,
  isResponsible,
  canReassign,
  members,
}: {
  projectId: string;
  action: SlaAction;
  escalations: SlaActionEscalation[];
  isResponsible: boolean;
  canReassign: boolean;
  members: Array<{ userId: string; name: string }>;
}) {
  const [assumeState, assumeAction, assumePending] = useActionState(
    assumeSlaActionAction,
    initialAssumeSlaActionState
  );
  const [startState, startAction, startPending] = useActionState(startSlaActionAction, initialStartSlaActionState);
  const [completeState, completeFormAction, completePending] = useActionState(
    completeSlaActionAction,
    initialCompleteSlaActionState
  );
  const [reassignState, reassignFormAction, reassignPending] = useActionState(
    reassignSlaActionAction,
    initialReassignSlaActionState
  );

  return (
    <Card id={`acao-${action.id}`}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{action.title}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {slaAreaLabels[action.area]} · {slaActionOriginLabels[action.origin]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={confrontationSeverityToAlertSeverity[action.riskLevel]} />
            <Badge variant="outline">{slaActionStatusLabels[action.status]}</Badge>
            <Badge variant="outline">{slaEscalationLevelLabels[action.currentEscalationLevel]}</Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Responsável: {action.responsibleName ?? "não atribuído"}</span>
          <span>Prazo para assumir: {formatDateTime(action.assumeDueAt)}</span>
          {action.completeDueAt ? <span>Prazo para concluir: {formatDateTime(action.completeDueAt)}</span> : null}
          {action.contractualDeadline ? (
            <span>Prazo contratual: {formatDateTime(action.contractualDeadline)}</span>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {action.description ? <p className="text-sm">{action.description}</p> : null}

        {action.acknowledgedAt ? (
          <p className="text-xs text-muted-foreground">Assumida em {formatDateTime(action.acknowledgedAt)}</p>
        ) : null}

        {action.completedAt ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="text-xs text-muted-foreground">Concluída em {formatDateTime(action.completedAt)}</p>
            {action.completionNote ? <p className="mt-1">{action.completionNote}</p> : null}
          </div>
        ) : null}

        {escalations.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {escalations.map((esc) => (
              <li key={esc.id}>
                {formatDateTime(esc.escalatedAt)}: {slaEscalationLevelLabels[esc.fromLevel]} →{" "}
                {slaEscalationLevelLabels[esc.toLevel]} ({slaEscalationReasonLabels[esc.reason]})
              </li>
            ))}
          </ul>
        ) : null}

        {action.status !== "COMPLETED" && action.status !== "CANCELLED" ? (
          <div className="flex flex-wrap gap-2">
            {isResponsible && !action.acknowledgedAt ? (
              <form action={assumeAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="actionId" value={action.id} />
                <Button type="submit" size="sm" disabled={assumePending}>
                  {assumePending ? "Assumindo…" : "Assumir Ação"}
                </Button>
              </form>
            ) : null}

            {isResponsible && action.status === "ACKNOWLEDGED" ? (
              <form action={startAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="actionId" value={action.id} />
                <Button type="submit" size="sm" variant="outline" disabled={startPending}>
                  {startPending ? "Iniciando…" : "Iniciar"}
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}

        {assumeState.error ? <p className="text-xs text-destructive">{assumeState.error}</p> : null}
        {startState.error ? <p className="text-xs text-destructive">{startState.error}</p> : null}

        {isResponsible && action.status !== "COMPLETED" && action.status !== "CANCELLED" ? (
          <form action={completeFormAction} className="flex flex-col gap-2 rounded-md border border-dashed p-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="actionId" value={action.id} />
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Observação de conclusão {action.riskLevel === "HIGH" || action.riskLevel === "CRITICAL" ? "(recomendado detalhar evidência para risco alto/crítico)" : ""}
              <Textarea name="completionNote" rows={2} required placeholder="O que foi feito para concluir esta ação?" />
            </label>
            <Button type="submit" size="sm" disabled={completePending} className="self-start">
              {completePending ? "Concluindo…" : "Concluir Ação"}
            </Button>
            {completeState.error ? <p className="text-xs text-destructive">{completeState.error}</p> : null}
          </form>
        ) : null}

        {canReassign ? (
          <form action={reassignFormAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="actionId" value={action.id} />
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Reatribuir para
              <Select name="newResponsibleUserId" defaultValue="" className="max-w-[220px]">
                <option value="" disabled>
                  Selecione um responsável
                </option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={reassignPending}>
              {reassignPending ? "Reatribuindo…" : "Reatribuir"}
            </Button>
            {reassignState.error ? <p className="text-xs text-destructive">{reassignState.error}</p> : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
