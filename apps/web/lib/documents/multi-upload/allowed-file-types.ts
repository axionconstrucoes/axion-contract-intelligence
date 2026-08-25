// Mesma allowlist de components/documents/document-upload-form.tsx
// (upload individual) e do bucket "project-documents" (migration
// 20260821004108). Duplicado deliberadamente em vez de importado —
// o upload individual existente não deve ser tocado nesta etapa.

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  xml: "application/xml",
  mpp: "application/vnd.ms-project",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export const ACCEPT_ATTRIBUTE = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");
