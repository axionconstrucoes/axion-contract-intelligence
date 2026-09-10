import type { Metadata } from "next";
import { createSupabaseServerClient } from "@axion/db/server";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ManageMembersPanel } from "@/components/users/manage-members-panel";
import { MemberRowActions } from "@/components/users/member-row-actions";
import { SlaAreaResponsiblesForm } from "@/components/sla/sla-area-responsibles-form";
import { SlaMatrixConfigForm } from "@/components/sla/sla-matrix-config-form";
import { SlaProjectSettingsForm } from "@/components/sla/sla-project-settings-form";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getProject, getProjectMemberInvitations, getProjectMembers } from "@/lib/data";
import {
  memberInvitationStatusLabels,
  membershipAreaLabels,
  membershipStatusLabels,
  originLabels,
  permissionLabels,
  slaAreaLabels,
} from "@/lib/labels";
import { resolveBusinessHoursConfig, resolveGenericMatrixRule } from "@/lib/sla/resolve-matrix-rule";
import { formatInvitationSelection, formatMemberSelection } from "@/lib/sla/responsible-selection";
import { getSlaAreaResponsibles, getSlaMatrixRules, getSlaProjectSettings } from "@/lib/sla/sla-actions-data";
import type { SlaArea, SlaRiskLevel } from "@/lib/sla/types";

const RISK_LEVELS: SlaRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SLA_AREAS = Object.keys(slaAreaLabels) as SlaArea[];

export const metadata: Metadata = { title: "Usuários" };

export default async function UsuariosPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();

  const [members, invitations, permission, project, authData, matrixRules, areaResponsibles, projectSettings] = await Promise.all([
    getProjectMembers(projectId),
    getProjectMemberInvitations(projectId),
    getCurrentProjectPermission(projectId),
    getProject(projectId),
    supabase.auth.getUser(),
    getSlaMatrixRules(projectId),
    getSlaAreaResponsibles(projectId),
    getSlaProjectSettings(projectId),
  ]);

  // "ADMINISTRADOR ativo" — getCurrentProjectPermission já filtra por
  // status=ACTIVE na origem, então este valor só é ADMINISTRADOR quando
  // a própria membership do usuário logado está ativa.
  const canManage = permission === "ADMINISTRADOR";
  const currentUserId = authData.data.user?.id ?? null;
  const projectLabel = project ? `${project.code} — ${project.name}` : "";
  const pendingInvitations = invitations.filter((invitation) => invitation.status === "PENDING");
  const peopleOptions = [
    ...members
      .filter((member) => member.status === "ACTIVE")
      .map((member) => ({
        value: formatMemberSelection(member.userId),
        label: `${member.user.name} — ${member.area ? membershipAreaLabels[member.area] : "Sem área"} — ${member.user.email}`,
      })),
    ...pendingInvitations.map((invitation) => ({
      value: formatInvitationSelection(invitation.id),
      label: `${invitation.name} — ${invitation.area ? membershipAreaLabels[invitation.area] : "Sem área"} — ${invitation.email} — Aguardando primeiro login`,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const responsiblesByArea = new Map(areaResponsibles.map((responsible) => [responsible.area, responsible]));
  const businessHoursConfig = resolveBusinessHoursConfig(projectSettings);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Usuários & Permissões" description="Usuários internos Axion e terceiros com acesso a este projeto." />

      {canManage ? <ManageMembersPanel projectId={projectId} projectLabel={projectLabel} /> : null}

      {members.length === 0 && pendingInvitations.length === 0 ? (
        <EmptyState message="Nenhum usuário com acesso a este projeto." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Área</TableHead>
              <TableHead>Permissão</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar>{m.user.avatarInitials}</Avatar>
                    <div>
                      <p className="font-medium">{m.user.name}</p>
                      <p className="text-xs text-muted-foreground">{m.user.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{originLabels[m.user.origin]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{m.user.title ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {m.area ? membershipAreaLabels[m.area] : "—"}
                </TableCell>
                <TableCell>
                  <Badge>{permissionLabels[m.permission]}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={m.status === "ACTIVE" ? "default" : "outline"}>
                    {membershipStatusLabels[m.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <MemberRowActions
                      projectId={projectId}
                      userId={m.userId}
                      currentStatus={m.status}
                      currentPermission={m.permission}
                      currentJobTitle={m.user.title}
                      isSelf={m.userId === currentUserId}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}

            {pendingInvitations.map((invitation) => (
              <TableRow key={invitation.id} className="opacity-70">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar>—</Avatar>
                    <div>
                      <p className="font-medium">{invitation.name}</p>
                      <p className="text-xs text-muted-foreground">{invitation.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{originLabels.AXION_INTERNO}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{invitation.jobTitle ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {invitation.area ? membershipAreaLabels[invitation.area] : "—"}
                </TableCell>
                <TableCell>
                  <Badge>{permissionLabels[invitation.permission]}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{memberInvitationStatusLabels[invitation.status]}</Badge>
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canManage ? (
        <section id="matriz-responsabilidades" className="scroll-mt-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Matriz de responsabilidades e prazos</h2>
            <p className="text-sm text-muted-foreground">
              Configuração exclusiva deste projeto. O Nível 1 trata a ação, o Nível 2 recebe o primeiro escalonamento e o Nível 3 corresponde à Diretoria.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Riscos médios e baixos são reunidos em um único e-mail às quartas-feiras, às 7h. Riscos altos e críticos mantêm o alerta e o escalonamento imediato definidos na matriz.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Responsáveis por área
                <FeatureInfo helpId="sla-config-responsaveis" />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {SLA_AREAS.map((area) => {
                const current = responsiblesByArea.get(area);
                return (
                  <SlaAreaResponsiblesForm
                    key={area}
                    projectId={projectId}
                    area={area}
                    responsibleDirectUserId={current?.responsibleDirectUserId ?? null}
                    responsibleDirectInvitationId={current?.responsibleDirectInvitationId ?? null}
                    secondaryResponsibleUserId={current?.secondaryResponsibleUserId ?? null}
                    secondaryResponsibleInvitationId={current?.secondaryResponsibleInvitationId ?? null}
                    escalation1UserId={current?.escalation1UserId ?? null}
                    escalation1InvitationId={current?.escalation1InvitationId ?? null}
                    boardUserId={current?.boardUserId ?? null}
                    boardInvitationId={current?.boardInvitationId ?? null}
                    people={peopleOptions}
                  />
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Prazos por grau de risco
                <FeatureInfo helpId="sla-config-matriz-prazos" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="px-2 py-1.5 font-semibold text-muted-foreground">Risco</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Unidade</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Nível 1: assumir</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Responder</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Concluir</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Nível 2</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Nível 3</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Opções</th>
                      <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RISK_LEVELS.map((riskLevel) => (
                      <SlaMatrixConfigForm
                        key={riskLevel}
                        projectId={projectId}
                        riskLevel={riskLevel}
                        rule={resolveGenericMatrixRule(matrixRules, riskLevel)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <details className="rounded-md border">
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-sm font-medium">
              Fuso horário e horário útil
              <FeatureInfo helpId="sla-config-timezone" />
            </summary>
            <div className="border-t px-3 py-3">
              <SlaProjectSettingsForm
                projectId={projectId}
                timezone={businessHoursConfig.timeZone}
                businessDayStartHour={businessHoursConfig.businessDayStartHour}
                businessDayEndHour={businessHoursConfig.businessDayEndHour}
                isDefault={projectSettings === null}
              />
            </div>
          </details>
        </section>
      ) : null}
    </div>
  );
}
