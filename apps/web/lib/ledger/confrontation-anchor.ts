// Âncora estável e única por candidato de confrontação Evento x Cláusula
// na página do evento — mesma convenção usada pelo id= renderizado na
// seção "Confrontação contratual" quanto pelo link HTTPS montado no bloco
// de confronto do e-mail de alerta (send-alert-actions.ts). Espelha
// evidence-anchor.ts — nunca duplicada em nenhum dos dois lugares.
export function confrontationAnchorId(candidateId: string): string {
  return `confronto-${candidateId}`;
}
