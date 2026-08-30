import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@axion/db/server";
import { CompleteStartupButton } from "@/components/startup/complete-startup-button";
import { HistoricalFindingCard } from "@/components/startup/historical-finding-card";
import { StartupConfigForm } from "@/components/startup/startup-config-form";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FeatureInfo } from "@/components/shared/feature-info";
import { RiskLegend } from "@/components/shared/risk-legend";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Start-up ACC"
        description="Validação dos riscos históricos antes de ativar o acompanhamento operacional — o ACC conhece todo o passado do projeto, mas nunca trata fato histórico já pacificado como ocorrência nova."
        actions={
          <Link href={`/${projectId}/dashboard`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Dashboard
          </Link>
        }
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

          <div className="flex flex-wrap gap-2">
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
          <RiskLegend strongBaixaHighlight />
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

// Preto sólido/fonte branca (era cinza médio bg-neutral-500 — rodada
// "produção", exclusivo desta página), algarismo e legenda +1 nível na
// escala tipográfica cada (text-2xl -> text-3xl; text-[10px], que nem
// é um degrau padrão da escala, -> text-xs, o próximo degrau padrão
// real acima dele) — largura/padding continuam compactos (w-20,
// px-1.5 py-1.5), sem crescer a caixa em si, só o texto dentro dela.
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex w-20 shrink-0 flex-col items-center justify-center rounded-md bg-black px-1.5 py-1.5 text-center text-white">
      <p className="text-3xl font-semibold leading-tight">{value}</p>
      <p className="text-xs leading-tight text-white">{label}</p>
    </div>
  );
}
