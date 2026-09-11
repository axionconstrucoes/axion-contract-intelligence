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

export type SupportedExtractionFormat = "PDF" | "DOCX" | "TXT";

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

  return null;
}
