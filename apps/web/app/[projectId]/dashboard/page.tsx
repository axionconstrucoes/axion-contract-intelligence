import type { Metadata } from "next";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { AlertCard } from "@/components/dashboard/alert-card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { getAlerts, getEvents } from "@/lib/data";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const alerts = getAlerts(projectId);
  const events = await getEvents(projectId);
  const unresolved = events.filter((e) => e.status !== "RESOLVIDO").length;

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
