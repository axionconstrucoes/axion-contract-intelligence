// Âncora estável e única por evidência na página do evento — mesma
// convenção usada tanto pelo id= renderizado por EvidenceViewer quanto
// pelo href HTTPS montado no e-mail de alerta (send-alert-actions.ts),
// nunca duplicada em nenhum dos dois lugares. Puro, sem I/O.
export function evidenceAnchorId(evidenceId: string): string {
  return `evidencia-${evidenceId}`;
}
