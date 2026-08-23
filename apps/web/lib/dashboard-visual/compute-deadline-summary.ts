// Card PRAZO (seção 12) — data inicial e prazo final original vêm
// diretamente de projects (start_date/baseline_end_date), sempre reais.
// Não existe, hoje, nenhum campo que represente formalmente um "prazo
// final vigente" (data já alterada e aprovada) nem "prazo aprovado" em
// dias — por isso ambos são sempre NÃO DISPONÍVEL, nunca inferidos do
// prazo original ou de um dos status de contract_changes (evitar
// confundir "análise técnica identificou impacto" com "prazo aprovado
// formalmente" — regra explícita do requisito: nunca considerar
// solicitado = aprovado).
//
// "Prazo solicitado" é a única métrica de dias real e somável hoje:
// technical_additional_days de contract_changes com
// scheduleImpactStatus=EXTENSION_REQUIRED (identificação técnica de
// necessidade de extensão), excluindo alterações CANCELLED.
//
// Puro, sem I/O.

import type { ContractChange } from "@axion/types";

export interface DeadlineSummary {
  startDate: string | null;
  originalEndDate: string | null;
  /** Sempre null hoje — nenhum campo modela "prazo final vigente". */
  currentEndDate: null;
  /** Soma de technicalAdditionalDays das alterações com impacto EXTENSION_REQUIRED, não canceladas. */
  requestedExtensionDays: number;
  requestedExtensionSourceCount: number;
  /** Sempre null hoje — nenhum campo modela aprovação formal de dias. */
  approvedExtensionDays: null;
}

export function computeDeadlineSummary(project: { startDate: string | null; baselineEndDate: string | null }, contractChanges: ContractChange[]): DeadlineSummary {
  const extensionRequests = contractChanges.filter(
    (c) => c.status !== "CANCELLED" && c.scheduleImpactStatus === "EXTENSION_REQUIRED" && c.technicalAdditionalDays !== null
  );

  return {
    startDate: project.startDate,
    originalEndDate: project.baselineEndDate,
    currentEndDate: null,
    requestedExtensionDays: extensionRequests.reduce((sum, c) => sum + (c.technicalAdditionalDays ?? 0), 0),
    requestedExtensionSourceCount: extensionRequests.length,
    approvedExtensionDays: null,
  };
}
