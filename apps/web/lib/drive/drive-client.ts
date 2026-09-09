// Cliente Google Drive real — construído só quando efetivamente
// necessário (nunca no import do módulo), a partir de OAuth2 com
// refresh token de longa duração, mesmo padrão já usado por
// apps/web/lib/email/inbound/gmail-inbound-auth.ts.

import { google } from "googleapis";
import type { DriveConfig, DriveOAuthConfig } from "./drive-config";

/** Subconjunto mínimo do client real — permite injetar um client falso nos testes, sem rede nem o SDK googleapis completo. */
export interface DriveFilesClient {
  create(params: {
    requestBody: { name: string; parents: string[] };
    media: { mimeType: string; body: NodeJS.ReadableStream };
    fields: string;
  }): Promise<{ data: { id?: string | null } }>;
}

export interface DriveReadOnlyFilesClient {
  get(params: {
    fileId: string;
    fields: string;
    supportsAllDrives: boolean;
  }): Promise<{ data: { id?: string | null; name?: string | null; mimeType?: string | null } }>;
  list(params: {
    q: string;
    fields: string;
    pageSize: number;
    pageToken?: string;
    spaces: "drive";
    supportsAllDrives: boolean;
    includeItemsFromAllDrives: boolean;
  }): Promise<{
    data: {
      files?: Array<{ id?: string | null; name?: string | null; mimeType?: string | null }> | null;
      nextPageToken?: string | null;
    };
  }>;
}

function createOAuthClient(config: DriveOAuthConfig) {
  const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });
  return oauth2Client;
}

export function createDriveFilesClient(config: DriveConfig): DriveFilesClient {
  const drive = google.drive({ version: "v3", auth: createOAuthClient(config) });
  return drive.files as unknown as DriveFilesClient;
}

export function createDriveReadOnlyFilesClient(
  config: DriveOAuthConfig
): DriveReadOnlyFilesClient {
  const drive = google.drive({ version: "v3", auth: createOAuthClient(config) });
  return drive.files as unknown as DriveReadOnlyFilesClient;
}
