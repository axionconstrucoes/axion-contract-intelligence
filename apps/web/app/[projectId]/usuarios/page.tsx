import type { Metadata } from "next";
import { createSupabaseServerClient } from "@axion/db/server";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ManageMembersPanel } from "@/components/users/manage-members-panel";
import { MemberRowActions } from "@/components/users/member-row-actions";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getProject, getProjectMemberInvitations, getProjectMembers } from "@/lib/data";
import {
  memberInvitationStatusLabels,
  membershipAreaLabels,
  membershipStatusLabels,
  originLabels,
  permissionLabels,
} from "@/lib/labels";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsuariosPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();

  const [members, invitations, permission, project, authData] = await Promise.all([
    getProjectMembers(projectId),
    getProjectMemberInvitations(projectId),
    getCurrentProjectPermission(projectId),
    getProject(projectId),
    supabase.auth.getUser(),
  ]);

  // "ADMINISTRADOR ativo" — getCurrentProjectPermission já filtra por
  // status=ACTIVE na origem, então este valor só é ADMINISTRADOR quando
  // a própria membership do usuário logado está ativa.
  const canManage = permission === "ADMINISTRADOR";
  const currentUserId = authData.data.user?.id ?? null;
  const projectLabel = project ? `${project.code} — ${project.name}` : "";
  const pendingInvitations = invitations.filter((invitation) => invitation.status === "PENDING");

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
    </div>
  );
}
