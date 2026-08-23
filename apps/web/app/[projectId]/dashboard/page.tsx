import type { Metadata } from "next";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { AlertCard } from "@/components/dashboard/alert-card";
import { IntegrationStatusSummary } from "@/components/dashboard/integration-status-summary";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { getAlerts, getEvents, getIntegrationConfigs, getSourceDefinitions } from "@/lib/data";
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard de Alertas"
        description="Possíveis implicações contratuais identificadas pela IA — toda sugestão exige revisão humana."
      />

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Alertas ativos</p>
            <p className="text-2xl font-semibold">{alerts.filter((a) => !a.acknowledged).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Eventos no Ledger</p>
            <p className="text-2xl font-semibold">{events.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Eventos em aberto</p>
            <p className="text-2xl font-semibold">{unresolved}</p>
          </CardContent>
        </Card>
      </div>

      <IntegrationStatusSummary projectId={projectId} groups={integrationStatusGroups} />

      <div className="flex flex-col gap-3">
        {alerts.length === 0 ? (
          <EmptyState message="Nenhum alerta para este projeto." />
        ) : (
          alerts.map((alert) => <AlertCard key={alert.id} alert={alert} projectId={projectId} />)
        )}
      </div>

      <ExpertQueryPanel projectId={projectId} scope="PROJECT" />
    </div>
  );
}
