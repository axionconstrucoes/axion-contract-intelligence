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

// Sincronização MANUAL de metadados do Construmanager (Pacote B).
// Somente contagens: nenhum documento, nome de arquivo ou conteúdo
// trafega para o estado do formulário.
export type SyncConstrumanagerMetadataState = {
  error: string | null;
  success: boolean;
  syncedAt: string | null;
  foldersSeen: number | null;
  documentsSeen: number | null;
  historicalVersionsSeen: number | null;
  documentsCreated: number | null;
  versionsCreated: number | null;
  versionsOrphaned: number | null;
};

export const initialSyncConstrumanagerMetadataState: SyncConstrumanagerMetadataState = {
  error: null,
  success: false,
  syncedAt: null,
  foldersSeen: null,
  documentsSeen: null,
  historicalVersionsSeen: null,
  documentsCreated: null,
  versionsCreated: null,
  versionsOrphaned: null,
};

// Download de conteúdo real do Construmanager (Pacote C).
//
// Só contagens, hashes abreviados e tamanhos: nenhum byte de documento
// e nenhum caminho local trafegam para o estado do formulário.
export type DownloadConstrumanagerContentState = {
  error: string | null;
  success: boolean;
  finishedAt: string | null;
  attempted: number | null;
  stored: number | null;
  failed: number | null;
  blobsCreated: number | null;
  blobsReused: number | null;
  uploadsSkipped: number | null;
  firstError: string | null;
};

export const initialDownloadConstrumanagerContentState: DownloadConstrumanagerContentState = {
  error: null,
  success: false,
  finishedAt: null,
  attempted: null,
  stored: null,
  failed: null,
  blobsCreated: null,
  blobsReused: null,
  uploadsSkipped: null,
  firstError: null,
};

// Preparação da lista de conteúdo do Construmanager (Pacote C).
//
// Estado próprio, separado do download: preparar cria vínculos e não
// baixa nada, então não faz sentido reaproveitar contadores de bytes,
// blobs ou uploads — um estado compartilhado convidaria a UI a exibir
// "0 armazenados" depois de uma preparação bem-sucedida.
export type PrepareConstrumanagerContentState = {
  error: string | null;
  success: boolean;
  finishedAt: string | null;
  linksCreated: number | null;
  documentsTotal: number | null;
  versionsTotal: number | null;
  pendingTotal: number | null;
};

export const initialPrepareConstrumanagerContentState: PrepareConstrumanagerContentState = {
  error: null,
  success: false,
  finishedAt: null,
  linksCreated: null,
  documentsTotal: null,
  versionsTotal: null,
  pendingTotal: null,
};
