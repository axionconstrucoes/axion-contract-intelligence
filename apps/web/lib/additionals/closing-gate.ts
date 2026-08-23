// ClosingGateAssessment (seção "GATE DE FECHAMENTO" do requisito) — gate
// determinístico, NUNCA uma decisão de IA. IA NUNCA executa contratação;
// este módulo só consolida os status já registrados (humanos) em uma
// recomendação de prontidão, sempre sujeita a revisão humana. Mesmo
// princípio de apps/web/lib/esg/compute-obligation-risk.ts: o cálculo é
// sempre a mesma regra fixa, a IA (Diretor Comercial/Jurídico/
// Planejamento/CEO — ver curation.ts) só complementa com interpretação
// qualitativa, nunca substitui este cálculo.

import type { AdditionalProposal, AdditionalProposalApprovalStatus, AdditionalProposalScheduleExtensionStatus } from "./types";

export type ClosingGateRecommendation = "CAN_PROCEED" | "CAN_PROCEED_WITH_CONDITIONS" | "DO_NOT_PROCEED_YET" | "INSUFFICIENT_INFORMATION";

export type ClosingGateCumulativeImpactStatus = "LOW" | "MEDIUM" | "HIGH";

export interface ClosingGateAssessment {
  scopeStatus: AdditionalProposalApprovalStatus;
  commercialStatus: AdditionalProposalApprovalStatus;
  scheduleStatus: AdditionalProposalScheduleExtensionStatus;
  contractualStatus: "NOT_APPLICABLE" | "PENDING" | "COMPLETE" | "COMPLETE_WITH_RESERVATION";
  cumulativeImpactStatus: ClosingGateCumulativeImpactStatus;
  recommendation: ClosingGateRecommendation;
  missingInformation: string[];
  requiresHumanReview: true;
}

function computeContractualStatus(proposal: AdditionalProposal): ClosingGateAssessment["contractualStatus"] {
  if (proposal.status !== "CONTRACTED") return "NOT_APPLICABLE";
  if (proposal.documentalState === "CONTRATADO_FORMALIZACAO_COM_RESSALVA") return "COMPLETE_WITH_RESERVATION";
  if (proposal.documentalState === "CONTRATADO_DOCUMENTACAO_COMPLETA") return "COMPLETE";
  return "PENDING";
}

/**
 * Nunca conta a própria proposta — mede o risco de OUTRAS contratações
 * do mesmo projeto ainda sem prazo formalizado (ver
 * schedule-formalization-alert.ts), como aproximação determinística de
 * "impacto acumulado" sem depender de análise de caminho crítico real
 * (fora de escopo nesta fase — ver limitations do Diretor de
 * Planejamento IA).
 */
function computeCumulativeImpactStatus(proposal: AdditionalProposal, allProjectProposals: AdditionalProposal[]): ClosingGateCumulativeImpactStatus {
  const othersWithPendingSchedule = allProjectProposals.filter(
    (p) =>
      p.id !== proposal.id &&
      p.status === "CONTRACTED" &&
      p.scheduleExtensionStatus !== "NOT_REQUIRED" &&
      p.scheduleExtensionStatus !== "APPROVED"
  ).length;

  if (othersWithPendingSchedule >= 3) return "HIGH";
  if (othersWithPendingSchedule >= 1) return "MEDIUM";
  return "LOW";
}

export function computeClosingGateAssessment(proposal: AdditionalProposal, allProjectProposals: AdditionalProposal[] = [proposal]): ClosingGateAssessment {
  const missingInformation: string[] = [];

  if (proposal.scopeApprovalStatus === "NOT_EVALUATED") missingInformation.push("Aprovação de escopo ainda não avaliada.");
  if (proposal.commercialApprovalStatus === "NOT_EVALUATED") missingInformation.push("Aprovação comercial ainda não avaliada.");
  if (proposal.scheduleExtensionStatus === "NOT_EVALUATED") missingInformation.push("Impacto de prazo ainda não avaliado.");

  const contractualStatus = computeContractualStatus(proposal);
  const cumulativeImpactStatus = computeCumulativeImpactStatus(proposal, allProjectProposals);

  const blockers: string[] = [];
  if (proposal.scopeApprovalStatus === "REJECTED") blockers.push("Escopo rejeitado.");
  if (proposal.commercialApprovalStatus === "REJECTED") blockers.push("Condição comercial rejeitada.");
  if (proposal.scheduleExtensionStatus === "REJECTED") blockers.push("Extensão de prazo rejeitada.");

  const conditions: string[] = [];
  if (proposal.scheduleExtensionStatus === "TO_BE_REQUESTED" || proposal.scheduleExtensionStatus === "REQUESTED") {
    conditions.push("Extensão de prazo ainda não aprovada.");
  }
  if (proposal.scheduleExtensionStatus === "PARTIALLY_APPROVED") conditions.push("Extensão de prazo aprovada apenas parcialmente.");
  if (contractualStatus === "PENDING") conditions.push("Documentação da contratação ainda pendente.");
  if (contractualStatus === "COMPLETE_WITH_RESERVATION") conditions.push("Formalização com ressalva jurídica — ver reservationRisk.");

  let recommendation: ClosingGateRecommendation;
  if (missingInformation.length > 0) {
    recommendation = "INSUFFICIENT_INFORMATION";
  } else if (blockers.length > 0) {
    recommendation = "DO_NOT_PROCEED_YET";
  } else if (conditions.length > 0) {
    recommendation = "CAN_PROCEED_WITH_CONDITIONS";
  } else {
    recommendation = "CAN_PROCEED";
  }

  return {
    scopeStatus: proposal.scopeApprovalStatus,
    commercialStatus: proposal.commercialApprovalStatus,
    scheduleStatus: proposal.scheduleExtensionStatus,
    contractualStatus,
    cumulativeImpactStatus,
    recommendation,
    missingInformation: [...missingInformation, ...blockers, ...conditions],
    requiresHumanReview: true,
  };
}
