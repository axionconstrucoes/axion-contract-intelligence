import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IntegrationStatusBadge } from "@/components/shared/badges";
import { getIntegrationConfigs, getSourceDefinitions } from "@/lib/data";
import { formatDateTime } from "@/lib/labels";

export default function IntegracoesPage() {
  const sources = getSourceDefinitions();
  const configs = getIntegrationConfigs();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Administração de Integrações</h1>
        <p className="text-sm text-muted-foreground">
          Status das fontes consolidadas pela plataforma. Nesta fase, nenhuma credencial real é utilizada.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {sources.map((source) => {
          const config = configs.find((c) => c.sourceType === source.type);
          return (
            <Card key={source.type}>
              <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                <CardTitle>{source.label}</CardTitle>
                {config && <IntegrationStatusBadge status={config.status} />}
              </CardHeader>
              <CardContent className="flex flex-col gap-1 pt-0 text-sm text-muted-foreground">
                <p>{source.description}</p>
                {config && (
                  <p className="text-xs">
                    {config.detail}
                    {config.lastSyncAt && <> · Última sincronização: {formatDateTime(config.lastSyncAt)}</>}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
