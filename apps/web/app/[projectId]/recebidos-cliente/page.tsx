import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function RecebidosClientePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await params;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Recebidos do cliente"
        description="Edital, memorial, RFP, RFI, esclarecimentos, respostas aos questionamentos, planilhas, projetos e demais documentos recebidos do cliente."
      />

      <Card>
        <CardHeader>
          <CardTitle>Documentos recebidos do cliente</CardTitle>
        </CardHeader>

        <CardContent>
          <p className="text-sm text-muted-foreground">
            Área destinada ao upload e à organização dos documentos fornecidos pelo cliente durante a concorrência e durante a execução contratual.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}