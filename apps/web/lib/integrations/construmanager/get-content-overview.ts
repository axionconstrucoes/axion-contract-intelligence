// Leitura do estado de download de conteúdo para a UI.
//
// Só SELECT, e sempre pelo client de sessão: a RLS de
// construmanager_content_links restringe a membros do projeto e a de
// construmanager_content_blobs exige um vínculo visível. Nenhuma
// credencial e nenhuma chamada à API do Construmanager acontecem aqui.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConstrumanagerContentItem {
  linkId: string;
  objectId: number;
  sourceName: string;
  target: "DOCUMENTO" | "VERSAO";
  status: "PENDENTE" | "BAIXANDO" | "ARMAZENADO" | "ERRO";
  sizeBytes: number | null;
  sha256: string | null;
  /** Primeiros 12 caracteres — suficiente para conferência visual. */
  sha256Short: string | null;
  downloadedAt: string | null;
  attempts: number;
  error: string | null;
}

export interface ConstrumanagerContentOverview {
  total: number;
  pending: number;
  downloading: number;
  stored: number;
  failed: number;
  /** Blobs físicos distintos entre os itens armazenados. */
  distinctBlobs: number;
  storedBytes: number;
  recent: ConstrumanagerContentItem[];
}

type LinkRow = {
  id: string;
  construmanager_object_id: number;
  source_name: string;
  document_id: string | null;
  version_id: string | null;
  download_status: string;
  download_attempts: number;
  download_error: string | null;
  downloaded_at: string | null;
  content_blob_id: string | null;
  construmanager_content_blobs:
    | { sha256: string; size_bytes: number }
    | { sha256: string; size_bytes: number }[]
    | null;
};

function blobOf(row: LinkRow): { sha256: string; size_bytes: number } | null {
  const blob = row.construmanager_content_blobs;
  if (!blob) return null;
  return Array.isArray(blob) ? (blob[0] ?? null) : blob;
}

const RECENT_LIMIT = 20;

export async function getConstrumanagerContentOverview(
  supabase: SupabaseClient,
  projectId: string
): Promise<ConstrumanagerContentOverview | null> {
  const { data, error } = await supabase
    .from("construmanager_content_links")
    .select(
      "id, construmanager_object_id, source_name, document_id, version_id, download_status, download_attempts, download_error, downloaded_at, content_blob_id, construmanager_content_blobs (sha256, size_bytes)"
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (error || !data) return null;

  const rows = data as unknown as LinkRow[];

  if (rows.length === 0) {
    return {
      total: 0,
      pending: 0,
      downloading: 0,
      stored: 0,
      failed: 0,
      distinctBlobs: 0,
      storedBytes: 0,
      recent: [],
    };
  }

  const distinct = new Set<string>();
  let storedBytes = 0;
  let pending = 0;
  let downloading = 0;
  let stored = 0;
  let failed = 0;

  const items: ConstrumanagerContentItem[] = rows.map((row) => {
    const blob = blobOf(row);

    if (row.download_status === "PENDENTE") pending += 1;
    else if (row.download_status === "BAIXANDO") downloading += 1;
    else if (row.download_status === "ARMAZENADO") stored += 1;
    else if (row.download_status === "ERRO") failed += 1;

    // Bytes físicos são contados UMA vez por blob: dois documentos com
    // o mesmo conteúdo ocupam um objeto só, e o total precisa refletir
    // isso em vez de somar duas vezes o mesmo arquivo.
    if (row.content_blob_id && blob && !distinct.has(row.content_blob_id)) {
      distinct.add(row.content_blob_id);
      storedBytes += Number(blob.size_bytes ?? 0);
    }

    return {
      linkId: row.id,
      objectId: row.construmanager_object_id,
      sourceName: row.source_name,
      target: row.version_id ? "VERSAO" : "DOCUMENTO",
      status: row.download_status as ConstrumanagerContentItem["status"],
      sizeBytes: blob ? Number(blob.size_bytes) : null,
      sha256: blob?.sha256 ?? null,
      sha256Short: blob?.sha256 ? blob.sha256.slice(0, 12) : null,
      downloadedAt: row.downloaded_at,
      attempts: row.download_attempts,
      error: row.download_error,
    };
  });

  return {
    total: rows.length,
    pending,
    downloading,
    stored,
    failed,
    distinctBlobs: distinct.size,
    storedBytes,
    recent: items.slice(0, RECENT_LIMIT),
  };
}
