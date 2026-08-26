import type { Metadata } from "next";
import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { DocumentMultiUploadPanel } from "@/components/documents/multi-upload/document-multi-upload-panel";
import { EmailAttachmentsPanel } from "@/components/documents/email-attachments-panel";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FeatureInfo } from "@/components/shared/feature-info";
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
import { getDocumentKindHighlightClassName } from "@/lib/documents/document-kind-highlight";
import { getEmailAttachmentRegistryForProject } from "@/lib/email/attachments/registry/get-attachment-registry";
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

// Rótulos de exibição — não são uma lista exaustiva de idiomas
// suportados, só os mais comuns em contratos de engenharia/construção
// deste projeto. Um código sem rótulo aqui mostra o próprio código
// (nunca omitido, nunca traduzido silenciosamente para "Português").
const SOURCE_LANGUAGE_LABELS: Record<string, string> = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
  de: "Alemão",
  it: "Italiano",
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

export const metadata: Metadata = { title: "Documentos" };

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
    emailAttachmentRows,
  ] = await Promise.all([
    getManagedDocuments(projectId),
    getClauses(projectId),
    getScheduleActivities(projectId),
    getCurrentProjectPermission(projectId),
    getEmailAttachmentRegistryForProject(projectId),
  ]);

  // Decisão de negócio (não a hierarquia global de
  // has_project_permission): ADMINISTRADOR e GESTOR podem enviar
  // documentos. Isto é só UX — a proteção definitiva é sempre a RPC
  // (register_project_document_upload / promote_email_attachment_to_document),
  // que revalida via can_manage_project_documents no servidor.
  const canUpload =
    permission === "ADMINISTRADOR" || permission === "GESTOR";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Documentos" description="Contratos, aditivos, propostas, documentos técnicos e cronogramas do projeto." />

      <Tabs defaultValue="documentos">
        <TabsList>
          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="documentos">
              Documentos
            </TabsTrigger>
            <FeatureInfo helpId="documentos-tab-documentos" />
          </span>

          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="clausulas">
              Cláusulas
            </TabsTrigger>
            <FeatureInfo helpId="documentos-tab-clausulas" />
          </span>

          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="cronograma">
              Cronograma
            </TabsTrigger>
            <FeatureInfo helpId="documentos-tab-cronograma" />
          </span>

          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="anexos-email">
              Anexos de E-mail
            </TabsTrigger>
            <FeatureInfo helpId="documentos-tab-anexos-email" />
          </span>
        </TabsList>

        <TabsContent
          value="documentos"
          className="flex flex-col gap-5"
        >
          {canUpload ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  Adicionar documentos
                </CardTitle>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <DocumentMultiUploadPanel
                  projectId={projectId}
                  documents={documents}
                />

                <details className="rounded-md border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Upload individual (avançado)
                  </summary>

                  <div className="pt-4">
                    <DocumentUploadForm
                      projectId={projectId}
                    />
                  </div>
                </details>
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
                  <Card
                    key={document.id}
                    className={getDocumentKindHighlightClassName(
                      document.kind
                    )}
                  >
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

                                  {version.sourceLanguage ? (
                                    <Badge variant="outline">
                                      Idioma:{" "}
                                      {SOURCE_LANGUAGE_LABELS[
                                        version.sourceLanguage
                                      ] ?? version.sourceLanguage}
                                    </Badge>
                                  ) : null}

                                  {version.requiresHumanReview ? (
                                    <Badge variant="secondary">
                                      Revisão humana necessária
                                    </Badge>
                                  ) : null}
                                </div>

                                {version.requiresHumanReview ? (
                                  <span className="text-xs text-muted-foreground">
                                    Extração de participantes, decisões,
                                    responsáveis, prazos e pendências ainda
                                    não está implementada nesta etapa.
                                  </span>
                                ) : null}

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

        <TabsContent value="anexos-email">
          <EmailAttachmentsPanel projectId={projectId} rows={emailAttachmentRows} canPromote={canUpload} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
