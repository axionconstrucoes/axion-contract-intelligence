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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-border pb-5">
        <Link href={`/${projectId}/dashboard`} className="flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Voltar ao Dashboard
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">AXION Controle de Contratos</span>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-sidebar">Dashboard Visual</h1>
        <p className="text-sm text-muted-foreground">
          Projeto: {data.project?.name ?? "Projeto não disponível"} · Código: {data.project?.code ?? "NÃO DISPONÍVEL"}
        </p>
      </div>

      <TimeRangeFilter current={data.range.option} from={data.range.from?.slice(0, 10) ?? ""} to={data.range.to.slice(0, 10)} />

      {/* Nível 1 — situação do contrato, risco ativo e prazo: o que um
          diretor precisa ver em ~5 segundos (seção 5 do redesign). */}
      <section className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GeneralSituationCard situation={data.generalSituation} />
          <AlertsSummaryCard summary={data.activeFindingsSummary} />
        </div>
        <DeadlineCard summary={data.deadlineSummary} />
      </section>

      {/* Nível 2 — evolução contratual e pendências. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evolução contratual</h2>
        <ContractValueCard table={data.contractValueTable} formatCurrency={formatCurrency} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AditivosCard summary={data.aditivosSummary} formatCurrency={formatCurrency} />
          <AdditionalProposalsCard summary={data.additionalProposalsSummary} />
        </div>
        <SlaActionsCard summary={data.slaSummary} />
      </section>

      {/* Nível 3 — indicadores auxiliares e informação operacional. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Indicadores operacionais</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PhysicalProgressCard />
          <FinancialProgressCard />
        </div>
        <EmailSummaryCard summary={data.emailSummary} />
        <EsgCard summary={data.esgSummary} />
        <SourceVolumeTable rows={data.sourceVolume.rows} totals={data.sourceVolume.totals} />
        <IntegrationStatusSummary projectId={projectId} groups={data.integrationStatusGroups} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ExpertsCard findings={data.recentFindings} />
          <CeoConsolidationCard finding={data.ceoFinding} />
        </div>
      </section>
    </div>
  );
}
