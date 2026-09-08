/**
 * Estrutura operacional aprovada para a única origem Google Drive do ACC.
 * A URL específica de cada projeto não é publicada no código-fonte. Ela é
 * informada pelo ADMIN e armazenada pela RPC/RLS existente.
 */
export const ESG_SSMA_DRIVE_ROOT_PATH =
  "Shared drives > diretório corporativo do ACC > SSMA-ESG > pasta do projeto";

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
] as const;

export function isGoogleDriveFolderUrl(value: string): boolean {
  return value.startsWith("https://drive.google.com/drive/folders/");
}
