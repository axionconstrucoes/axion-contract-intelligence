import type { AlertSeverity, ContractEvent } from "@axion/types";

// Achado IA/Risco do Dashboard (indicador executivo) — maior severidade
// entre os achados de IA já existentes nos eventos do projeto. Nunca
// classifica nada novo: só lê event.aiAssessment.severity, já
// calculado/gravado pelo pipeline de confronto. Eventos sem achado de
// IA são ignorados (null não é "BAIXA" — ausência de achado é
// diferente de achado de risco baixo).
const SEVERITY_RANK: Record<AlertSeverity, number> = { BAIXA: 0, MEDIA: 1, ALTA: 2, CRITICA: 3 };

export function highestEventSeverity(events: Pick<ContractEvent, "aiAssessment">[]): AlertSeverity | null {
  let highest: AlertSeverity | null = null;
  for (const event of events) {
    const severity = event.aiAssessment?.severity;
    if (!severity) continue;
    if (highest === null || SEVERITY_RANK[severity] > SEVERITY_RANK[highest]) {
      highest = severity;
    }
  }
  return highest;
}
