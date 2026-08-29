// Fixture DETERMINÍSTICA de ProposalDriveLookupClient — usada enquanto o
// Drive real não é acessado (autorização pendente desta etapa). Nunca
// chama rede/SDK googleapis. Dados fictícios, mas estruturalmente
// idênticos ao que o Drive real devolveria, cobrindo os casos relevantes:
//   - AXN CP 617 - DUX VINHEDO - SP: caminho feliz (FECHAMENTO/B12,
//     igual ao exemplo do requisito)
//   - AXN CP 640 - ACME LOGÍSTICA - MG: planilha com mais de uma aba
//     (sem lógica canônica de preço — nunca inventa um valor)
//   - AXN CP 655 - BETA MOTORS - RS: pasta sem "02_PLANILHA ORÇAMENTÁRIA"
//   - Dois arquivos "custo" com datas diferentes na mesma proposta, para
//     provar que o MAIS RECENTE é escolhido (nunca o primeiro da lista)
//
// Trocar por um client real (Drive de verdade) é só implementar a MESMA
// interface ProposalDriveLookupClient e injetar no lugar desta fixture —
// nenhum outro código muda.

import type { DriveFileEntry, DriveFolderEntry, ProposalDriveLookupClient } from "./types";

const ORCAMENTOS_SUBFOLDERS: DriveFolderEntry[] = [
  { id: "folder-axn-cp-617", name: "AXN CP 617 - DUX VINHEDO - SP", modifiedTime: "2026-07-10T12:00:00Z" },
  { id: "folder-axn-cp-640", name: "AXN CP 640 - ACME LOGÍSTICA - MG", modifiedTime: "2026-07-15T12:00:00Z" },
  { id: "folder-axn-cp-655", name: "AXN CP 655 - BETA MOTORS - RS", modifiedTime: "2026-08-01T12:00:00Z" },
];

const PLANILHA_SUBFOLDER_BY_PROPOSAL: Record<string, DriveFolderEntry[]> = {
  "folder-axn-cp-617": [{ id: "planilha-617", name: "02_PLANILHA ORÇAMENTÁRIA", modifiedTime: "2026-07-10T12:00:00Z" }],
  "folder-axn-cp-640": [{ id: "planilha-640", name: "02_PLANILHA ORÇAMENTÁRIA", modifiedTime: "2026-07-15T12:00:00Z" }],
  // 655 deliberadamente SEM a subpasta de planilha orçamentária — cobre o caso "não encontrada".
  "folder-axn-cp-655": [{ id: "outros-655", name: "01_RECEBIDOS CLIENTE", modifiedTime: "2026-08-01T12:00:00Z" }],
};

const FILES_BY_PLANILHA_FOLDER: Record<string, DriveFileEntry[]> = {
  "planilha-617": [
    { id: "file-617-custo-v1", name: "AXN CP 617 - Custo Rev01.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", modifiedTime: "2026-07-05T09:00:00Z" },
    // Case-insensitive ("CUSTO" maiúsculo) e MAIS recente que a Rev01 — é este que deve ser escolhido.
    { id: "file-617-custo-v2", name: "AXN CP 617 - CUSTO Rev02.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", modifiedTime: "2026-07-09T14:30:00Z" },
    { id: "file-617-escopo", name: "AXN CP 617 - Memorial de Escopo.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", modifiedTime: "2026-07-08T10:00:00Z" },
  ],
  "planilha-640": [
    { id: "file-640-custo", name: "AXN CP 640 - Planilha de custo.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", modifiedTime: "2026-07-14T11:00:00Z" },
  ],
};

const SHEET_NAMES_BY_FILE: Record<string, string[]> = {
  "file-617-custo-v1": ["FECHAMENTO"],
  "file-617-custo-v2": ["FECHAMENTO"],
  "file-640-custo": ["INSUMOS", "MÃO DE OBRA", "FECHAMENTO", "RESUMO"],
};

const CELL_VALUES: Record<string, string | number> = {
  "file-617-custo-v2:FECHAMENTO:B12": 487500.42,
};

export function createFixtureProposalDriveLookupClient(): ProposalDriveLookupClient {
  return {
    async listOrcamentosSubfolders() {
      return ORCAMENTOS_SUBFOLDERS;
    },
    async listSubfolders(folderId: string) {
      return PLANILHA_SUBFOLDER_BY_PROPOSAL[folderId] ?? [];
    },
    async listFiles(folderId: string) {
      return FILES_BY_PLANILHA_FOLDER[folderId] ?? [];
    },
    async listSpreadsheetSheetNames(fileId: string) {
      return SHEET_NAMES_BY_FILE[fileId] ?? [];
    },
    async readSpreadsheetCell(fileId: string, sheetName: string, cellRef: string) {
      return CELL_VALUES[`${fileId}:${sheetName}:${cellRef}`] ?? null;
    },
  };
}
