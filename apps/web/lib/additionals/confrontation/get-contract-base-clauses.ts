// Cláusulas do contrato-base e aditivos do projeto — única fonte real
// para o Consultor Jurídico IA procurar ordem de precedência/
// incorporação por referência (seção 6 do requisito). Nunca inclui
// cláusulas de outros tipos de documento (edital, proposta, etc.) — o
// confronto é sempre contra o instrumento contratual vigente.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextClause } from "../../ai/context/types";

interface ClauseRow {
  id: string;
  clause_number: string;
  title: string;
  text: string;
  document_version_id: string;
  document_versions: {
    document_id: string;
    documents: { kind: string; title: string; project_id: string; deleted_at?: string | null } | null;
  } | null;
}

/** Sempre CONTRATO_BASE + ADITIVO — o contrato-base continua o instrumento vigente, aditivos o modificam explicitamente. */
export async function getContractBaseClauses(supabase: SupabaseClient, projectId: string): Promise<ContextClause[]> {
  // deleted_at no select aninhado — 42703 (migration 20260829150000
  // ainda não aplicada nesse banco) refaz a MESMA consulta sem a
  // coluna, nunca quebra o confronto por causa disso. Sem a coluna, um
  // documento não pode estar na lixeira, então nada precisa ser
  // filtrado por ela.
  const extended = await supabase
    .from("clauses")
    .select("id,clause_number,title,text,document_version_id,document_versions(document_id,documents(kind,title,project_id,deleted_at))")
    .in("document_versions.documents.kind", ["CONTRATO_BASE", "ADITIVO"]);

  let data = extended.data;
  if (extended.error) {
    if (extended.error.code !== "42703") {
      throw new Error(`Falha ao carregar cláusulas do contrato-base: ${extended.error.message}`);
    }
    const fallback = await supabase
      .from("clauses")
      .select("id,clause_number,title,text,document_version_id,document_versions(document_id,documents(kind,title,project_id))")
      .in("document_versions.documents.kind", ["CONTRATO_BASE", "ADITIVO"]);
    if (fallback.error) throw new Error(`Falha ao carregar cláusulas do contrato-base: ${fallback.error.message}`);
    data = fallback.data;
  }

  // Um contrato-base/aditivo NA LIXEIRA nunca contribui cláusulas para
  // o confronto — mesma exigência de resolveClauses em
  // build-event-context.ts.
  const rows = (data as unknown as ClauseRow[]).filter(
    (row) =>
      row.document_versions?.documents?.project_id === projectId &&
      !row.document_versions?.documents?.deleted_at
  );

  return rows.map((row) => ({
    id: row.id,
    clauseNumber: row.clause_number,
    title: row.title,
    text: row.text,
    documentId: row.document_versions!.document_id,
    documentKind: row.document_versions!.documents!.kind,
    documentTitle: row.document_versions!.documents!.title,
    relation: "CROSS_REFERENCE" as const,
    // O documento desta cláusula É o contrato-base/aditivo (filtrado
    // acima) — nunca ele próprio um anexo vinculado a outro documento.
    contractualLink: null,
  }));
}
