import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IntegrationStatusSummary } from "@/components/dashboard/integration-status-summary";
import {
  AditivosCard,
  AdditionalProposalsCard,
  AlertsSummaryCard,
  EmailSummaryCard,
  EsgCard,
  FinancialProgressCard,
  GeneralSituationCard,
  PhysicalProgressCard,
  SlaActionsCard,
} from "@/components/dashboard-visual/summary-cards";
import { ContractValueCard } from "@/components/dashboard-visual/contract-value-card";
import { DeadlineCard } from "@/components/dashboard-visual/deadline-card";
import { SourceVolumeTable } from "@/components/dashboard-visual/source-volume-table";
import { CeoConsolidationCard, ExpertsCard } from "@/components/dashboard-visual/experts-cards";
import { TimeRangeFilter } from "@/components/dashboard-visual/time-range-filter";
import { formatCurrency } from "@/lib/labels";
import { getDashboardVisualData } from "@/lib/dashboard-visual/get-dashboard-visual-data";

export const metadata: Metadata = { title: "Dashboard Visual" };

export default async function DashboardVisualPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { projectId } = await params;
  const resolvedSearchParams = await searchParams;
  const data = await getDashboardVisualData(projectId, resolvedSearchParams);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/${projectId}/dashboard`} className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Voltar ao Dashboard
        </Link>
        <h1 className="text-lg font-semibold">
          <span className="text-black dark:text-white">AXION CONTROLE DE CONTRATOS</span>
          <span className="text-black dark:text-white"> — </span>
          <span className="text-red-900 dark:text-red-500">Dashboard Visual</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Projeto: {data.project?.name ?? "Projeto não disponível"} · Código: {data.project?.code ?? "NÃO DISPONÍVEL"}
        </p>
      </div>

      <TimeRangeFilter current={data.range.option} from={data.range.from?.slice(0, 10) ?? ""} to={data.range.to.slice(0, 10)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GeneralSituationCard situation={data.generalSituation} />
        <AlertsSummaryCard summary={data.activeFindingsSummary} />
      </div>

      <EmailSummaryCard summary={data.emailSummary} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PhysicalProgressCard />
        <FinancialProgressCard />
      </div>

      <ContractValueCard table={data.contractValueTable} formatCurrency={formatCurrency} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AditivosCard summary={data.aditivosSummary} formatCurrency={formatCurrency} />
        <DeadlineCard summary={data.deadlineSummary} />
      </div>

      <AdditionalProposalsCard summary={data.additionalProposalsSummary} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EsgCard summary={data.esgSummary} />
        <SlaActionsCard summary={data.slaSummary} />
      </div>

      <SourceVolumeTable rows={data.sourceVolume.rows} totals={data.sourceVolume.totals} />

      <IntegrationStatusSummary projectId={projectId} groups={data.integrationStatusGroups} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExpertsCard findings={data.recentFindings} />
        <CeoConsolidationCard finding={data.ceoFinding} />
      </div>
    </div>
  );
}
