// Extração pura (sem I/O, sem "server-only") dos 4 campos de vínculo
// contratual (contractual_parent_document_id/incorporation_basis/
// linked_by_user_id/linked_at) de uma linha crua de `documents`, junto
// com o nome do usuário que vinculou (resolvido via join com
// `profiles`, mesmo padrão de apps/web/lib/event-notes.ts).
//
// PRONTO PARA A MIGRATION 20260829090000, MAS AINDA NÃO CONECTADO ao
// mapper real (apps/web/lib/document-management.ts) nesta rodada — ver
// relatório, item 8 "Compatibilidade de deploy": a aplicação aponta
// hoje para um banco sem essas colunas; document-management.ts
// continua hardcoding estes campos como `null` até a migration ser
// revisada e aplicada. Esta função existe para ser testada isoladamente
// com dados MOCADOS agora, e ligada ao mapper real numa rodada futura
// com uma troca de uma linha (nenhuma reescrita necessária).
export type ContractualLinkFields = {
  parentDocumentId: string | null;
  contractualIncorporationBasis: string | null;
  contractualLinkedByUserId: string | null;
  contractualLinkedByUserName: string | null;
  contractualLinkedAt: string | null;
};

export type DocumentContractualLinkRow = {
  contractual_parent_document_id: string | null;
  contractual_incorporation_basis: string | null;
  contractual_linked_by_user_id: string | null;
  contractual_linked_at: string | null;
};

export function mapContractualLinkFields(
  row: DocumentContractualLinkRow,
  linkedByUserNameById: ReadonlyMap<string, string>
): ContractualLinkFields {
  const linkedByUserId = row.contractual_linked_by_user_id;

  return {
    parentDocumentId: row.contractual_parent_document_id,
    contractualIncorporationBasis: row.contractual_incorporation_basis,
    contractualLinkedByUserId: linkedByUserId,
    contractualLinkedByUserName: linkedByUserId ? (linkedByUserNameById.get(linkedByUserId) ?? null) : null,
    contractualLinkedAt: row.contractual_linked_at,
  };
}
