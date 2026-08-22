import Link from "next/link";

import { createSupabaseServerClient } from "@axion/db/server";

import { SlaActionForm } from "@/components/sla/sla-action-form";
import { SlaActionItem } from "@/components/sla/sla-action-item";
import { SlaActionsSummary } from "@/components/sla/sla-actions-summary";
import { SlaProcessEscalationsButton } from "@/components/sla/sla-process-escalations-button";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getProjectMembers } from "@/lib/data";
import {
  getSlaActionEscalationsForProject,
  getSlaActions,
} from "@/lib/sla/sla-actions-data";
import type { SlaArea } from "@/lib/sla/types";

export default async function SlaActionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const supabase = await createSupabaseServerClient();
  const [{ data: authData }, actions, escalations, members, permission] = await Promise.all([
    supabase.auth.getUser(),
    getSlaActions(projectId),
    getSlaActionEscalationsForProject(projectId),
    getProjectMembers(projectId),
    getCurrentProjectPermission(projectId),
  ]);

  const currentUserId = authData.user?.id ?? null;
  const canCreate = permission === "EDITOR" || permission === "ADMIN";
  const canConfigure = permission === "ADMIN";
  const isMember = permission !== null;

  const escalationsByActionId = new Map<string, typeof escalations>();
  for (const esc of escalations) {
    const list = escalationsByActionId.get(esc.actionId) ?? [];
    list.push(esc);
    escalationsByActionId.set(esc.actionId, list);
  }

  const memberOptions = members.map((m) => ({ userId: m.userId, name: m.user.name }));
  const areas = Array.from(new Set(actions.map((a) => a.area))) as SlaArea[];
  const responsibleOptions = Array.from(
    new Set(actions.map((a) => a.responsibleName).filter((v): v is string => Boolean(v)))
  );

  const openActions = actions.filter((a) => a.status !== "COMPLETED" && a.status !== "CANCELLED");
  const historyActions = actions.filter((a) => a.status === "COMPLETED" || a.status === "CANCELLED");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Ações e Escalonamentos</h1>
          <p className="text-sm text-muted-foreground">
            Matriz de criticidade, SLA interno e escalonamento automático — RESPONSÁVEL → 1º ESCALÃO → 2º ESCALÃO →
            DIRETORIA.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isMember ? <SlaProcessEscalationsButton projectId={projectId} /> : null}
          {canConfigure ? (
            <Link href={`/${projectId}/acoes/configuracao`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Matriz de SLA e Escalonamento
            </Link>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="abertas">
        <TabsList>
          <TabsTrigger value="abertas">Ações abertas</TabsTrigger>
          <TabsTrigger value="gerencial">Visão gerencial</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          {canCreate ? <TabsTrigger value="nova">Nova ação</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="abertas" className="flex flex-col gap-4">
          {openActions.length === 0 ? (
            <EmptyState message="Nenhuma ação aberta." />
          ) : (
            openActions.map((action) => (
              <SlaActionItem
                key={action.id}
                projectId={projectId}
                action={action}
                escalations={escalationsByActionId.get(action.id) ?? []}
                isResponsible={
                  canConfigure || (canCreate && action.responsibleUserId !== null && action.responsibleUserId === currentUserId)
                }
                canReassign={canConfigure}
                members={memberOptions}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="gerencial">
          <SlaActionsSummary actions={actions} areas={areas} responsibleOptions={responsibleOptions} />
        </TabsContent>

        <TabsContent value="historico" className="flex flex-col gap-4">
          {historyActions.length === 0 ? (
            <EmptyState message="Nenhuma ação concluída/cancelada ainda." />
          ) : (
            historyActions.map((action) => (
              <SlaActionItem
                key={action.id}
                projectId={projectId}
                action={action}
                escalations={escalationsByActionId.get(action.id) ?? []}
                isResponsible={false}
                canReassign={false}
                members={memberOptions}
              />
            ))
          )}
        </TabsContent>

        {canCreate ? (
          <TabsContent value="nova">
            <Card>
              <CardHeader>
                <CardTitle>Nova ação</CardTitle>
              </CardHeader>
              <CardContent>
                <SlaActionForm projectId={projectId} />
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
