// Mapeia categoria semântica de pasta → classificação de fonte (seção 3
// do requisito). Nunca confunde documento do cliente com documento
// produzido pela AXION — mapeamento fixo, nunca inferido do conteúdo do
// arquivo (mimeType não decide isto, só a pasta onde foi encontrado).

import type { DriveSourceClassification, SemanticFolderCategory } from "./types";

const FOLDER_TO_SOURCE_CLASSIFICATION: Record<SemanticFolderCategory, DriveSourceClassification> = {
  RECEBIDOS_CLIENTE: "CLIENT_SOURCE",
  PLANILHA_CLIENTE: "CLIENT_SPREADSHEET",
  PLANILHA_AXION: "AXION_ESTIMATE",
  PROPOSTA: "AXION_PROPOSAL",
  CRONOGRAMA: "SCHEDULE_SOURCE",
};

export function classifySourceFromFolderCategory(category: SemanticFolderCategory | null): DriveSourceClassification {
  return category ? FOLDER_TO_SOURCE_CLASSIFICATION[category] : "OTHER_REFERENCE";
}

/** Fontes que representam o que o CLIENTE forneceu/exigiu — nunca confundidas com o que a AXION produziu. */
export function isClientProvidedSource(classification: DriveSourceClassification): boolean {
  return classification === "CLIENT_SOURCE" || classification === "CLIENT_SPREADSHEET";
}
