// Tipos do fluxo "Selecionar proposta em ORÇAMENTOS" (Propostas de
// Adicionais — Parte 7). Nenhum tipo aqui depende do SDK googleapis —
// só o suficiente para navegar a pasta ORÇAMENTOS e localizar a
// planilha de custo mais recente, injetável (mesmo espírito de
// DriveFilesListClient em lib/additionals/drive-sources/types.ts —
// reaproveitado ali onde faz sentido, nunca duplicado à toa).

export interface DriveFolderEntry {
  id: string;
  name: string;
  modifiedTime: string | null;
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
}

// Abstração do necessário para este fluxo — implementação real (Google
// Drive de verdade) e a fixture determinística (usada nesta etapa,
// nunca o Drive real) implementam o mesmo contrato.
export interface ProposalDriveLookupClient {
  /** Subpastas diretas de ORÇAMENTOS — cada uma é uma proposta. */
  listOrcamentosSubfolders(): Promise<DriveFolderEntry[]>;
  /** Subpastas diretas de uma pasta de proposta (para achar "02_PLANILHA ORÇAMENTÁRIA"). */
  listSubfolders(folderId: string): Promise<DriveFolderEntry[]>;
  /** Arquivos diretos de uma pasta (para achar a planilha de custo mais recente). */
  listFiles(folderId: string): Promise<DriveFileEntry[]>;
  /** Nomes das abas (sheets) de uma planilha, sem baixar o conteúdo inteiro. */
  listSpreadsheetSheetNames(fileId: string): Promise<string[]>;
  /** Valor bruto de uma célula (ex.: "B12") de uma aba específica. */
  readSpreadsheetCell(fileId: string, sheetName: string, cellRef: string): Promise<string | number | null>;
}

export type AdditionalProposalPriceSource = "FECHAMENTO_B12_ESTIMATE" | "NOT_RESOLVED";

export interface ResolvedAdditionalProposalFromDrive {
  proposalNumber: string;
  folderName: string; // nome completo da pasta, exatamente como no Drive — vira o escopo
  folderId: string;
  costFileName: string | null;
  costFileId: string | null;
  salePrice: number | null;
  priceSource: AdditionalProposalPriceSource;
  isEstimate: boolean;
  warnings: string[];
}
