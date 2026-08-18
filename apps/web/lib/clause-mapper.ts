import type { ContractClause } from "@axion/types";

export type ClauseRow = {
  id: string;
  document_version_id: string;
  clause_number: string;
  title: string;
  text: string;
  created_at: string;
};

// Metadados do document_version pai de uma clause, resolvidos via
// clause -> document_version -> document -> project. Nunca derivados de
// IDs mock — ver getMockClause em lib/data.ts para o universo mock.
export type ClauseVersionParent = {
  documentId: string;
  projectId: string;
};

// Uma clause sempre deve resolver a um document_version -> document -> project
// reais; a ausência é inconsistência estrutural, nunca preenchida com
// fallback silencioso de projectId/documentId.
export function mapClauseRow(
  row: ClauseRow,
  parent: ClauseVersionParent | undefined
): ContractClause {
  if (!parent) {
    throw new Error(
      `Inconsistência estrutural: clause (id=${row.id}, document_version_id=${row.document_version_id}) sem document_version/document/project correspondente.`
    );
  }

  return {
    id: row.id,
    projectId: parent.projectId,
    documentId: parent.documentId,
    clauseNumber: row.clause_number,
    title: row.title,
    text: row.text,
  };
}
