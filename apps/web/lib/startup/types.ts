// Tipos do Start-up ACC — camada de validação humana do histórico antes
// do go-live operacional (seção 19: nunca reescreve o passado). Reutiliza
// integralmente project_start_date/acc_operational_start_date (projects),
// ai_findings/ai_curation_runs e sla_actions — nunca um segundo sistema
// paralelo.

export type StartupStatus = "NOT_STARTED" | "IN_ANALYSIS" | "IN_HUMAN_REVIEW" | "COMPLETED";

export interface ProjectStartupConfig {
  projectId: string;
  projectStartDate: string | null;
  accOperationalStartDate: string;
  startupCompletedAt: string | null;
  startupCompletedByUserId: string | null;
  historicalReviewThrough: string | null;
}

export interface StartupSummary {
  config: ProjectStartupConfig;
  status: StartupStatus;
  totalHistoricalFindings: number;
  totalHigh: number;
  totalCritical: number;
  decidedHighCritical: number;
  pendingHighCritical: number;
  /** Percentual (0-100) de findings ALTO/CRÍTICO já decididos — LOW/MEDIUM nunca bloqueiam nem contam aqui (seção 6). */
  completionPercentage: number;
}
