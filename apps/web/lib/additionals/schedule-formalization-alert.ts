// "ALERTA DE PRAZO" (seção do requisito) — puro, determinístico, sem IA:
// CONTRATADO + impacto de prazo relevante + extensão não aprovada ⇒
// "ADICIONAL CONTRATADO COM PRAZO AINDA NÃO FORMALIZADO". Execução já
// iniciada eleva a severidade — nunca inferido pela IA, sempre regra
// fixa (mesmo princípio de compute-obligation-risk.ts do módulo ESG).

import type { ExpertSeverity } from "../ai/types";
import type { AdditionalProposal } from "./types";

const SCHEDULE_NOT_YET_FORMALIZED_STATUSES: AdditionalProposal["scheduleExtensionStatus"][] = [
  "NOT_EVALUATED",
  "TO_BE_REQUESTED",
  "REQUESTED",
  "PARTIALLY_APPROVED",
  "REJECTED",
];

export interface ScheduleFormalizationAlert {
  active: boolean;
  message: string | null;
  severity: ExpertSeverity;
}

export function computeScheduleFormalizationAlert(proposal: AdditionalProposal): ScheduleFormalizationAlert {
  const active = proposal.status === "CONTRACTED" && SCHEDULE_NOT_YET_FORMALIZED_STATUSES.includes(proposal.scheduleExtensionStatus);

  if (!active) {
    return { active: false, message: null, severity: "LOW" };
  }

  return {
    active: true,
    message: "ADICIONAL CONTRATADO COM PRAZO AINDA NÃO FORMALIZADO",
    // Execução já iniciada sem prazo formalizado eleva a materialidade do risco.
    severity: proposal.executionStarted ? "HIGH" : "MEDIUM",
  };
}
