// Agrupamento da aba Documentos em "Contrato-base | Anexos ao
// contrato-base", "Aditivo 01 | Anexos ao Aditivo 01", etc.
//
// Puro (sem I/O, sem "server-only") — recebe só os campos que precisa
// (id/kind/createdAt/parentDocumentId), nunca infere vínculo pelo nome
// do documento. `parentDocumentId` precisa vir de um vínculo real e
// persistido no banco — o schema para isso já existe (migration
// 20260829090000_document_contractual_attachment_linkage.sql,
// contractual_parent_document_id), mas AINDA NÃO FOI APLICADA (ver
// relatório, "Compatibilidade de deploy") — document-management.ts
// continua populando este campo como null até lá. Com entrada 100%
// null, esta função produz honestamente "um grupo por CONTRATO_BASE/
// ADITIVO, zero anexos cada" — nunca fabrica um vínculo que não existe.
//
// Invariantes garantidos:
//   - um documento com parentDocumentId apontando para um grupo aparece
//     SOMENTE dentro do grupo desse pai — nunca de novo na lista geral
//     (ungrouped) nem em outro grupo;
//   - anexos de grupos diferentes nunca se misturam;
//   - nenhum documento aparece duas vezes (nem entre grupos, nem entre
//     grupo e ungrouped).
const BORDO_INSTRUMENT_KINDS = new Set(["CONTRATO_BASE", "ADITIVO"]);

export type GroupableDocument = {
  id: string;
  kind: string;
  createdAt: string;
  // Vínculo real e persistido com o documento pai (contrato-base ou
  // aditivo) — null quando não há vínculo (hoje: sempre null, ver
  // comentário acima). NUNCA inferido por nome/título pelo chamador.
  parentDocumentId: string | null;
};

export type ContractualDocumentGroup<T extends GroupableDocument> = {
  // "Contrato-base" para o único documento CONTRATO_BASE; "Aditivo 01",
  // "Aditivo 02", ... para cada ADITIVO, na ordem de criação
  // (createdAt) — nunca por um número extraído do título.
  label: string;
  principal: T;
  attachments: T[];
};

export type GroupedContractualDocuments<T extends GroupableDocument> = {
  groups: ContractualDocumentGroup<T>[];
  // Documentos que não são o instrumento contratual (CONTRATO_BASE/
  // ADITIVO) em si e também não têm parentDocumentId apontando para um
  // dos grupos acima — sem vínculo contratual conhecido, continuam na
  // lista geral (não removidos, não escondidos).
  ungrouped: T[];
};

// Ordena os candidatos a "pai contratual" (contrato-base primeiro,
// depois aditivos em ordem de criação) e devolve os rótulos
// "Contrato-base"/"Aditivo NN" — MESMA lógica usada pelo agrupamento
// abaixo e pelo dropdown "Vincular como anexo contratual"
// (link-contractual-attachment-control.tsx), para as duas UIs nunca
// divergirem sobre o rótulo de um mesmo documento.
export function sortAndLabelContractualPrincipals<T extends GroupableDocument>(
  documents: readonly T[]
): Array<{ label: string; principal: T }> {
  const principals = documents
    .filter((document) => BORDO_INSTRUMENT_KINDS.has(document.kind))
    .slice()
    .sort((a, b) => {
      // Contrato-base sempre primeiro; entre aditivos, ordem de criação
      // (mais antigo primeiro) — nunca por um número extraído do título.
      if (a.kind !== b.kind) {
        return a.kind === "CONTRATO_BASE" ? -1 : 1;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });

  let aditivoCount = 0;
  return principals.map((principal) => ({
    label:
      principal.kind === "CONTRATO_BASE"
        ? "Contrato-base"
        : `Aditivo ${String((aditivoCount += 1)).padStart(2, "0")}`,
    principal,
  }));
}

// Títulos de exibição EXATOS exigidos pelo layout visual da aba
// Documentos (CONTRATO-BASE / ANEXOS AO CONTRATO-BASE / ADITIVO
// CONTRATUAL NN / ANEXOS AO ADITIVO CONTRATUAL NN) — derivados sempre
// do MESMO `label` que sortAndLabelContractualPrincipals já produz
// (nunca uma segunda fonte de verdade sobre "qual é o número deste
// aditivo").
export function deriveContractualGroupTitles(label: string): {
  principalTitle: string;
  attachmentsTitle: string;
} {
  if (label === "Contrato-base") {
    return { principalTitle: "CONTRATO-BASE", attachmentsTitle: "ANEXOS AO CONTRATO-BASE" };
  }
  const match = /^Aditivo (\d+)$/.exec(label);
  const number = match ? match[1] : label;
  return {
    principalTitle: `ADITIVO CONTRATUAL ${number}`,
    attachmentsTitle: `ANEXOS AO ADITIVO CONTRATUAL ${number}`,
  };
}

export function groupDocumentsByContractualStructure<
  T extends GroupableDocument,
>(documents: readonly T[]): GroupedContractualDocuments<T> {
  const labeledPrincipals = sortAndLabelContractualPrincipals(documents);

  const attachmentsByParentId = new Map<string, T[]>();
  for (const document of documents) {
    if (!document.parentDocumentId) continue;
    const list = attachmentsByParentId.get(document.parentDocumentId) ?? [];
    list.push(document);
    attachmentsByParentId.set(document.parentDocumentId, list);
  }

  const groups: ContractualDocumentGroup<T>[] = labeledPrincipals.map(({ label, principal }) => ({
    label,
    principal,
    attachments: attachmentsByParentId.get(principal.id) ?? [],
  }));

  const principalIds = new Set(labeledPrincipals.map(({ principal }) => principal.id));
  const groupedAttachmentIds = new Set(
    groups.flatMap((group) => group.attachments.map((attachment) => attachment.id))
  );

  const ungrouped = documents.filter(
    (document) => !principalIds.has(document.id) && !groupedAttachmentIds.has(document.id)
  );

  return { groups, ungrouped };
}
