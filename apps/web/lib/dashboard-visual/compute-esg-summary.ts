// Card ESG/SSMA (seção 13) — "ocorrências" = obrigações ativas
// configuradas; "abertas" = obrigações cuja comprovação mais recente
// ainda não está CUMPRIDO/NAO_APLICAVEL/DISPENSADO (ou que nunca
// tiveram nenhuma comprovação registrada); Baixo/Médio/Alto/Crítico =
// riskLevel já persistido na comprovação mais recente de cada
// obrigação (computeObligationRisk já roda no momento do registro —
// nunca recalculado aqui); "evidências pendentes" = comprovações cuja
// obrigação exige evidência e não têm nenhuma anexada.
//
// Puro, sem I/O.

import type { EsgObligation, EsgObligationEvidence, EsgObligationSubmission, EsgRiskLevel } from "@/lib/esg/types";

const OPEN_STATUSES = new Set(["PENDENTE", "CUMPRIDO_PARCIALMENTE", "NAO_CUMPRIDO"]);

export interface EsgSummary {
  occurrences: number;
  open: number;
  countsByRisk: Record<EsgRiskLevel, number>;
  evidencePending: number;
  lastUpdatedAt: string | null;
}

function latestSubmissionByObligation(submissions: EsgObligationSubmission[]): Map<string, EsgObligationSubmission> {
  const latest = new Map<string, EsgObligationSubmission>();
  for (const submission of submissions) {
    const current = latest.get(submission.obligationId);
    if (!current || new Date(submission.referenceDate).getTime() > new Date(current.referenceDate).getTime()) {
      latest.set(submission.obligationId, submission);
    }
  }
  return latest;
}

export function computeEsgSummary(
  obligations: EsgObligation[],
  submissions: EsgObligationSubmission[],
  evidence: EsgObligationEvidence[]
): EsgSummary {
  const activeObligations = obligations.filter((o) => o.active);
  const latestByObligation = latestSubmissionByObligation(submissions);
  const evidenceCountBySubmission = new Map<string, number>();
  for (const item of evidence) {
    evidenceCountBySubmission.set(item.submissionId, (evidenceCountBySubmission.get(item.submissionId) ?? 0) + 1);
  }

  const countsByRisk: Record<EsgRiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  let open = 0;
  let evidencePending = 0;
  let lastUpdatedAt: string | null = null;

  for (const obligation of activeObligations) {
    const submission = latestByObligation.get(obligation.id) ?? null;

    if (!submission || OPEN_STATUSES.has(submission.status)) open += 1;

    if (submission?.riskLevel) {
      countsByRisk[submission.riskLevel] += 1;
      if (!lastUpdatedAt || new Date(submission.updatedAt).getTime() > new Date(lastUpdatedAt).getTime()) {
        lastUpdatedAt = submission.updatedAt;
      }
    }

    if (submission && obligation.requiredEvidenceDescription && (evidenceCountBySubmission.get(submission.id) ?? 0) === 0) {
      evidencePending += 1;
    }
  }

  return { occurrences: activeObligations.length, open, countsByRisk, evidencePending, lastUpdatedAt };
}
