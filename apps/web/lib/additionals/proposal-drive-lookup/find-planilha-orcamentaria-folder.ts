// Puro, sem I/O. Localiza a subpasta "02_PLANILHA ORÇAMENTÁRIA" (ou
// variações — "planilha orçamento", "planilhas", etc.) dentro das
// subpastas de uma proposta. Reaproveita classifyFolderName
// (lib/additionals/drive-sources/classify-folder-name.ts) — mesma regra
// semântica já usada para classificar fontes Drive de propostas já
// vinculadas, nunca uma segunda implementação divergente do que conta
// como "pasta de planilha orçamentária".

import { classifyFolderName } from "@/lib/additionals/drive-sources/classify-folder-name";
import type { DriveFolderEntry } from "./types";

export function findPlanilhaOrcamentariaFolder(subfolders: DriveFolderEntry[]): DriveFolderEntry | null {
  return subfolders.find((folder) => classifyFolderName(folder.name) === "PLANILHA_AXION") ?? null;
}
