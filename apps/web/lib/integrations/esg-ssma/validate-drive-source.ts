import "server-only";

import type { DriveReadOnlyFilesClient } from "@/lib/drive/drive-client";
import {
  ESG_SSMA_PROJECT_SUBFOLDERS,
  extractGoogleDriveFolderId,
} from "./drive-source-policy";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type DriveItem = { id: string; name: string; mimeType: string };

export type SsmaDriveFolderInspection = {
  name: string;
  files: number;
  folders: number;
  totalItems: number;
};

export type SsmaDriveInspection = {
  rootName: string;
  folders: SsmaDriveFolderInspection[];
  totalFiles: number;
  totalFolders: number;
  totalItems: number;
};

async function listDirectChildren(
  client: DriveReadOnlyFilesClient,
  folderId: string
): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;

  do {
    const response = await client.list({
      q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      pageSize: 1000,
      pageToken,
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const item of response.data.files ?? []) {
      if (item.id && item.name && item.mimeType) {
        items.push({ id: item.id, name: item.name, mimeType: item.mimeType });
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return items;
}

export async function inspectSsmaDriveSource(
  client: DriveReadOnlyFilesClient,
  folderUrl: string
): Promise<SsmaDriveInspection> {
  const rootFolderId = extractGoogleDriveFolderId(folderUrl);
  if (!rootFolderId) throw new Error("INVALID_FOLDER_URL");

  const root = await client.get({
    fileId: rootFolderId,
    fields: "id,name,mimeType",
    supportsAllDrives: true,
  });

  if (root.data.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    throw new Error("ROOT_IS_NOT_A_FOLDER");
  }

  const rootChildren = await listDirectChildren(client, rootFolderId);
  const foldersByName = new Map<string, DriveItem[]>();

  for (const item of rootChildren) {
    if (item.mimeType !== DRIVE_FOLDER_MIME_TYPE) continue;
    const matches = foldersByName.get(item.name) ?? [];
    matches.push(item);
    foldersByName.set(item.name, matches);
  }

  const missing = ESG_SSMA_PROJECT_SUBFOLDERS.filter(
    (name) => !foldersByName.has(name)
  );
  const duplicated = ESG_SSMA_PROJECT_SUBFOLDERS.filter(
    (name) => (foldersByName.get(name)?.length ?? 0) > 1
  );

  if (missing.length > 0) throw new Error(`MISSING_FOLDERS:${missing.join("|")}`);
  if (duplicated.length > 0) throw new Error(`DUPLICATED_FOLDERS:${duplicated.join("|")}`);

  const folders = await Promise.all(
    ESG_SSMA_PROJECT_SUBFOLDERS.map(async (name) => {
      const folder = foldersByName.get(name)![0];
      const children = await listDirectChildren(client, folder.id);
      const nestedFolders = children.filter(
        (item) => item.mimeType === DRIVE_FOLDER_MIME_TYPE
      ).length;
      const files = children.length - nestedFolders;
      return { name, files, folders: nestedFolders, totalItems: children.length };
    })
  );

  const totalFiles = folders.reduce((sum, folder) => sum + folder.files, 0);
  const totalFolders = folders.reduce((sum, folder) => sum + folder.folders, 0);

  return {
    rootName: root.data.name ?? "Pasta SSMA/ESG",
    folders,
    totalFiles,
    totalFolders,
    totalItems: totalFiles + totalFolders,
  };
}
