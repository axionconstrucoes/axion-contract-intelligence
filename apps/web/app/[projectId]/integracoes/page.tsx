import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IntegrationStatusBadge } from "@/components/shared/badges";
import { getIntegrationConfigs, getSourceDefinitions } from "@/lib/data";
import { formatDateTime } from "@/lib/labels";

export default async function IntegracoesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const sources = getSourceDefinitions();
  const configs = await getIntegrationConfigs(projectId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">
          Administração de Integrações
        </h1>

        <p className="text-sm text-muted-foreground">
          Status operacional das fontes configuradas para este projeto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {sources.map((source) => {
          const config = configs.find(
            (item) => item.sourceType === source.type
          );

          return (
            <Card key={source.type}>
              <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                <CardTitle>{source.label}</CardTitle>

                {config && (
                  <IntegrationStatusBadge status={config.status} />
                )}
              </CardHeader>

              <CardContent className="flex flex-col gap-1 pt-0 text-sm text-muted-foreground">
                <p>{source.description}</p>

                {config ? (
                  <p className="text-xs">
                    {config.detail || "Integração configurada."}

                    {config.lastSyncAt && (
                      <>
                        {" "}
                        · Última sincronização:{" "}
                        {formatDateTime(config.lastSyncAt)}
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-xs">
                    Integração ainda não configurada para este projeto.
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
