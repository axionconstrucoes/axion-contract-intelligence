import type { Metadata } from "next";
import { BellRing, BookText, Clock, OctagonAlert } from "lucide-react";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { AlertCard } from "@/components/dashboard/alert-card";
import { DashboardVisualEntryCard } from "@/components/dashboard/dashboard-visual-entry-card";
import { IntegrationStatusSummary } from "@/components/dashboard/integration-status-summary";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  const activeAlerts = alerts.filter((a) => !a.acknowledged);
  // Hierarquia executiva (seção 5 do redesign): críticos/altos primeiro,
  // sempre visíveis — nunca reordenar por data por cima da severidade.
  const priorityAlerts = activeAlerts.filter((a) => a.severity === "CRITICA" || a.severity === "ALTA");
  const otherAlerts = alerts.filter((a) => !priorityAlerts.includes(a));

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

      {/* Nível 1 — o que exige atenção agora. */}
      <Card className={priorityAlerts.length > 0 ? "border-severity-critica/40" : undefined}>
        <CardContent className="flex items-center gap-4 p-5">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl",
              priorityAlerts.length > 0 ? "bg-severity-critica/15 text-severity-critica" : "bg-severity-baixa/15 text-severity-baixa"
            )}
          >
            <OctagonAlert className="size-6" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Atenção necessária</p>
            <p className={cn("text-4xl font-bold tracking-tight", priorityAlerts.length > 0 ? "text-severity-critica" : "text-foreground")}>
              {priorityAlerts.length}
            </p>
            <p className="text-xs text-muted-foreground">Alertas de severidade alta ou crítica ainda não reconhecidos</p>
          </div>
        </CardContent>
      </Card>

      {priorityAlerts.length > 0 && (
        <div className="flex flex-col gap-3">
          {priorityAlerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} projectId={projectId} />
          ))}
        </div>
      )}

      {/* Nível 2 — evolução contratual e pendências operacionais. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-severity-media/15 text-severity-media">
              <BellRing className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Alertas ativos</p>
              <p className="text-2xl font-semibold">{activeAlerts.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <BookText className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Eventos no Ledger</p>
              <p className="text-2xl font-semibold">{events.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-severity-alta/15 text-severity-alta">
              <Clock className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Eventos em aberto</p>
              <p className="text-2xl font-semibold">{unresolved}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DashboardVisualEntryCard projectId={projectId} />
      </div>

      <IntegrationStatusSummary projectId={projectId} groups={integrationStatusGroups} />

      {/* Nível 3 — demais alertas, informação operacional auxiliar. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {priorityAlerts.length > 0 ? "Demais alertas" : "Alertas"}
        </h2>
        {otherAlerts.length === 0 ? (
          <EmptyState message={priorityAlerts.length > 0 ? "Nenhum outro alerta para este projeto." : "Nenhum alerta para este projeto."} />
        ) : (
          otherAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} projectId={projectId} />)
        )}
      </div>

      <ExpertQueryPanel projectId={projectId} scope="PROJECT" />
    </div>
  );
}
