import type { Metadata } from "next";
import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { DocumentPackageFiles } from "@/components/documents/document-package-files";
import { DocumentDeleteButton } from "@/components/documents/document-delete-button";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
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
import { canEditProjectContent, getCurrentProjectPermission } from "@/lib/contract-review";
import {
  getClauses,
  getScheduleActivities,
} from "@/lib/data";
import { getManagedDocuments } from "@/lib/document-management";
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

  const canUpload = canEditProjectContent(permission);

  return (
    <div className="flex flex-col gap-4">
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

                const isCentralDocument =
                  document.kind === "CONTRATO_BASE" ||
                  document.kind.includes("ADITIVO");

                return (
                  <Card
                    key={document.id}
                    className={
                      isCentralDocument
                        ? "border-l-4 border-l-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/10"
                        : undefined
                    }
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

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {isCentralDocument && (
                          <Badge className="border-transparent bg-emerald-600 text-white">Documento central</Badge>
                        )}
                        <Badge variant="outline">
                          {document.kind.replaceAll(
                            "_",
                            " "
                          )}
                        </Badge>
                      </div>
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

                            <DocumentPackageFiles
                              projectId={projectId}
                              documentId={document.id}
                              documentVersionId={version.id}
                              canEdit={canUpload}
                            />
                          </div>
                        )
                      )}

                      {canUpload ? (
                        <div className="flex justify-end">
                          <DocumentDeleteButton
                            documentId={document.id}
                            documentTitle={document.title}
                          />
                        </div>
                      ) : null}

                      {canUpload ? (
                        <details className="rounded-md border p-4">
                          <summary className="cursor-pointer text-sm font-medium">
                            Nova versão do instrumento
                          </summary>

                          <div className="pt-4">
                            <p className="mb-4 text-xs text-muted-foreground">
                              Use esta opção somente quando o instrumento contratual tiver uma nova revisão.
                              Para planilhas, anexos, aprovações ou documentos complementares, use Arquivos do pacote na versão correspondente.
                            </p>
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
                    <CardTitle className="underline underline-offset-4">
                      Cláusula {clause.clauseNumber} - {clause.title}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="text-sm text-muted-foreground">
                    <div className="space-y-3">
                      {clause.text
                        .replace(/DocuSign Envelope ID:\s*[A-F0-9-]+/gi, "")
                        .replace(/P(?:á|a)gina\s+\d+\s+de\s+\d+/gi, "")
                        .replace(/^\s*CLÁUSULA\b[\s\S]*?(?=\d+\.\d+\.)/i, "")
                        .split(
                          new RegExp(
                            `(?=\\b${clause.clauseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+\\.(?!\\d))`,
                            "g"
                          )
                        )
                        .map((paragraph) => paragraph.trim())
                        .filter(Boolean)
                        .map((paragraph, index) => (
                          <p
                            key={`${clause.id}-${index}`}
                            className="whitespace-pre-line leading-6"
                          >
                            {paragraph}
                          </p>
                        ))}
                    </div>
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
