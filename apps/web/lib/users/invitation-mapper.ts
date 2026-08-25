// Tipos e mapper de "Pré-cadastro de usuários" (project_member_invitations,
// migration 20260825120500 — ainda não aplicada). Puro, sem I/O —
// mesmo padrão de apps/web/lib/user-mapper.ts.

import type { MembershipArea, ProjectPermission } from "@axion/types";

export type MemberInvitationStatus = "PENDING" | "ACTIVATED" | "CANCELLED";

export interface ProjectMemberInvitation {
  id: string;
  projectId: string;
  email: string;
  name: string;
  jobTitle: string | null;
  area: MembershipArea | null;
  permission: ProjectPermission;
  status: MemberInvitationStatus;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  cancelledAt: string | null;
  profileId: string | null;
}

export type ProjectMemberInvitationRow = {
  id: string;
  project_id: string;
  email: string;
  name: string;
  job_title: string | null;
  area: MembershipArea | null;
  permission: ProjectPermission;
  status: MemberInvitationStatus;
  created_by: string;
  created_at: string;
  activated_at: string | null;
  cancelled_at: string | null;
  profile_id: string | null;
};

export function mapProjectMemberInvitationRow(row: ProjectMemberInvitationRow): ProjectMemberInvitation {
  return {
    id: row.id,
    projectId: row.project_id,
    email: row.email,
    name: row.name,
    jobTitle: row.job_title,
    area: row.area,
    permission: row.permission,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    cancelledAt: row.cancelled_at,
    profileId: row.profile_id,
  };
}
