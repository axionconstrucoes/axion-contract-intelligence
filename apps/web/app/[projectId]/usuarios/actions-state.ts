// Tipos e estados iniciais dos Server Actions de Usuários & Permissões
// (./actions.ts) — deliberadamente fora do módulo "use server" (mesmo
// padrão de app/[projectId]/integracoes/actions-state.ts).

export interface FoundProfile {
  id: string;
  name: string;
  avatarInitials: string;
  alreadyMember: boolean;
}

export type SearchProfileState = {
  error: string | null;
  result: FoundProfile | null;
  searchedEmail: string | null;
  // true quando a busca foi válida (e-mail @axion.com.br completo) mas
  // nenhum profile existe ainda — sinal explícito para a UI oferecer o
  // pré-cadastro, sem depender de casar texto de mensagem de erro.
  notFound: boolean;
};
export const initialSearchProfileState: SearchProfileState = {
  error: null,
  result: null,
  searchedEmail: null,
  notFound: false,
};

export type AddProjectMemberState = { error: string | null; success: boolean };
export const initialAddProjectMemberState: AddProjectMemberState = { error: null, success: false };

export type SetMemberStatusState = { error: string | null; success: boolean };
export const initialSetMemberStatusState: SetMemberStatusState = { error: null, success: false };

export type UpdateMemberPermissionState = { error: string | null; success: boolean };
export const initialUpdateMemberPermissionState: UpdateMemberPermissionState = { error: null, success: false };

export type SetMemberJobTitleState = { error: string | null; success: boolean };
export const initialSetMemberJobTitleState: SetMemberJobTitleState = { error: null, success: false };

export type PreRegisterMemberState = { error: string | null; success: boolean };
export const initialPreRegisterMemberState: PreRegisterMemberState = { error: null, success: false };
