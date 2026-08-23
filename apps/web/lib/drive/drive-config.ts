// Configuração do espelhamento Google Drive — fail-closed, mesmo padrão
// já usado por loadGmailConfig/loadAnthropicConfig. NENHUM ID de pasta
// do Drive é hardcoded na lógica: todos vêm de environment variables
// (ver docs/email-attachments-and-drive-mirror.md para os valores
// reais da estrutura ACC ROOT já criada no Drive — documentados, nunca
// embutidos no código).
//
// Nesta fase, o OAuth do Gmail (gmail.readonly/gmail.send) NÃO cobre o
// Drive — são credenciais/escopo completamente separados. Enquanto
// GOOGLE_DRIVE_* não estiver configurado, `isDriveConfigured()` retorna
// false e todo o pipeline de anexos continua funcionando normalmente
// (Supabase é sempre a fonte autoritativa) — o espelhamento apenas fica
// SKIPPED, nunca bloqueia nem falha a ingestão.

/** IDs de pasta do Drive — só `emailAttachmentsFolderId` é usado nesta fase; as demais ficam preparadas para uso futuro. */
export interface DriveFolderConfig {
  rootFolderId: string | null;
  contractualDocumentsFolderId: string | null;
  emailAttachmentsFolderId: string | null;
  evidenceFolderId: string | null;
  exportsFolderId: string | null;
  reportsFolderId: string | null;
  auditDossiersFolderId: string | null;
}

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  emailAttachmentsFolderId: string;
}

function readOptionalFolderId(envVarName: string): string | null {
  const value = process.env[envVarName];
  return value && value.trim() ? value.trim() : null;
}

/** Lê todos os IDs de pasta conhecidos, mesmo os ainda não usados nesta fase — nunca lança. */
export function readDriveFolderConfig(): DriveFolderConfig {
  return {
    rootFolderId: readOptionalFolderId("GOOGLE_DRIVE_FOLDER_ROOT"),
    contractualDocumentsFolderId: readOptionalFolderId("GOOGLE_DRIVE_FOLDER_CONTRACTUAL_DOCUMENTS"),
    emailAttachmentsFolderId: readOptionalFolderId("GOOGLE_DRIVE_FOLDER_EMAIL_ATTACHMENTS"),
    evidenceFolderId: readOptionalFolderId("GOOGLE_DRIVE_FOLDER_EVIDENCE"),
    exportsFolderId: readOptionalFolderId("GOOGLE_DRIVE_FOLDER_EXPORTS"),
    reportsFolderId: readOptionalFolderId("GOOGLE_DRIVE_FOLDER_REPORTS"),
    auditDossiersFolderId: readOptionalFolderId("GOOGLE_DRIVE_FOLDER_AUDIT_DOSSIERS"),
  };
}

/** true só quando todas as credenciais do espelhamento estão presentes — nunca lança. */
export function isDriveConfigured(): boolean {
  const folders = readDriveFolderConfig();
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN &&
      folders.emailAttachmentsFolderId
  );
}

/** FAIL CLOSED: só deve ser chamada depois de confirmar isDriveConfigured() === true. */
export function loadDriveConfig(): DriveConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const emailAttachmentsFolderId = readDriveFolderConfig().emailAttachmentsFolderId;

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_DRIVE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_DRIVE_CLIENT_SECRET");
  if (!refreshToken) missing.push("GOOGLE_DRIVE_REFRESH_TOKEN");
  if (!emailAttachmentsFolderId) missing.push("GOOGLE_DRIVE_FOLDER_EMAIL_ATTACHMENTS");

  if (missing.length > 0) {
    throw new Error(
      `Configuração do espelhamento Google Drive incompleta — variáveis ausentes: ${missing.join(", ")}. ` +
        "O Drive nunca é obrigatório para a ingestão de anexos (Supabase continua válido) — só chame " +
        "loadDriveConfig() depois de confirmar isDriveConfigured()."
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    emailAttachmentsFolderId: emailAttachmentsFolderId!,
  };
}
