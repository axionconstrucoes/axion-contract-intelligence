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
