import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import {
  getClauses,
  getScheduleActivities,
} from "@/lib/data";
import { getManagedDocuments } from "@/lib/document-management";
import {
  formatDate,
  scheduleStatusLabels,
} from "@/lib/labels";

const PROCESSING_LABELS: Record<string, string> = {
  NOT_UPLOADED: "Sem arquivo",
  AWAITING_PROCESSING: "Aguardando processamento",
  PROCESSING: "Processando",
  PROCESSED: "Processado",
  FAILED: "Falha no processamento",
};

function formatBytes(bytes: number | null) {
  if (!bytes) {
    return "";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

export default async function DocumentosPage({
  params,
}: {
  params: Promise<{
    projectId: string;
  }>;
}) {
  const { projectId } = await params;

  const [
    documents,
    clauses,
    scheduleActivities,
    permission,
  ] = await Promise.all([
    getManagedDocuments(projectId),
    getClauses(projectId),
    getScheduleActivities(projectId),
    getCurrentProjectPermission(projectId),
  ]);

  const canUpload =
    permission === "EDITOR" ||
    permission === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">
          Documentos
        </h1>

        <p className="text-sm text-muted-foreground">
          Contratos, aditivos, propostas,
          documentos técnicos e cronogramas
          do projeto.
        </p>
      </div>

      <Tabs defaultValue="documentos">
        <TabsList>
          <TabsTrigger value="documentos">
            Documentos
          </TabsTrigger>

          <TabsTrigger value="clausulas">
            Cláusulas
          </TabsTrigger>

          <TabsTrigger value="cronograma">
            Cronograma
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="documentos"
          className="flex flex-col gap-5"
        >
          {canUpload ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  Adicionar documento
                </CardTitle>
              </CardHeader>

              <CardContent>
                <DocumentUploadForm
                  projectId={projectId}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                O envio de documentos requer
                permissão de Editor ou
                Administrador.
              </CardContent>
            </Card>
          )}

          {documents.length === 0 ? (
            <div className="flex flex-col gap-3">
              <EmptyState message="Nenhum documento cadastrado." />

              <p className="text-sm text-muted-foreground">
                Confronto contratual pendente:
                ainda não há base documental
                disponível para este projeto.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {documents.map((document) => {
                const current =
                  document.versions[0];

                const nextVersionIndex =
                  (current?.versionIndex ?? 0) + 1;

                return (
                  <Card key={document.id}>
                    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                      <div>
                        <CardTitle>
                          {document.title}
                        </CardTitle>

                        <p className="text-xs text-muted-foreground">
                          {document.versions.length}{" "}
                          {document.versions.length === 1
                            ? "versão"
                            : "versões"}
                        </p>
                      </div>

                      <Badge variant="outline">
                        {document.kind.replaceAll(
                          "_",
                          " "
                        )}
                      </Badge>
                    </CardHeader>

                    <CardContent className="flex flex-col gap-4">
                      {document.versions.map(
                        (version) => (
                          <div
                            key={version.id}
                            className="rounded-md border p-4"
                          >
                            <div className="flex flex-col justify-between gap-4 md:flex-row">
                              <div className="flex flex-col gap-1 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                  <strong>
                                    Versão{" "}
                                    {version.versionLabel}
                                  </strong>

                                  <Badge variant="outline">
                                    {PROCESSING_LABELS[
                                      version.processingStatus
                                    ] ??
                                      version.processingStatus}
                                  </Badge>
                                </div>

                                <span className="text-muted-foreground">
                                  {formatDate(
                                    version.documentDate
                                  )}{" "}
                                  · {version.author}
                                </span>

                                <span>
                                  {version.summary}
                                </span>

                                {version.originalFileName ? (
                                  <span className="text-xs text-muted-foreground">
                                    {version.originalFileName}
                                    {version.fileSizeBytes
                                      ? ` · ${formatBytes(
                                          version.fileSizeBytes
                                        )}`
                                      : ""}
                                  </span>
                                ) : null}

                                {version.processingError ? (
                                  <span className="text-xs text-destructive">
                                    {version.processingError}
                                  </span>
                                ) : null}
                              </div>

                              {version.filePath &&
                              version.storageBucket ? (
                                <DocumentDownloadButton
                                  bucket={
                                    version.storageBucket
                                  }
                                  filePath={
                                    version.filePath
                                  }
                                originalFileName={version.originalFileName ?? "documento"}
                                />
                              ) : null}
                            </div>
                          </div>
                        )
                      )}

                      {canUpload ? (
                        <details className="rounded-md border p-4">
                          <summary className="cursor-pointer text-sm font-medium">
                            Adicionar nova versão
                          </summary>

                          <div className="pt-4">
                            <DocumentUploadForm
                              projectId={projectId}
                              existingDocument={{
                                id: document.id,
                                kind: document.kind,
                                title: document.title,
                                nextVersionIndex,
                              }}
                            />
                          </div>
                        </details>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
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
                  <CardHeader>
                    <CardTitle>
                      Cláusula{" "}
                      {clause.clauseNumber} —{" "}
                      {clause.title}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="text-sm text-muted-foreground">
                    {clause.text}
                  </CardContent>
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
              {scheduleActivities.map(
                (activity) => (
                  <Card key={activity.id}>
                    <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                      <CardTitle>
                        {activity.name}
                      </CardTitle>

                      <Badge variant="outline">
                        {
                          scheduleStatusLabels[
                            activity.status
                          ]
                        }
                      </Badge>
                    </CardHeader>

                    <CardContent className="text-sm text-muted-foreground">
                      Baseline:{" "}
                      {formatDate(
                        activity.baselineStart
                      )}{" "}
                      –{" "}
                      {formatDate(
                        activity.baselineEnd
                      )}
                      <br />
                      Atual:{" "}
                      {formatDate(
                        activity.currentStart
                      )}{" "}
                      –{" "}
                      {formatDate(
                        activity.currentEnd
                      )}
                    </CardContent>
                  </Card>
                )
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
