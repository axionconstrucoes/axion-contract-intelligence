// Extração pura (sem I/O) do ContextContractualLink de uma linha crua
// de `documents` — usada por build-event-context.ts quando monta
// ContextClause.contractualLink.
//
// PRONTA PARA A MIGRATION 20260829090000, MAS AINDA NÃO CONECTADA ao
// context builder real nesta rodada — ver relatório, "Ordem segura de
// implantação": build-event-context.ts continua selecionando só
// "id,kind,title" de documents (nunca as colunas contractual_*, que
// ainda não existem no banco usado hoje) e populando contractualLink
// como null. Esta função existe para ser testada isoladamente com
// dados MOCADOS agora, e ligada ao builder real numa rodada futura.
//
// Transporta só FATOS (pai, tipo do pai, fundamento, quem/quando
// vinculou, versão vigente do pai) — nunca uma conclusão de
// precedência pré-computada. Ver comentário em ./types.ts
// (ContextContractualLink) e a seção "Hierarquia de precedência" em
// apps/web/lib/ai/experts/legal-consultant/identity.ts para como o
// Expert deve usar estes fatos.
import type { ContextContractualLink } from "./types";

export type DocumentContractualLinkContextRow = {
  contractual_parent_document_id: string | null;
  contractual_incorporation_basis: string | null;
  contractual_linked_by_user_id: string | null;
  contractual_linked_at: string | null;
};

export type ContractualParentDocumentRow = {
  id: string;
  kind: "CONTRATO_BASE" | "ADITIVO";
  title: string;
};

export function mapContractualLinkContext(
  childRow: DocumentContractualLinkContextRow,
  parentById: ReadonlyMap<string, ContractualParentDocumentRow>,
  parentCurrentVersionLabelById: ReadonlyMap<string, string>
): ContextContractualLink | null {
  const parentId = childRow.contractual_parent_document_id;
  if (!parentId) {
    return null;
  }

  const parent = parentById.get(parentId);
  if (!parent) {
    // Vínculo aponta para um documento pai não resolvido no lote
    // atual — nunca inventa um pai; melhor omitir o vínculo do que
    // fabricar dados.
    return null;
  }

  if (
    !childRow.contractual_incorporation_basis ||
    !childRow.contractual_linked_by_user_id ||
    !childRow.contractual_linked_at
  ) {
    // Consistência já é garantida no banco (CHECK constraint da
    // migration), mas esta função nunca confia cegamente num dado
    // externo — sem os três, não monta um vínculo parcial/inválido.
    return null;
  }

  return {
    parentDocumentId: parent.id,
    parentDocumentKind: parent.kind,
    parentDocumentTitle: parent.title,
    parentCurrentVersionLabel: parentCurrentVersionLabelById.get(parent.id) ?? null,
    incorporationBasis: childRow.contractual_incorporation_basis,
    linkedByUserId: childRow.contractual_linked_by_user_id,
    linkedAt: childRow.contractual_linked_at,
  };
}
