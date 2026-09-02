import type { Metadata } from "next";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { AlertCard } from "@/components/dashboard/alert-card";
import { DashboardVisualEntryCard } from "@/components/dashboard/dashboard-visual-entry-card";
import { IntegrationStatusSummary } from "@/components/dashboard/integration-status-summary";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SeverityBadge } from "@/components/shared/badges";
import { Card, CardContent } from "@/components/ui/card";
import { getAlerts, getEvents, getIntegrationConfigs, getSourceDefinitions } from "@/lib/data";
import { highestEventSeverity } from "@/lib/dashboard/highest-event-severity";
import { getEmailAccounts } from "@/lib/email/inbound/ingestion-controls/get-email-accounts";
import { getProjectEmailIngestionConfig } from "@/lib/email/inbound/ingestion-controls/get-project-email-ingestion-config";
import { resolveAllIntegrationStatuses, resolveEmailIntegrationDisplayStatus, summarizeIntegrationStatuses } from "@/lib/ui/resolve-integration-display-status";
import { createSupabaseServerClient } from "@axion/db/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const sources = getSourceDefinitions();

  const alerts = getAlerts(projectId);
  const [events, configs, accounts, ingestionConfig] = await Promise.all([
    getEvents(projectId),
    getIntegrationConfigs(projectId),
    getEmailAccounts(supabase),
    getProjectEmailIngestionConfig(supabase, projectId),
  ]);
  const unresolved = events.filter((e) => e.status !== "RESOLVIDO").length;
  const highestSeverity = highestEventSeverity(events);

  const linkedAccount = accounts.find((account) => account.id === ingestionConfig?.emailAccountId) ?? null;
  const clientDomains = ingestionConfig?.domains.filter((domain) => domain.domainRole !== "AXION") ?? [];
  const emailStatus = resolveEmailIntegrationDisplayStatus({
    configEnabled: ingestionConfig?.enabled ?? null,
    hasEmailAccount: Boolean(ingestionConfig?.emailAccountId),
    hasClientDomain: clientDomains.length > 0,
    accountStatus: linkedAccount?.status ?? null,
  });
  const integrationStatusGroups = summarizeIntegrationStatuses(resolveAllIntegrationStatuses(sources, configs, emailStatus));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard de Alertas"
        description="Possíveis implicações contratuais identificadas pela IA — toda sugestão exige revisão humana."
      />

      {/* Faixa de indicadores executivos — 1 card único com divisores,
          não 3-4 cards separados (cada indicador antes usava um Card
          inteiro de ~140px de altura para 2 linhas de conteúdo). */}
      <Card>
        <CardContent className="grid grid-cols-2 divide-y divide-border p-0 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <div className="flex flex-col gap-0.5 px-4 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Alertas ativos</p>
            <p className="text-xl font-bold tabular-nums">{alerts.filter((a) => !a.acknowledged).length}</p>
          </div>
          <div className="flex flex-col gap-0.5 px-4 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Eventos no Ledger</p>
            <p className="text-xl font-bold tabular-nums">{events.length}</p>
          </div>
          <div className="flex flex-col gap-0.5 px-4 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Em aberto</p>
            <p className="text-xl font-bold tabular-nums">{unresolved}</p>
          </div>
          <div className="flex flex-col gap-1 px-4 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Achado IA / Risco</p>
            {highestSeverity ? (
              <SeverityBadge severity={highestSeverity} className="w-fit" />
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum achado</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Corpo em 2 colunas — aproveita a largura de monitores largos:
          alertas do projeto (área principal) à esquerda, módulos
          auxiliares (integrações + IA) à direita. Empilha em 1 coluna
          abaixo do breakpoint lg. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="flex flex-col gap-3">
          <DashboardVisualEntryCard projectId={projectId} />
          {alerts.length === 0 ? (
            <EmptyState message="Nenhum alerta para este projeto." />
          ) : (
            alerts.map((alert) => <AlertCard key={alert.id} alert={alert} projectId={projectId} />)
          )}
        </div>

        <div className="flex flex-col gap-4">
          <IntegrationStatusSummary projectId={projectId} groups={integrationStatusGroups} />
          <ExpertQueryPanel projectId={projectId} scope="PROJECT" />
        </div>
      </div>
    </div>
  );
}
