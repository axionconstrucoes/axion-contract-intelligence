// Leitura do estado de monitoramento do Construmanager para a UI.
//
// Só SELECT, e sempre pelo client de sessão: a RLS de
// construmanager_* restringe a membros do projeto. Nenhuma credencial
// e nenhuma chamada à API do Construmanager acontecem aqui.
//
// DUAS EXECUÇÕES, NÃO UMA
//
// A versão anterior lia apenas a execução mais recente e mostrava os
// totais dela. Quando a última falha — como aconteceu com a quebra de
// ListaMestra/List — todos os contadores vêm 0, e a tela passava a
// afirmar "0 documentos" para um acervo de 192. Zero de uma falha não é
// resultado: é ausência de medição.
//
// Agora a leitura é dupla: a execução MAIS RECENTE dá status e erro; a
// última execução CONFIRMADA (SUCESSO ou PARCIAL) dá os totais. A tela
// mostra o que se sabe e, ao lado, que a última tentativa falhou.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConstrumanagerMetadataOverview {
  /** Quando a última tentativa aconteceu, tenha ela funcionado ou não. */
  lastSyncAt: string | null;
  lastSyncStatus: "SUCESSO" | "ERRO" | "PARCIAL" | null;
  lastSyncError: string | null;

  /** Quando os totais abaixo foram efetivamente medidos. */
  lastConfirmedSyncAt: string | null;

  /**
   * `true` quando a última tentativa falhou mas existem totais
   * confirmados anteriores — o caso em que a tela precisa mostrar os
   * dois fatos separadamente.
   */
  showingPreviousTotals: boolean;

  // Totais da última execução CONFIRMADA.
  documentsSeen: number;
  historicalVersionsSeen: number;
  documentsCreated: number;
  versionsCreated: number;
  foldersSeen: number;
  versionsOrphaned: number;

  // Estado acumulado, independente de execução.
  storedDocuments: number;
  storedVersions: number;

  /** Novas revisões vigentes detectadas na última execução confirmada. */
  newRevisions: number;

  /**
   * Documentos conhecidos que a última verificação confirmada NÃO
   * devolveu. Nunca são excluídos automaticamente: viram um número para
   * revisão humana. Derivado de `last_seen_at`, que o upsert atualiza a
   * cada carga — nenhuma coluna nova foi criada para isto.
   */
  notReturnedInLastCheck: number;

  /** Conteúdo físico preservado de antes da decisão de escopo. */
  legacyStoredContent: number;
}

type SyncRunRow = {
  id: string;
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

const CAMPOS_RUN =
  "id, completed_at, started_at, status, error, folders_seen, documents_seen, " +
  "historical_versions_seen, documents_created, versions_created, versions_orphaned";

export async function getConstrumanagerMetadataOverview(
  supabase: SupabaseClient,
  projectId: string
): Promise<ConstrumanagerMetadataOverview | null> {
  const [ultimaResult, confirmadaResult, documentsResult, versionsResult, legacyResult] =
    await Promise.all([
      supabase
        .from("construmanager_sync_runs")
        .select(CAMPOS_RUN)
        .eq("project_id", projectId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("construmanager_sync_runs")
        .select(CAMPOS_RUN)
        .eq("project_id", projectId)
        .in("status", ["SUCESSO", "PARCIAL"])
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
      supabase
        .from("construmanager_content_links")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("download_status", "ARMAZENADO"),
    ]);

  const ultima = (ultimaResult.data as SyncRunRow | null) ?? null;
  const confirmada = (confirmadaResult.data as SyncRunRow | null) ?? null;

  // Projeto sem nenhuma execução e sem nada armazenado: a UI mostra
  // "ainda não sincronizado" em vez de zeros que parecem resultado.
  if (!ultima && !documentsResult.count && !versionsResult.count) {
    return null;
  }

  // Estas duas dependem da execução confirmada, então só são consultadas
  // quando ela existe.
  let newRevisions = 0;
  let notReturnedInLastCheck = 0;

  if (confirmada) {
    const [transicoesResult, naoRetornadosResult] = await Promise.all([
      supabase
        .from("construmanager_version_transitions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("sync_run_id", confirmada.id),
      supabase
        .from("construmanager_documents")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .lt("last_seen_at", confirmada.started_at),
    ]);

    newRevisions = transicoesResult.count ?? 0;
    notReturnedInLastCheck = naoRetornadosResult.count ?? 0;
  }

  const status = ultima?.status;

  const statusNormalizado =
    status === "SUCESSO" || status === "ERRO" || status === "PARCIAL" ? status : null;

  return {
    lastSyncAt: ultima?.completed_at ?? ultima?.started_at ?? null,
    lastSyncStatus: statusNormalizado,
    lastSyncError: ultima?.error ?? null,

    lastConfirmedSyncAt: confirmada?.completed_at ?? confirmada?.started_at ?? null,
    showingPreviousTotals:
      statusNormalizado === "ERRO" && confirmada !== null && confirmada.id !== ultima?.id,

    foldersSeen: confirmada?.folders_seen ?? 0,
    documentsSeen: confirmada?.documents_seen ?? 0,
    historicalVersionsSeen: confirmada?.historical_versions_seen ?? 0,
    documentsCreated: confirmada?.documents_created ?? 0,
    versionsCreated: confirmada?.versions_created ?? 0,
    versionsOrphaned: confirmada?.versions_orphaned ?? 0,

    storedDocuments: documentsResult.count ?? 0,
    storedVersions: versionsResult.count ?? 0,

    newRevisions,
    notReturnedInLastCheck,
    legacyStoredContent: legacyResult.count ?? 0,
  };
}
