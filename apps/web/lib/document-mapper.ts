import type { Document, DocumentKind, DocumentVersion, SourceType } from "@axion/types";

export type DocumentRow = {
  id: string;
  project_id: string;
  kind: DocumentKind;
  title: string;
  created_at: string;
};

export type DocumentVersionRow = {
  id: string;
  document_id: string;
  version_label: string;
  version_index: number;
  document_date: string;
  source_type: SourceType;
  author: string;
  summary: string;
  file_path: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  notes: string | null;
};

export function mapDocumentVersionRow(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    versionLabel: row.version_label,
    versionIndex: row.version_index,
    documentDate: row.document_date,
    sourceType: row.source_type,
    author: row.author,
    summary: row.summary,
    filePath: row.file_path,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    notes: row.notes,
  };
}

/** Versão apresentada neste lote = maior version_index — nunca ordenar por version_label. */
export function pickCurrentVersion(
  versions: DocumentVersionRow[]
): DocumentVersionRow | undefined {
  return versions.reduce<DocumentVersionRow | undefined>((current, candidate) => {
    if (!current || candidate.version_index > current.version_index) {
      return candidate;
    }
    return current;
  }, undefined);
}

// Um Project Document sempre deve ter >= 1 document_version; a ausência é
// inconsistência estrutural (nunca fallback silencioso de version/sourceType/
// author/summary/date vazios).
export function mapDocumentWithVersion(
  documentRow: DocumentRow,
  versionRow: DocumentVersionRow | undefined
): Document {
  if (!versionRow) {
    throw new Error(
      `Inconsistência estrutural: document (id=${documentRow.id}, project_id=${documentRow.project_id}) sem document_version correspondente.`
    );
  }

  return {
    id: documentRow.id,
    projectId: documentRow.project_id,
    kind: documentRow.kind,
    title: documentRow.title,
    sourceType: versionRow.source_type,
    version: versionRow.version_label,
    date: versionRow.document_date,
    author: versionRow.author,
    summary: versionRow.summary,
  };
}
