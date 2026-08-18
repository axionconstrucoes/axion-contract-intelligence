import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { scheduleStatusLabels } from "@/lib/labels";
import { getClauses, getDocuments, getScheduleActivities } from "@/lib/data";
import { formatDate } from "@/lib/labels";

export default async function DocumentosPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const documents = await getDocuments(projectId);
  const clauses = await getClauses(projectId);
  const scheduleActivities = await getScheduleActivities(projectId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Documentos</h1>
        <p className="text-sm text-muted-foreground">Contrato, aditivos, edital/RFI/RFP e cronograma do projeto.</p>
      </div>

      <Tabs defaultValue="documentos">
        <TabsList>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="clausulas">Cláusulas</TabsTrigger>
          <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
        </TabsList>

        <TabsContent value="documentos">
          {documents.length === 0 ? (
            <EmptyState message="Nenhum documento cadastrado." />
          ) : (
            <div className="flex flex-col gap-3">
              {documents.map((doc) => (
                <Card key={doc.id}>
                  <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                    <CardTitle>{doc.title}</CardTitle>
                    <Badge variant="outline">{doc.kind.replaceAll("_", " ")}</Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1 pt-0 text-sm text-muted-foreground">
                    <p>{doc.summary}</p>
                    <p className="text-xs">Versão {doc.version} · {formatDate(doc.date)} · {doc.author}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="clausulas">
          {clauses.length === 0 ? (
            <EmptyState message="Nenhuma cláusula cadastrada." />
          ) : (
            <div className="flex flex-col gap-3">
              {clauses.map((clause) => (
                <Card key={clause.id}>
                  <CardHeader className="space-y-0">
                    <CardTitle>Cláusula {clause.clauseNumber} — {clause.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-muted-foreground">{clause.text}</CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="cronograma">
          {scheduleActivities.length === 0 ? (
            <EmptyState message="Nenhuma atividade de cronograma cadastrada." />
          ) : (
            <div className="flex flex-col gap-3">
              {scheduleActivities.map((activity) => (
                <Card key={activity.id}>
                  <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                    <CardTitle>{activity.name}</CardTitle>
                    <Badge variant="outline">{scheduleStatusLabels[activity.status]}</Badge>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-muted-foreground">
                    Baseline: {formatDate(activity.baselineStart)} – {formatDate(activity.baselineEnd)}
                    <br />
                    Atual: {formatDate(activity.currentStart)} – {formatDate(activity.currentEnd)}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
