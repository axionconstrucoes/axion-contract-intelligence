// Leitura do estado de sincronização de metadados para a UI.
//
// Só SELECT, e sempre pelo client de sessão: a RLS de
// construmanager_* restringe a membros do projeto. Nenhuma credencial
// e nenhuma chamada à API do Construmanager acontecem aqui.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConstrumanagerMetadataOverview {
  lastSyncAt: string | null;
  lastSyncStatus: "SUCESSO" | "ERRO" | "PARCIAL" | null;
  lastSyncError: string | null;
  documentsSeen: number;
  historicalVersionsSeen: number;
  documentsCreated: number;
  versionsCreated: number;
  foldersSeen: number;
  versionsOrphaned: number;
  storedDocuments: number;
  storedVersions: number;
}

type SyncRunRow = {
  completed_at: string | null;
  started_at: string;
  status: string | null;
  error: string | null;
  folders_seen: number | null;
  documents_seen: number | null;
  historical_versions_seen: number | null;
  documents_created: number | null;
  versions_created: number | null;
  versions_orphaned: number | null;
};

export async function getConstrumanagerMetadataOverview(
  supabase: SupabaseClient,
  projectId: string
): Promise<ConstrumanagerMetadataOverview | null> {
  const [runResult, documentsResult, versionsResult] = await Promise.all([
    supabase
      .from("construmanager_sync_runs")
      .select(
        "completed_at, started_at, status, error, folders_seen, documents_seen, historical_versions_seen, documents_created, versions_created, versions_orphaned"
      )
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("construmanager_documents")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabase
      .from("construmanager_document_versions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);

  const run = (runResult.data as SyncRunRow | null) ?? null;

  // Projeto sem nenhuma execução e sem nada armazenado: a UI mostra
  // "ainda não sincronizado" em vez de zeros que parecem resultado.
  if (!run && !documentsResult.count && !versionsResult.count) {
    return null;
  }

  const status = run?.status;

  return {
    lastSyncAt: run?.completed_at ?? run?.started_at ?? null,
    lastSyncStatus:
      status === "SUCESSO" || status === "ERRO" || status === "PARCIAL"
        ? status
        : null,
    lastSyncError: run?.error ?? null,
    foldersSeen: run?.folders_seen ?? 0,
    documentsSeen: run?.documents_seen ?? 0,
    historicalVersionsSeen: run?.historical_versions_seen ?? 0,
    documentsCreated: run?.documents_created ?? 0,
    versionsCreated: run?.versions_created ?? 0,
    versionsOrphaned: run?.versions_orphaned ?? 0,
    storedDocuments: documentsResult.count ?? 0,
    storedVersions: versionsResult.count ?? 0,
  };
}
