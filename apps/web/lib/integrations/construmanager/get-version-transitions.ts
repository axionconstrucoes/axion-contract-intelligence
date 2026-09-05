// Leitura das transições de versão vigente para o painel do ACC.
//
// Só SELECT, sempre pelo client de sessão: a view roda com
// `security_invoker = true`, então a RLS de
// construmanager_version_transitions (membros do projeto) continua
// valendo. Nenhuma credencial e nenhuma chamada à API acontecem aqui.
//
// Por que existe: gravar apenas em audit_log_entries não atende ao
// requisito de *sabermos* que uma nova versão está vigente — ninguém
// abre o log de auditoria todo dia. A transição precisa aparecer onde a
// pessoa já olha.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Onde está o conteúdo desta versão, no momento da leitura.
 *
 * Derivado do vínculo de conteúdo, nunca de um download: um item de
 * referência externa é reportado como tal sem que nada seja baixado.
 */
export type TransitionContentStatus =
  | "ARMAZENADO_NO_ACC"
  | "PENDENTE"
  | "SOMENTE_NO_CONSTRUMANAGER";

export interface ConstrumanagerVersionTransition {
  id: string;
  objectId: number;
  documentName: string | null;
  previousRevision: string | null;
  newRevision: string;
  detectedAt: string;
  sourceCreatedAt: string | null;
  authorName: string | null;
  sizeBytes: number | null;
  folderPath: string | null;
  contentStatus: TransitionContentStatus;
}

export interface ConstrumanagerVersionTransitionsOverview {
  total: number;
  items: ConstrumanagerVersionTransition[];
}

/**
 * Teto de linhas exibidas.
 *
 * O painel mostra as transições RECENTES, não o histórico completo — o
 * ledger imutável guarda tudo e continua auditável por consulta. Uma
 * lista longa aqui esconderia justamente a novidade.
 */
const RECENT_LIMIT = 10;

type TransitionRow = {
  id: string;
  construmanager_object_id: number;
  document_name: string | null;
  previous_revision: string | null;
  new_revision: string;
  detected_at: string;
  source_created_at: string | null;
  author_name: string | null;
  size_bytes: number | null;
  folder_path: string | null;
  content_status: string;
};

function normalizeContentStatus(raw: string): TransitionContentStatus {
  if (raw === "ARMAZENADO_NO_ACC" || raw === "SOMENTE_NO_CONSTRUMANAGER") {
    return raw;
  }
  return "PENDENTE";
}

export async function getConstrumanagerVersionTransitions(
  supabase: SupabaseClient,
  projectId: string
): Promise<ConstrumanagerVersionTransitionsOverview | null> {
  const { data, error } = await supabase
    .from("construmanager_recent_version_transitions")
    .select(
      "id, construmanager_object_id, document_name, previous_revision, new_revision, detected_at, source_created_at, author_name, size_bytes, folder_path, content_status"
    )
    .eq("project_id", projectId)
    .order("detected_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error || !data) return null;

  const rows = data as unknown as TransitionRow[];

  return {
    total: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      objectId: row.construmanager_object_id,
      documentName: row.document_name,
      previousRevision: row.previous_revision,
      newRevision: row.new_revision,
      detectedAt: row.detected_at,
      sourceCreatedAt: row.source_created_at,
      authorName: row.author_name,
      sizeBytes:
        row.size_bytes === null || row.size_bytes === undefined
          ? null
          : Number(row.size_bytes),
      folderPath: row.folder_path,
      contentStatus: normalizeContentStatus(row.content_status),
    })),
  };
}
