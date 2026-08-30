import type { SupabaseClient } from "@supabase/supabase-js";

// REGRA CANÔNICA ÚNICA para "documento ativo" (nunca na lixeira) — todo
// caller que lista/resolve documents/document_versions/clauses para
// Experts IA, confronto, revisão de cláusulas, ESG/SSMA, cronograma,
// seleção de evidências, propostas de adicionais ou qualquer outra
// análise/listagem operacional usa UM destes dois helpers, nunca um
// filtro divergente reimplementado por arquivo.
//
// O FALLBACK só pode disparar para 42703 (undefined_column — a
// migration 20260829150000 ainda não foi aplicada nesse banco, então
// nenhum documento pode estar na lixeira). QUALQUER outro erro
// (permission denied, timeout, rede, erro de programação) é sempre
// propagado — nunca fail-open, nunca "documento ativo" por padrão.

type QueryResult<T> = { data: T | null; error: { code?: string; message: string } | null };

// Para consultas cujo PRIMEIRO acesso à tabela `documents` já pode
// levar o filtro `.is("deleted_at", null)` embutido — chame
// `buildQuery(true)` primeiro; se falhar com 42703, o wrapper chama
// de novo com `buildQuery(false)` (mesma consulta, sem o filtro).
// Qualquer outro erro é devolvido tal como veio, para o caller aplicar
// seu próprio tratamento (22P02 etc.) sem duplicar a lógica de
// fallback em cada arquivo.
export async function withActiveDocumentFilter<T>(
  buildQuery: (filterActive: boolean) => PromiseLike<QueryResult<T>>
): Promise<QueryResult<T>> {
  const filtered = await buildQuery(true);
  if (!filtered.error || filtered.error.code !== "42703") {
    return filtered;
  }
  return buildQuery(false);
}

// Para consultas que resolvem document_version/clause/documento por um
// caminho que NÃO passa primeiro por um SELECT filtrável em
// `documents` (ex.: buscar uma versão específica pelo próprio id) —
// depois de saber o(s) document_id envolvido(s), chame isto para
// confirmar que nenhum deles está na lixeira. 42703 = nenhuma lixeira
// possível nesse banco, todos os ids são tratados como ativos.
// Qualquer outro erro é lançado, nunca silenciado.
export async function resolveNonTrashedDocumentIds(
  supabase: SupabaseClient,
  documentIds: string[]
): Promise<Set<string>> {
  if (documentIds.length === 0) {
    return new Set();
  }

  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .in("id", documentIds)
    .is("deleted_at", null);

  if (error) {
    if (error.code === "42703") {
      return new Set(documentIds);
    }
    throw new Error(`Falha ao verificar documentos na lixeira: ${error.message}`);
  }

  return new Set((data as unknown as { id: string }[]).map((row) => row.id));
}
