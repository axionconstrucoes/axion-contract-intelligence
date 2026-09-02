// Único ponto de decisão de "este document.kind mostra o painel Anexos
// do Contrato?" — mesmo princípio de
// lib/documents/document-kind-card-appearance.ts: nunca comparar
// document.kind === "CONTRATO_BASE" inline em mais de um lugar
// (page.tsx e document-card.tsx importam daqui, nunca reimplementam).
export function isContractAttachmentEligibleKind(kind: string): boolean {
  return kind === "CONTRATO_BASE";
}
