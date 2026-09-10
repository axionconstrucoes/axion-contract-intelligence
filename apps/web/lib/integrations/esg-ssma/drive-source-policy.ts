/**
 * Estrutura operacional aprovada para a única origem Google Drive do ACC.
 * A URL específica de cada projeto não é publicada no código-fonte. Ela é
 * informada pelo ADMIN e armazenada pela RPC/RLS existente.
 */
export const ESG_SSMA_DRIVE_ROOT_PATH =
  "Drive compartilhado > SSMA-ESG > pasta da obra";

/**
 * Nome padrão das pastas de obra: `NNNN CLIENTE LOCAL NOME DA OBRA`.
 * Exemplo: `0075 WEG LINHARES FABRICA DE FIOS`. Sufixos de área como -ADM ou -SSMA
 * não fazem parte da identidade da obra nesta árvore.
 */
export function buildEsgSsmaProjectFolderName(
  projectCode: string,
  clientName: string,
  location: string,
  projectName: string
): string {
  const code = projectCode.trim();
  const normalizePart = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
  const client = normalizePart(clientName);
  const normalizedLocation = normalizePart(location);
  const name = normalizePart(projectName);

  if (!/^\d{4}$/.test(code)) throw new Error("PROJECT_CODE_MUST_HAVE_FOUR_DIGITS");
  if (!client) throw new Error("CLIENT_NAME_IS_REQUIRED");
  if (!normalizedLocation) throw new Error("PROJECT_LOCATION_IS_REQUIRED");
  if (!name) throw new Error("PROJECT_NAME_IS_REQUIRED");

  return `${code} ${client} ${normalizedLocation} ${name}`;
}

export const ESG_SSMA_PROJECT_SUBFOLDERS = [
  "01 - DIÁLOGO DIÁRIO DE SEGURANÇA - DDA (FOTOS)",
  "02 - DIÁLOGO SEMANAL DE SEGURANÇA - DDS (FOTOS)",
  "03 - FOTOS DIÁRIAS DE SEGURANÇA",
  "04 - ANÁLISE PRELIMINAR DE RISCO - APR",
  "05 - PERMISSÃO DE TRABALHO - PT",
  "06 - LISTA DE INTEGRAÇÃO",
  "07 - REMESSAS PARA BOTA-FORA",
  "08 - ORGANIZAÇÃO DO ALMOXARIFADO",
  "09 - RISCOS APONTADOS",
  "10 - LIMPEZA DA OBRA",
  "11 - OUTROS",
  "12 - OCORRÊNCIAS E ACIDENTES",
] as const;

export function isGoogleDriveFolderUrl(value: string): boolean {
  return extractGoogleDriveFolderId(value) !== null;
}

export function extractGoogleDriveFolderId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com") return null;
    const match = url.pathname.match(/^\/drive\/folders\/([A-Za-z0-9_-]+)\/?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
