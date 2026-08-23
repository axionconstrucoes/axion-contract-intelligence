// Orquestração de leitura do Dashboard Visual — todas as buscas em
// Promise.all (seção 21: evitar N+1), toda a computação real fica nos
// módulos puros deste diretório (testáveis isoladamente). Nunca chama
// nenhum provider de IA (seção 16/21).
//
// Filtro temporal (seção 17): aplicado só às métricas de FLUXO que
// representam "itens que chegaram no período" — e-mails, findings
// (Alertas), comprovações ESG, volume por fonte. NÃO aplicado a
// Situação Geral (posição de risco atual), Ações/SLA (vencidas/vencem
// hoje são posição atual, não fluxo), Adicionais/Aditivos/Valor
// Contratual/Prazo (nenhum desses é uma métrica de fluxo no requisito).

import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { getAdditionalProposals } from "@/lib/additionals/get-additional-proposals";
import { getFindingsForProject } from "@/lib/additionals/findings/get-findings";
import { getCurationRunsForProject } from "@/lib/additionals/findings/curation-run";
import type { AiFinding } from "@/lib/additionals/findings/types";
import { getEmailAccounts } from "@/lib/email/inbound/ingestion-controls/get-email-accounts";
import { getProjectEmailIngestionConfig } from "@/lib/email/inbound/ingestion-controls/get-project-email-ingestion-config";
import { getLatestEmailSyncRun } from "@/lib/email/inbound/ingestion-controls/get-sync-runs";
import { getEsgObligationEvidenceForProject, getEsgObligationSubmissionsForProject, getEsgObligations } from "@/lib/esg/esg-obligations-data";
import { getSlaActions } from "@/lib/sla/sla-actions-data";
import { getContractChanges, getIntegrationConfigs, getProject, getSourceDefinitions } from "@/lib/data";
import { resolveEmailIntegrationDisplayStatus, resolveAllIntegrationStatuses, summarizeIntegrationStatuses } from "@/lib/ui/resolve-integration-display-status";

import { computeAdditionalProposalsSummary } from "./compute-additional-proposals-summary";
import { buildContractValueTable, computeAditivosContratuaisSummary, selectFormalizedAditivos } from "./compute-contract-value";
import { computeDeadlineSummary } from "./compute-deadline-summary";
import { computeEmailSummary } from "./compute-email-summary";
import { computeEsgSummary } from "./compute-esg-summary";
import { computeSlaActionsSummary } from "./compute-sla-summary";
import { computeEmailMailboxVolumeRows, computeGenericSourceVolumeRows } from "./compute-source-volume-rows";
import { getEmailVolumeRows } from "./get-email-volume-rows";
import { resolveActiveFindingsSummary, resolveGeneralSituation } from "./resolve-active-findings-summary";
import { resolveEmailProcessingSets } from "./resolve-email-processing-sets";
import { isWithinTimeRange, resolveTimeRange, type ResolvedTimeRange } from "./resolve-time-range";

export async function getDashboardVisualData(projectId: string, searchParams: { range?: string; from?: string; to?: string }) {
  const supabase = await createSupabaseServerClient();
  const sources = getSourceDefinitions();

  const [
    project,
    emailRows,
    findings,
    curationRuns,
    proposals,
    esgObligations,
    esgSubmissions,
    esgEvidence,
    slaActions,
    integrationConfigs,
    ingestionConfig,
    latestSyncRun,
    contractChanges,
    emailAccounts,
  ] = await Promise.all([
    getProject(projectId),
    getEmailVolumeRows(supabase, projectId),
    getFindingsForProject(supabase, projectId),
    getCurationRunsForProject(supabase, projectId),
    getAdditionalProposals(supabase, projectId),
    getEsgObligations(projectId),
    getEsgObligationSubmissionsForProject(projectId),
    getEsgObligationEvidenceForProject(projectId),
    getSlaActions(projectId),
    getIntegrationConfigs(projectId),
    getProjectEmailIngestionConfig(supabase, projectId),
    getLatestEmailSyncRun(supabase, projectId),
    getContractChanges(projectId),
    getEmailAccounts(supabase),
  ]);

  const range = resolveTimeRange(searchParams, new Date(), project?.startDate ?? null);

  // Status real (reutiliza integralmente o pacote publicado no commit 17c0ee3 — nunca recriado).
  const linkedAccount = emailAccounts.find((account) => account.id === ingestionConfig?.emailAccountId) ?? null;
  const clientDomains = ingestionConfig?.domains.filter((d) => d.domainRole !== "AXION") ?? [];
  const emailStatus = resolveEmailIntegrationDisplayStatus({
    configEnabled: ingestionConfig?.enabled ?? null,
    hasEmailAccount: Boolean(ingestionConfig?.emailAccountId),
    hasClientDomain: clientDomains.length > 0,
    accountStatus: linkedAccount?.status ?? null,
  });
  const integrationStatusGroups = summarizeIntegrationStatuses(resolveAllIntegrationStatuses(sources, integrationConfigs, emailStatus));

  const findingsInRange = filterFindingsByRange(findings, range);
  const activeFindingsSummary = resolveActiveFindingsSummary(findingsInRange);
  const generalSituation = resolveGeneralSituation(findings); // posição atual — nunca filtrada pelo período

  const processingSets = resolveEmailProcessingSets(curationRuns, findings);
  const emailSummary = computeEmailSummary(emailRows, processingSets, range);

  const mailboxAccounts = (ingestionConfig?.mailboxes ?? []).filter((m) => m.enabled).map((m) => ({ emailAddress: m.mailboxAddress }));
  const emailVolume = computeEmailMailboxVolumeRows(mailboxAccounts, emailRows, processingSets, range, latestSyncRun?.completedAt ?? latestSyncRun?.startedAt ?? null);
  const genericVolumeRows = computeGenericSourceVolumeRows(sources, integrationConfigs);

  const formalizedAditivos = selectFormalizedAditivos(proposals);
  const aditivosSummary = computeAditivosContratuaisSummary(formalizedAditivos);
  const contractValueTable = buildContractValueTable(formalizedAditivos, project?.startDate ?? null);

  const additionalProposalsSummary = computeAdditionalProposalsSummary(proposals);

  const deadlineSummary = computeDeadlineSummary(
    { startDate: project?.startDate ?? null, baselineEndDate: project?.baselineEndDate ?? null },
    contractChanges
  );

  const esgSubmissionsInRange = esgSubmissions.filter((s) => isWithinTimeRange(s.referenceDate, range));
  const esgSummary = computeEsgSummary(esgObligations, esgSubmissionsInRange, esgEvidence);

  const slaSummary = computeSlaActionsSummary(slaActions, new Date()); // posição atual — nunca filtrada pelo período

  return {
    project,
    range,
    integrationStatusGroups,
    activeFindingsSummary,
    generalSituation,
    emailSummary,
    sourceVolume: { rows: [...emailVolume.rows, ...genericVolumeRows], totals: emailVolume.totals },
    aditivosSummary,
    contractValueTable,
    additionalProposalsSummary,
    deadlineSummary,
    esgSummary,
    slaSummary,
    recentFindings: [...findings].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3),
    ceoFinding: findings.find((f) => f.expertIds.includes("ceo")) ?? null,
  };
}

function filterFindingsByRange(findings: AiFinding[], range: ResolvedTimeRange): AiFinding[] {
  return findings.filter((f) => isWithinTimeRange(f.createdAt, range));
}
