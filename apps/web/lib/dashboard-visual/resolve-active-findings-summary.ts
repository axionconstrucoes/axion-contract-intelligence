// Alertas do Dashboard Visual (seções 7/8) — a fonte real é ai_findings
// (getAlerts em lib/data.ts é mock morto, sempre retorna []; nunca
// reutilizado aqui). "Ativos" exclui lifecycle_status já concluídos:
// RESOLVED/REJECTED/SUPERSEDED (fluxo normal) e DISMISSED_AT_STARTUP/
// RESOLVED_BEFORE_GO_LIVE (fluxo de Start-up ACC) — NEW/PENDING_HUMAN_
// REVIEW/ACKNOWLEDGED/HISTORICAL_PENDING_STARTUP_REVIEW/ACTION_CREATED
// permanecem ativos (uma ação criada ainda está em andamento, não é uma
// resolução do finding em si).
//
// Puro, sem I/O — testável tanto pelo bundler do Next.js quanto por um
// script Node standalone.

import type { AlertSeverity } from "@axion/types";
import { confrontationSeverityToAlertSeverity } from "@/lib/labels";
import type { AiFinding, AiFindingLifecycleStatus } from "@/lib/additionals/findings/types";

const INACTIVE_LIFECYCLE_STATUSES: AiFindingLifecycleStatus[] = [
  "RESOLVED",
  "REJECTED",
  "SUPERSEDED",
  "DISMISSED_AT_STARTUP",
  "RESOLVED_BEFORE_GO_LIVE",
];

export function isFindingActive(finding: AiFinding): boolean {
  return !INACTIVE_LIFECYCLE_STATUSES.includes(finding.lifecycleStatus);
}

export interface ActiveFindingsSummary {
  countsBySeverity: Record<AlertSeverity, number>;
  totalActive: number;
}

export function resolveActiveFindingsSummary(findings: AiFinding[]): ActiveFindingsSummary {
  const countsBySeverity: Record<AlertSeverity, number> = { BAIXA: 0, MEDIA: 0, ALTA: 0, CRITICA: 0 };
  let totalActive = 0;

  for (const finding of findings) {
    if (!isFindingActive(finding)) continue;
    const severity = confrontationSeverityToAlertSeverity[finding.severity];
    countsBySeverity[severity] += 1;
    totalActive += 1;
  }

  return { countsBySeverity, totalActive };
}

export type GeneralSituation = "SEM_RISCO_ATIVO" | AlertSeverity;

const SEVERITY_RANK: Record<AlertSeverity, number> = { BAIXA: 0, MEDIA: 1, ALTA: 2, CRITICA: 3 };

/**
 * Situação geral do contrato — determinística, derivada do maior risco
 * ATIVO (nunca chama IA). SEM_RISCO_ATIVO quando não há nenhum finding
 * ativo no momento.
 */
export function resolveGeneralSituation(findings: AiFinding[]): GeneralSituation {
  let highest: AlertSeverity | null = null;
  for (const finding of findings) {
    if (!isFindingActive(finding)) continue;
    const severity = confrontationSeverityToAlertSeverity[finding.severity];
    if (!highest || SEVERITY_RANK[severity] > SEVERITY_RANK[highest]) highest = severity;
  }
  return highest ?? "SEM_RISCO_ATIVO";
}
