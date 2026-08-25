import type { MembershipArea, MembershipStatus, ProjectMembership, ProjectPermission, User, UserOrigin } from "@axion/types";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  origin: UserOrigin;
  title: string | null;
  avatar_initials: string | null;
};

export type MembershipWithProfileRow = {
  project_id: string;
  user_id: string;
  permission: ProjectPermission;
  status: MembershipStatus;
  area: MembershipArea | null;
  profiles: UserRow | UserRow[] | null;
};

function deriveAvatarInitials(name: string): string {
  const parts = name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  return `${first}${last}`.toUpperCase();
}

export function mapUserRow(row: UserRow): User {
  const avatarInitials =
    row.avatar_initials && row.avatar_initials.trim() !== ""
      ? row.avatar_initials
      : deriveAvatarInitials(row.name);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    origin: row.origin,
    title: row.title,
    avatarInitials,
  };
}

// FK to-one (project_memberships.user_id -> profiles.id) deveria devolver
// objeto único via PostgREST, mas normalizamos defensivamente em vez de
// assumir o shape sem confirmação em execução real. user_id é FK NOT NULL
// para profiles.id e a RLS de profiles permite ver project peers, então
// uma membership sem profile resolvido é inconsistência estrutural, não
// caso esperado — nunca deve ser silenciada.
function resolveEmbeddedProfile(
  profile: UserRow | UserRow[] | null,
  context: { projectId: string; userId: string }
): UserRow {
  if (profile === null) {
    throw new Error(
      `Inconsistência estrutural: membership (project_id=${context.projectId}, user_id=${context.userId}) sem profile correspondente, apesar da FK NOT NULL.`
    );
  }

  if (Array.isArray(profile)) {
    if (profile.length === 0) {
      throw new Error(
        `Inconsistência estrutural: membership (project_id=${context.projectId}, user_id=${context.userId}) retornou array de profiles vazio.`
      );
    }
    if (profile.length > 1) {
      throw new Error(
        `Inconsistência estrutural: membership (project_id=${context.projectId}, user_id=${context.userId}) retornou ${profile.length} profiles; esperado exatamente 1.`
      );
    }
    return profile[0];
  }

  return profile;
}

export function mapMembershipRow(
  row: MembershipWithProfileRow
): ProjectMembership & { user: User } {
  const profile = resolveEmbeddedProfile(row.profiles, {
    projectId: row.project_id,
    userId: row.user_id,
  });

  return {
    userId: row.user_id,
    projectId: row.project_id,
    permission: row.permission,
    status: row.status,
    area: row.area,
    user: mapUserRow(profile),
  };
}
