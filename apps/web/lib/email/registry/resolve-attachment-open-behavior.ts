// Comportamento de abertura por formato de anexo — puro e testável.
// Nunca executa conteúdo do anexo: PDF/imagem abrem no viewer do ACC
// (URL assinada, iframe/img); MPP aponta para o cronograma estruturado;
// planilhas/DOC/ZIP/desconhecidos só metadados + download controlado,
// com o motivo explícito.

export type AttachmentOpenKind = "PDF" | "IMAGE" | "MPP" | "SPREADSHEET" | "DOC" | "ZIP" | "UNSUPPORTED";

export interface AttachmentOpenBehavior {
  kind: AttachmentOpenKind;
  label: string;
  /** Motivo do fallback (null quando há viewer). */
  reason: string | null;
  /** true quando o ACC oferece visualização inline segura. */
  viewerAvailable: boolean;
}

export function extensionOfFileName(fileName: string): string {
  const match = /\.([a-z0-9]{1,6})$/i.exec(fileName.trim());
  return match ? match[1].toUpperCase() : "";
}

export function resolveAttachmentOpenBehavior(attachment: { mimeType: string; extension?: string; fileName?: string }): AttachmentOpenBehavior {
  const ext = (attachment.extension ?? extensionOfFileName(attachment.fileName ?? "")).toUpperCase();
  const mime = attachment.mimeType.toLowerCase();

  if (ext === "PDF" || mime === "application/pdf") return { kind: "PDF", label: "Abrir no viewer", reason: null, viewerAvailable: true };
  if (mime.startsWith("image/") || ["PNG", "JPG", "JPEG", "GIF", "WEBP", "BMP"].includes(ext)) {
    return { kind: "IMAGE", label: "Abrir no viewer", reason: null, viewerAvailable: true };
  }
  if (ext === "MPP" || mime === "application/vnd.ms-project") {
    return { kind: "MPP", label: "Cronograma estruturado", reason: null, viewerAvailable: true };
  }
  if (["XLS", "XLSX", "XLSM", "CSV"].includes(ext) || mime.includes("spreadsheet") || mime === "application/vnd.ms-excel") {
    return {
      kind: "SPREADSHEET",
      label: "Baixar planilha",
      reason: "Visualização tabular genérica indisponível; a Curva S extraída aparece na seção própria quando reconhecida.",
      viewerAvailable: false,
    };
  }
  if (["DOC", "DOCX"].includes(ext) || mime.includes("wordprocessingml") || mime === "application/msword") {
    return { kind: "DOC", label: "Baixar documento", reason: "Viewer de DOC/DOCX indisponível nesta versão; o texto extraído entra na busca.", viewerAvailable: false };
  }
  if (ext === "ZIP" || mime === "application/zip" || mime === "application/x-zip-compressed") {
    return { kind: "ZIP", label: "Baixar (controlado)", reason: "Pacote compactado: só metadados e download; nunca é aberto/executado pelo ACC.", viewerAvailable: false };
  }
  return { kind: "UNSUPPORTED", label: "Baixar", reason: `Formato ${ext || mime} sem visualização suportada — só metadados e download.`, viewerAvailable: false };
}
