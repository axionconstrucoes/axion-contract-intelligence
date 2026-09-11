// Reconhecimento de formato documental — puro, SEM nenhuma dependência
// de Node.
//
// Vive separado de extract-document-text.ts de propósito: aquele módulo
// importa `node:fs`/`node:path` (para localizar as fontes padrão do
// pdfjs) e é exclusivamente de servidor. O caminho do UPLOAD roda no
// navegador e precisa recusar um formato não suportado ANTES de enviar
// bytes — se ele importasse o extrator inteiro, o `node:fs` entraria no
// bundle do cliente e o build do Turbopack falharia com
// "the chunking context does not support external modules (request:
// node:fs)". Foi exatamente o que aconteceu.

export type SupportedExtractionFormat = "PDF" | "DOCX" | "TXT" | "XLSX";

/** Rótulo dos formatos legíveis, para mensagem ao usuário. Fonte única. */
export const SUPPORTED_FORMATS_LABEL = "PDF, DOCX, TXT ou XLSX";

function resolveExtension(fileName: string): string {
  return String(fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Decide o formato por MIME e, como reforço, pela extensão — a mesma
 * ordem usada por scripts/document-extractors.mjs. `null` significa
 * "não sabemos ler", nunca "arquivo vazio".
 */
export function resolveExtractionFormat(
  mimeType: string | null,
  fileName: string
): SupportedExtractionFormat | null {
  const extension = resolveExtension(fileName);

  if (mimeType === "application/pdf" || extension === "pdf") return "PDF";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "DOCX";
  }
  if (mimeType === "text/plain" || extension === "txt") return "TXT";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    extension === "xlsx"
  ) {
    return "XLSX";
  }

  return null;
}

/**
 * `.mpp` (Microsoft Project) é formato binário proprietário (contêiner
 * OLE) e NÃO existe parser JavaScript viável para ele. O arquivo até
 * poderia ser guardado, mas nenhuma data sairia dele — e um cronograma
 * armazenado que o especialista não lê é pior do que uma recusa: passa
 * a impressão de que as datas entraram na análise.
 *
 * Por isso a recusa é explícita e diz o caminho de saída (exportar em
 * .xlsx pelo próprio MS Project), em vez da mensagem genérica.
 */
export function isMicrosoftProjectFile(mimeType: string | null, fileName: string): boolean {
  return mimeType === "application/vnd.ms-project" || resolveExtension(fileName) === "mpp";
}

/**
 * Motivo exibível de um formato recusado. Única fonte da mensagem, usada
 * tanto no navegador (antes do upload) quanto no servidor (extração) —
 * sem isto, o mesmo arquivo era recusado com dois textos diferentes
 * dependendo de onde a recusa acontecia.
 */
export function unsupportedFormatDetail(mimeType: string | null, fileName: string): string {
  if (isMicrosoftProjectFile(mimeType, fileName)) {
    return (
      `O AXION não lê datas do formato .mpp (Microsoft Project). Exporte o cronograma ` +
      `em .xlsx (no MS Project: Arquivo › Salvar como › Pasta de Trabalho do Excel) e envie a planilha.`
    );
  }

  return `Formato não suportado para análise jurídica: "${fileName}". Envie ${SUPPORTED_FORMATS_LABEL}.`;
}
