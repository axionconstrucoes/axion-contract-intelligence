export type SlaResponsibleSelection =
  | { kind: "member"; id: string }
  | { kind: "invitation"; id: string };

const MEMBER_PREFIX = "member:";
const INVITATION_PREFIX = "invitation:";

export function formatMemberSelection(userId: string): string {
  return `${MEMBER_PREFIX}${userId}`;
}

export function formatInvitationSelection(invitationId: string): string {
  return `${INVITATION_PREFIX}${invitationId}`;
}

export function parseSlaResponsibleSelection(value: string | null): SlaResponsibleSelection | null {
  if (!value) return null;

  if (value.startsWith(MEMBER_PREFIX) && value.length > MEMBER_PREFIX.length) {
    return { kind: "member", id: value.slice(MEMBER_PREFIX.length) };
  }

  if (value.startsWith(INVITATION_PREFIX) && value.length > INVITATION_PREFIX.length) {
    return { kind: "invitation", id: value.slice(INVITATION_PREFIX.length) };
  }

  throw new Error("Responsável selecionado inválido. Atualize a página e tente novamente.");
}
