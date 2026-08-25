import type { Metadata } from "next";

import {
  createSupabaseServerClient,
} from "@axion/db/server";

import {
  PageHeader,
} from "@/components/layout/page-header";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  EmptyState,
} from "@/components/shared/empty-state";

import {
  MembershipStatusBadge,
  ProjectPermissionBadge,
} from "@/components/shared/badges";

import {
  getProjectMembers,
} from "@/lib/data";

import {
  corporateAreaLabels,
  formatDate,
  originLabels,
} from "@/lib/labels";

import {
  getCurrentProjectPermission,
  isProjectAdministrator,
} from "@/lib/contract-review";

import {
  AddMemberForm,
} from "./add-member-form";

import {
  MemberRowActions,
} from "./member-row-actions";

import {
  PolicyAcknowledgementCell,
  type PolicyAcknowledgementView,
} from "./policy-acknowledgement-cell";


export const metadata: Metadata = {
  title: "Usuários",
};


type PolicyAcknowledgementRow = {
  id: string;
  user_id: string;
  status: string;
  first_sent_at: string | null;
  last_sent_at: string | null;
  resend_available_at: string | null;
  reminder_count: number;
  approved_at: string | null;
};


export default async function UsuariosPage({
  params,
}: {
  params: Promise<{
    projectId: string;
  }>;
}) {
  const { projectId } = await params;

  const supabase =
    await createSupabaseServerClient();

  const [
    members,
    permission,
    { data: authData },
  ] = await Promise.all([
    getProjectMembers(projectId),
    getCurrentProjectPermission(projectId),
    supabase.auth.getUser(),
  ]);

  const isAdmin =
    isProjectAdministrator(permission);

  const currentUserId =
    authData.user?.id ?? null;


  // ----------------------------------------------------------
  // Versão corporativa vigente do Termo
  // ----------------------------------------------------------

  const {
    data: currentTerm,
    error: currentTermError,
  } = await supabase
    .from("corporate_policy_terms")
    .select("id,version")
    .eq("code", "RESOURCE_USE_POLICY")
    .eq("is_current", true)
    .maybeSingle();

  if (currentTermError) {
    console.error(
      "Falha ao carregar Termo vigente:",
      currentTermError.message
    );
  }


  // ----------------------------------------------------------
  // Situação do Termo para os membros visíveis
  // ----------------------------------------------------------

  const memberIds =
    members.map((member) => member.userId);

  let acknowledgementRows:
    PolicyAcknowledgementRow[] = [];

  if (
    currentTerm?.id &&
    memberIds.length > 0
  ) {
    const {
      data,
      error,
    } = await supabase
      .from("user_policy_acknowledgements")
      .select(
        "id,user_id,status,first_sent_at,last_sent_at,resend_available_at,reminder_count,approved_at"
      )
      .eq("term_id", currentTerm.id)
      .in("user_id", memberIds);

    if (error) {
      console.error(
        "Falha ao carregar situação dos Termos:",
        error.message
      );
    } else {
      acknowledgementRows =
        (data ?? []) as PolicyAcknowledgementRow[];
    }
  }


  const acknowledgementByUserId =
    new Map<
      string,
      PolicyAcknowledgementView
    >();

  for (const row of acknowledgementRows) {
    acknowledgementByUserId.set(
      row.user_id,
      {
        id: row.id,
        status: row.status,
        firstSentAt: row.first_sent_at,
        lastSentAt: row.last_sent_at,
        resendAvailableAt:
          row.resend_available_at,
        reminderCount:
          row.reminder_count,
        approvedAt: row.approved_at,
      }
    );
  }


  return (
    <div className="flex flex-col gap-4">

      <PageHeader
        title="Usuários & Permissões"
        description="Usuários internos Axion e terceiros com acesso a este projeto."
      />

      {isAdmin && (
        <AddMemberForm
          projectId={projectId}
        />
      )}

      {members.length === 0 ? (
        <EmptyState message="Nenhum usuário com acesso a este projeto." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                Usuário
              </TableHead>

              <TableHead>
                Origem
              </TableHead>

              <TableHead>
                Área
              </TableHead>

              <TableHead>
                Perfil
              </TableHead>

              <TableHead>
                Status
              </TableHead>

              <TableHead>
                Termo ACC/LGPD
              </TableHead>

              <TableHead>
                Incluído em
              </TableHead>

              {isAdmin && (
                <TableHead className="text-right">
                  Ações
                </TableHead>
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {members.map((member) => {
              const acknowledgement =
                acknowledgementByUserId.get(
                  member.userId
                ) ?? null;

              return (
                <TableRow key={member.userId}>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar>
                        {member.user.avatarInitials}
                      </Avatar>

                      <div>
                        <p className="font-medium">
                          {member.user.name}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {member.user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline">
                      {
                        originLabels[
                          member.user.origin
                        ]
                      }
                    </Badge>
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {member.area
                      ? corporateAreaLabels[
                          member.area
                        ]
                      : "—"}
                  </TableCell>

                  <TableCell>
                    <ProjectPermissionBadge
                      permission={
                        member.permission
                      }
                    />
                  </TableCell>

                  <TableCell>
                    <MembershipStatusBadge
                      status={member.status}
                    />
                  </TableCell>

                  <TableCell>
                    <PolicyAcknowledgementCell
                      projectId={projectId}
                      userId={member.userId}
                      acknowledgement={
                        acknowledgement
                      }
                      termVersion={
                        currentTerm?.version ??
                        null
                      }
                      isAdmin={isAdmin}
                      isSelf={
                        member.userId ===
                        currentUserId
                      }
                    />
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {formatDate(
                      member.createdAt
                    )}
                  </TableCell>

                  {isAdmin && (
                    <TableCell className="text-right">
                      {member.userId !==
                        currentUserId && (
                        <MemberRowActions
                          projectId={
                            projectId
                          }
                          member={member}
                        />
                      )}
                    </TableCell>
                  )}

                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

    </div>
  );
}