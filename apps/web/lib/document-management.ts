import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

export type TranslationStatus = "NOT_TRANSLATED" | "REQUESTED" | "AVAILABLE";

export type ManagedDocumentVersion = {
  id: string;
  documentId: string;
  versionLabel: string;
  versionIndex: number;
  documentDate: string;
  sourceType: string;
  author: string;
  summary: string;
  filePath: string | null;
  storageBucket: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  processingStatus: string;
  processingError: string | null;
  uploadedAt: string;
  notes: string | null;
  // Idioma real do texto extraído (ISO 639-1 quando mapeado), detectado
  // pelo worker de processamento — null até ser processado/detectável.
  sourceLanguage: string | null;
  translationLanguage: string | null;
  translationStatus: TranslationStatus;
  // Invariante fixo (tipo literal, nunca uma coluna): o arquivo original
  // é sempre a fonte autoritativa — uma tradução, quando existir, é
  // apoio, nunca substitui o original. Mesmo padrão de
  // AiAssessment.requiresHumanReview.
  originalIsAuthoritative: true;
  // SHA-256 do conteúdo do arquivo (migration 20260825130000) — null
  // para versões enviadas antes desta migration, pelo upload
  // individual sem hash, ou por qualquer fluxo futuro que não o
  // informe. Usado só para deduplicação client-side no upload
  // múltiplo, nunca como identificador de segurança por si só.
  sha256Hash: string | null;
  // true quando este documento exige revisão humana antes de ser
  // considerado confiável (hoje: só Ata de Reunião, calculado no
  // servidor a partir do kind — nunca aceito do cliente).
  requiresHumanReview: boolean;
};

export type ManagedDocument = {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  createdAt: string;
  versions: ManagedDocumentVersion[];
};

type DocumentRow = {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  created_at: string;
};

type VersionRow = {
  id: string;
  document_id: string;
  version_label: string;
  version_index: number;
  document_date: string;
  source_type: string;
  author: string;
  summary: string;
  file_path: string | null;
  storage_bucket: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  processing_status: string;
  processing_error: string | null;
  uploaded_at: string;
  notes: string | null;
  source_language: string | null;
  translation_language: string | null;
  translation_status: string;
  sha256_hash: string | null;
  requires_human_review: boolean;
};

export async function getManagedDocuments(
  projectId: string
): Promise<ManagedDocument[]> {
  const supabase = await createSupabaseServerClient();

  const { data: documentsData, error: documentsError } =
    await supabase
      .from("documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

  if (documentsError) {
    if (documentsError.code === "22P02") {
      return [];
    }

    throw documentsError;
  }

  const documents =
    (documentsData ?? []) as unknown as DocumentRow[];

  if (documents.length === 0) {
    return [];
  }

  const { data: versionsData, error: versionsError } =
    await supabase
      .from("document_versions")
      .select("*")
      .in(
        "document_id",
        documents.map((document) => document.id)
      )
      .order("version_index", { ascending: false });

  if (versionsError) {
    throw versionsError;
  }

  const versions =
    (versionsData ?? []) as unknown as VersionRow[];

  const versionsByDocument =
    new Map<string, ManagedDocumentVersion[]>();

  for (const version of versions) {
    const list =
      versionsByDocument.get(version.document_id) ?? [];

    list.push({
      id: version.id,
      documentId: version.document_id,
      versionLabel: version.version_label,
      versionIndex: version.version_index,
      documentDate: version.document_date,
      sourceType: version.source_type,
      author: version.author,
      summary: version.summary,
      filePath: version.file_path,
      storageBucket: version.storage_bucket,
      originalFileName: version.original_file_name,
      mimeType: version.mime_type,
      fileSizeBytes: version.file_size_bytes,
      processingStatus: version.processing_status,
      processingError: version.processing_error,
      uploadedAt: version.uploaded_at,
      notes: version.notes,
      sourceLanguage: version.source_language,
      translationLanguage: version.translation_language,
      translationStatus: version.translation_status as TranslationStatus,
      originalIsAuthoritative: true,
      sha256Hash: version.sha256_hash,
      requiresHumanReview: version.requires_human_review,
    });

    versionsByDocument.set(
      version.document_id,
      list
    );
  }

  return documents.map((document) => ({
    id: document.id,
    projectId: document.project_id,
    kind: document.kind,
    title: document.title,
    createdAt: document.created_at,
    versions:
      versionsByDocument.get(document.id) ?? [],
  }));
}
