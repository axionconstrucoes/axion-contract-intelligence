// Cliente Google Drive real — construído só quando efetivamente
// necessário (nunca no import do módulo), a partir de OAuth2 com
// refresh token de longa duração, mesmo padrão já usado por
// apps/web/lib/email/inbound/gmail-inbound-auth.ts.

import { google } from "googleapis";
import type { DriveConfig } from "./drive-config";

/** Subconjunto mínimo do client real — permite injetar um client falso nos testes, sem rede nem o SDK googleapis completo. */
export interface DriveFilesClient {
  create(params: {
    requestBody: { name: string; parents: string[] };
    media: { mimeType: string; body: NodeJS.ReadableStream };
    fields: string;
  }): Promise<{ data: { id?: string | null } }>;
}

export function createDriveFilesClient(config: DriveConfig): DriveFilesClient {
  const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  return drive.files as unknown as DriveFilesClient;
}
