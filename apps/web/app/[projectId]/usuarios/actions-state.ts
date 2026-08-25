// Tipos e estados iniciais dos Server Actions de Usuários & Permissões
// (./actions.ts) — mesmo padrão de app/[projectId]/integracoes/actions-state.ts.

export type AddProjectMemberState = {
  error: string | null;
  success: boolean;
  notOnboarded: boolean;
};
export const initialAddProjectMemberState: AddProjectMemberState = {
  error: null,
  success: false,
  notOnboarded: false,
};

export type UpdateProjectMemberRoleState = { error: string | null; success: boolean };
export const initialUpdateProjectMemberRoleState: UpdateProjectMemberRoleState = {
  error: null,
  success: false,
};

export type SetProjectMemberStatusState = { error: string | null; success: boolean };
export const initialSetProjectMemberStatusState: SetProjectMemberStatusState = {
  error: null,
  success: false,
};

export type RemoveProjectMemberState = { error: string | null; success: boolean };
export const initialRemoveProjectMemberState: RemoveProjectMemberState = {
  error: null,
  success: false,
};
