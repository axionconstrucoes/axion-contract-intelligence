// Tipos e estados iniciais dos Server Actions de Integrações
// (./actions.ts) — deliberadamente fora do módulo "use server" (mesmo
// padrão de app/[projectId]/documentos/actions-state.ts).

export type RegisterEmailAccountState = { error: string | null; success: boolean };
export const initialRegisterEmailAccountState: RegisterEmailAccountState = { error: null, success: false };

export type DisconnectEmailAccountState = { error: string | null; success: boolean };
export const initialDisconnectEmailAccountState: DisconnectEmailAccountState = { error: null, success: false };

export type SaveEmailIngestionConfigState = { error: string | null; success: boolean };
export const initialSaveEmailIngestionConfigState: SaveEmailIngestionConfigState = { error: null, success: false };

export type StartEmailSyncState = { error: string | null; success: boolean; syncRunId: string | null };
export const initialStartEmailSyncState: StartEmailSyncState = { error: null, success: false, syncRunId: null };

export type SaveIntegrationOriginState = { error: string | null; success: boolean };
export const initialSaveIntegrationOriginState: SaveIntegrationOriginState = { error: null, success: false };

export type ValidateConstrumanagerConnectionState = {
  error: string | null;
  success: boolean;
  status: "CONECTADO" | "PENDENTE" | "ATENCAO" | "ERRO" | null;
  checkedAt: string | null;
};

export const initialValidateConstrumanagerConnectionState: ValidateConstrumanagerConnectionState = {
  error: null,
  success: false,
  status: null,
  checkedAt: null,
};
