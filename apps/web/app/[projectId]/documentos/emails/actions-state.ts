// Estado das Server Actions do registro documental por e-mail
// (revisão humana, classificação, baseline, validação de Curva S).
// Separado de actions.ts para poder ser importado por componentes client
// (mesmo padrão de documentos/actions-state.ts).

export interface EmailRegistryActionState {
  error: string | null;
  success: boolean;
  message: string | null;
}

export const initialEmailRegistryActionState: EmailRegistryActionState = {
  error: null,
  success: false,
  message: null,
};
