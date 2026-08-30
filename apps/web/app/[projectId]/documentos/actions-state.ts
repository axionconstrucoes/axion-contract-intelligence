// Tipos e estados iniciais dos Server Actions de Documentos
// (./actions.ts) — deliberadamente fora do módulo "use server" (mesmo
// padrão de app/[projectId]/startup/actions-state.ts).

export type PromoteEmailAttachmentState = {
  error: string | null;
  success: boolean;
  documentVersionId: string | null;
};

export const initialPromoteEmailAttachmentState: PromoteEmailAttachmentState = {
  error: null,
  success: false,
  documentVersionId: null,
};

export type LinkContractualAttachmentState = {
  error: string | null;
  success: boolean;
  // true quando a RPC recusou por CONFLICT_STALE_PARENT — o pai atual
  // do documento (no banco) já não é o que a tela achava que era
  // quando o usuário começou a preencher o formulário. A UI deveria
  // orientar a recarregar a página, nunca reenviar o mesmo formulário
  // sem revalidar.
  conflict: boolean;
  // true quando a RPC recusou por CONFIRMATION_REQUIRED — já existe um
  // vínculo com outro pai e o servidor não recebeu (ou recusou)
  // p_confirm_parent_change = true. A confirmação real é sempre do
  // servidor, nunca só do checkbox React.
  confirmationRequired: boolean;
};

export const initialLinkContractualAttachmentState: LinkContractualAttachmentState = {
  error: null,
  success: false,
  conflict: false,
  confirmationRequired: false,
};

export type UnlinkContractualAttachmentState = {
  error: string | null;
  success: boolean;
};

export const initialUnlinkContractualAttachmentState: UnlinkContractualAttachmentState = {
  error: null,
  success: false,
};

export type TrashDocumentState = {
  error: string | null;
  success: boolean;
};

export const initialTrashDocumentState: TrashDocumentState = {
  error: null,
  success: false,
};

export type RestoreDocumentState = {
  error: string | null;
  success: boolean;
};

export const initialRestoreDocumentState: RestoreDocumentState = {
  error: null,
  success: false,
};
