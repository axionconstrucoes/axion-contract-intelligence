import { createSupabaseServerClient } from "@axion/db/server";
import { CompleteStartupButton } from "@/components/startup/complete-startup-button";
import { HistoricalFindingCard } from "@/components/startup/historical-finding-card";
import { StartupConfigForm } from "@/components/startup/startup-config-form";
import { EmptyState } from "@/components/shared/empty-state";
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
      <div>
        <h1 className="text-lg font-semibold">Start-up ACC</h1>
        <p className="text-sm text-muted-foreground">
          Validação dos riscos históricos antes de ativar o acompanhamento operacional — o ACC conhece todo o
          passado do projeto, mas nunca trata fato histórico já pacificado como ocorrência nova.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cabeçalho</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p>Data de início da obra: {summary.config.projectStartDate ? formatDate(summary.config.projectStartDate) : "Não configurada"}</p>
            <p>Data de início operacional ACC: {formatDate(summary.config.accOperationalStartDate)}</p>
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
        <h2 className="text-sm font-semibold">Findings históricos ALTO/CRÍTICO</h2>
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
