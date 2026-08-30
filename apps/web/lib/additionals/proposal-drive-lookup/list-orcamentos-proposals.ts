import "server-only";

import { getProposalDriveLookupClient } from "./get-proposal-drive-lookup-client";

export interface AdditionalProposalDriveFolderOption {
  id: string;
  name: string;
}

// Subpastas diretas de ORÇAMENTOS — cada uma é uma proposta candidata
// para o dropdown de criação. Nunca uma varredura do Drive inteiro (só
// o client injetado decide o que está "dentro de ORÇAMENTOS" — ver
// fixture-client.ts nesta etapa). Em produção (sem cliente real
// configurado, ver get-proposal-drive-lookup-client.ts), retorna lista
// vazia — nunca a fixture fictícia.
export async function listOrcamentosProposalFolders(): Promise<AdditionalProposalDriveFolderOption[]> {
  const client = getProposalDriveLookupClient();
  if (!client) return [];
  const folders = await client.listOrcamentosSubfolders();
  return folders.map((folder) => ({ id: folder.id, name: folder.name }));
}
