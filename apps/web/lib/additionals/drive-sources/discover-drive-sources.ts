// Descoberta recursiva de subpastas/arquivos relevantes na pasta Drive
// de UMA proposta (seção 2 do requisito) — NUNCA varre o Drive inteiro:
// a recursão começa sempre na pasta vinculada à proposta
// (project_additional_proposals.drive_file_id) e nunca sobe para pastas
// irmãs/pai. Limitada a maxDepth para nunca percorrer uma árvore
// arbitrariamente profunda. `client` é sempre injetado — nunca
// instanciado aqui — para permitir testes totalmente offline (mesmo
// padrão de DriveFilesClient em apps/web/lib/drive/drive-client.ts).

import { classifyFolderName } from "./classify-folder-name";
import { classifySourceFromFolderCategory } from "./classify-source";
import type { DriveFilesListClient, DriveSourceClassification, SemanticFolderCategory } from "./types";

export interface DiscoveredDriveEntry {
  driveFileId: string;
  driveFolderId: string;
  fileName: string;
  mimeType: string;
  semanticFolderCategory: SemanticFolderCategory | null;
  sourceClassification: DriveSourceClassification;
  driveModifiedTime: string | null;
  driveRevisionId: string | null;
}

const DEFAULT_MAX_DEPTH = 6;

async function walk(
  client: DriveFilesListClient,
  folderId: string,
  inheritedCategory: SemanticFolderCategory | null,
  depth: number,
  maxDepth: number,
  out: DiscoveredDriveEntry[]
): Promise<void> {
  if (depth > maxDepth) return;

  const children = await client.listChildren(folderId);

  for (const child of children) {
    if (child.isFolder) {
      // Categoria mais específica encontrada mais fundo na árvore
      // substitui a herdada — nunca o contrário (a pasta mais próxima do
      // arquivo é sempre a mais confiável).
      const childCategory = classifyFolderName(child.name) ?? inheritedCategory;
      await walk(client, child.id, childCategory, depth + 1, maxDepth, out);
      continue;
    }

    out.push({
      driveFileId: child.id,
      driveFolderId: folderId,
      fileName: child.name,
      mimeType: child.mimeType,
      semanticFolderCategory: inheritedCategory,
      sourceClassification: classifySourceFromFolderCategory(inheritedCategory),
      driveModifiedTime: child.modifiedTime,
      driveRevisionId: child.headRevisionId,
    });
  }
}

/**
 * Descobre arquivos na pasta `rootFolderId` (a pasta vinculada à
 * proposta) e descendentes, classificando cada um pela pasta semântica
 * mais próxima. `rootFolderId` em si NUNCA é tratado como uma pasta
 * semântica classificada — só suas subpastas nomeadas o são.
 */
export async function discoverProposalDriveSources(
  client: DriveFilesListClient,
  rootFolderId: string,
  maxDepth: number = DEFAULT_MAX_DEPTH
): Promise<DiscoveredDriveEntry[]> {
  const out: DiscoveredDriveEntry[] = [];
  await walk(client, rootFolderId, null, 0, maxDepth, out);
  return out;
}
