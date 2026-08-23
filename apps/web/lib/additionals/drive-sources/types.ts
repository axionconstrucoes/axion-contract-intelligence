// Tipos da descoberta de subpastas Drive de uma proposta — espelham
// public.additional_proposal_drive_sources (ver migration
// 20260823080000). Nunca uma varredura do Drive inteiro — sempre
// limitado à pasta vinculada à proposta + descendentes.

export type SemanticFolderCategory = "RECEBIDOS_CLIENTE" | "PLANILHA_AXION" | "PLANILHA_CLIENTE" | "PROPOSTA" | "CRONOGRAMA";

export type DriveSourceClassification = "CLIENT_SOURCE" | "CLIENT_SPREADSHEET" | "AXION_ESTIMATE" | "AXION_PROPOSAL" | "SCHEDULE_SOURCE" | "OTHER_REFERENCE";

export type DriveSourceProcessingStatus = "DISCOVERED" | "SOURCE_REQUIRES_PROCESSING" | "PROCESSED" | "FAILED";

export interface AdditionalProposalDriveSource {
  id: string;
  proposalId: string;
  driveFileId: string;
  driveFolderId: string | null;
  driveRevisionId: string | null;
  driveModifiedTime: string | null;
  fileName: string;
  mimeType: string;
  semanticFolderCategory: SemanticFolderCategory | null;
  sourceClassification: DriveSourceClassification;
  sha256Hash: string | null;
  processingStatus: DriveSourceProcessingStatus;
  documentVersionId: string | null;
  discoveredAt: string;
  createdByType: "SYSTEM" | "USER" | "LEGACY";
  createdByUserId: string | null;
  createdByLabel: string | null;
  createdAt: string;
}

/** Subconjunto mínimo do client Drive real usado pela descoberta — permite injetar um client falso nos testes, sem SDK/rede. */
export interface DriveFilesListClient {
  listChildren(folderId: string): Promise<DriveChildFile[]>;
}

export interface DriveChildFile {
  id: string;
  name: string;
  mimeType: string;
  /** MIME de pasta do Drive ("application/vnd.google-apps.folder") identifica recursão — nunca hardcoded fora deste módulo. */
  isFolder: boolean;
  modifiedTime: string | null;
  headRevisionId: string | null;
}
