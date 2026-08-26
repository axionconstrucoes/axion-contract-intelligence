import type { DocumentKind } from "@axion/types";

// Único ponto de decisão do destaque visual amarelo de documento
// (contrato-base e aditivo). Baseado exclusivamente em `documents.kind`
// — nunca em nome de arquivo ou título. Toda visualização de documento
// nesta página (listagem principal e quaisquer visualizações
// equivalentes) deve chamar esta função em vez de reimplementar a regra.
//
// Lista tipada como DocumentKind[] só para checagem em tempo de
// compilação (erro de digitação vira erro de build); o Set e as
// funções abaixo operam sobre `string` porque `ManagedDocument.kind`
// (lib/document-management.ts) é a coluna crua do banco, tipada como
// string — nunca estreitada para DocumentKind nesta camada.
const HIGHLIGHTED_DOCUMENT_KINDS_LITERAL: readonly DocumentKind[] = [
  "CONTRATO_BASE",
  "ADITIVO",
];

const HIGHLIGHTED_DOCUMENT_KINDS: ReadonlySet<string> = new Set(
  HIGHLIGHTED_DOCUMENT_KINDS_LITERAL
);

export function isHighlightedDocumentKind(kind: string): boolean {
  return HIGHLIGHTED_DOCUMENT_KINDS.has(kind);
}

// Cartão/linha amarelo-claro com borda amarelo-escura e texto preto —
// só para CONTRATO_BASE e ADITIVO. `undefined` preserva o visual atual
// (não aplicar nenhuma classe) para os demais tipos.
export function getDocumentKindHighlightClassName(
  kind: string
): string | undefined {
  if (!isHighlightedDocumentKind(kind)) {
    return undefined;
  }

  return "border-2 border-yellow-600 bg-yellow-100 text-black";
}
