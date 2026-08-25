import type { Metadata } from "next";
import { createSupabaseServerClient } from "@axion/db/server";
import { CompleteStartupButton } from "@/components/startup/complete-startup-button";
import { HistoricalFindingCard } from "@/components/startup/historical-finding-card";
import { StartupConfigForm } from "@/components/startup/startup-config-form";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FeatureInfo } from "@/components/shared/feature-info";
import { RiskLegend } from "@/components/shared/risk-legend";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjectMembers } from "@/lib/data";
import { canCompleteProjectStartup } from "@/lib/startup/complete-startup";
import { getHistoricalFindings } from "@/lib/startup/get-historical-findings";
import { getStartupSummary } from "@/lib/startup/get-startup-summary";
import { formatDate } from "@/lib/labels";

const STATUS_LABELS = {
  NOT_STARTED: "Não iniciado",
  IN_ANALYSIS: "Em análise",
  IN_HUMAN_REVIEW: "Em revisão humana",
  COMPLETED: "Concluído",
} as const;

export const metadata: Metadata = { title: "Start-up ACC" };

export default async function StartupPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();

  const [summary, findings, members, { canComplete, pendingCount }] = await Promise.all([
    getStartupSummary(supabase, projectId),
    getHistoricalFindings(supabase, projectId),
    getProjectMembers(projectId),
    canCompleteProjectStartup(supabase, projectId),
  ]);

  const memberOptions = members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email }));
  const highCriticalFindings = findings.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Start-up ACC"
        description="Validação dos riscos históricos antes de ativar o acompanhamento operacional — o ACC conhece todo o passado do projeto, mas nunca trata fato histórico já pacificado como ocorrência nova."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cabeçalho</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="flex items-center gap-1.5">
              Data de início da obra: {summary.config.projectStartDate ? formatDate(summary.config.projectStartDate) : "Não configurada"}
              <FeatureInfo helpId="startup-project-start-date" />
            </p>
            <p className="flex items-center gap-1.5">
              Data de início operacional ACC: {formatDate(summary.config.accOperationalStartDate)}
              <FeatureInfo helpId="startup-acc-operational-start-date" />
            </p>
            {summary.config.projectStartDate ? (
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                Período histórico analisado: {formatDate(summary.config.projectStartDate)} → dia anterior ao início operacional
              </p>
            ) : null}
            <p className="sm:col-span-2">
              <Badge variant={summary.status === "COMPLETED" ? "default" : "secondary"}>{STATUS_LABELS[summary.status]}</Badge>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Findings históricos" value={summary.totalHistoricalFindings} />
            <Stat label="ALTO" value={summary.totalHigh} />
            <Stat label="CRÍTICO" value={summary.totalCritical} />
            <Stat label="Decididos" value={summary.decidedHighCritical} />
            <Stat label="% conclusão" value={`${summary.completionPercentage}%`} />
          </div>
        </CardContent>
      </Card>

      <StartupConfigForm projectId={projectId} config={summary.config} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            Findings históricos ALTO/CRÍTICO
            <FeatureInfo helpId="finding" />
          </h2>
          <RiskLegend />
        </div>
        {highCriticalFindings.length === 0 ? (
          <EmptyState message="Nenhum finding histórico ALTO/CRÍTICO registrado ainda — LOW/MEDIUM permanecem pesquisáveis mas não bloqueiam o Start-up." />
        ) : (
          highCriticalFindings.map((finding) => (
            <HistoricalFindingCard key={finding.id} projectId={projectId} finding={finding} memberOptions={memberOptions} />
          ))
        )}
      </div>

      {summary.status !== "COMPLETED" ? <CompleteStartupButton projectId={projectId} canComplete={canComplete} pendingCount={pendingCount} /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
