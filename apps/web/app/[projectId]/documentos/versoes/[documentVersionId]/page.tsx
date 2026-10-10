import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createSupabaseServerClient } from "@axion/db/server";
import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { resolveAttachmentOpenBehavior } from "@/lib/email/registry/resolve-attachment-open-behavior";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Visualizar documento",
};

function formatDate(value: string | null): string {
  if (!value) return "Data não disponível";

  const [year, month, day] = value.slice(0, 10).split("-");

  if (!year || !month || !day) return value;

  return `${day}/${month}/${year}`;
}

export default async function DocumentVersionViewerPage({
  params,
}: {
  params: Promise<{
    projectId: string;
    documentVersionId: string;
  }>;
}) {
  const { projectId, documentVersionId } = await params;

  const supabase = await createSupabaseServerClient();

  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .select("*")
    .eq("id", documentVersionId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (versionError) {
    throw new Error(
      `Falha ao carregar documento: ${versionError.message}`
    );
  }

  if (!version) {
    notFound();
  }

  const [{ data: document }, { data: extraction }] =
    await Promise.all([
      supabase
        .from("documents")
        .select("id,title,kind")
        .eq("id", version.document_id)
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .maybeSingle(),

      supabase
        .from("document_extractions")
        .select(
          "id,status,text_content,page_count,character_count,completed_at"
        )
        .eq("document_version_id", version.id)
        .eq("status", "SUCCEEDED")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!document) {
    notFound();
  }

  const fileName =
    version.original_file_name ??
    document.title ??
    "documento";

  const behavior = resolveAttachmentOpenBehavior({
    mimeType: version.mime_type,
    fileName,
  });

  let signedUrl: string | null = null;

  if (
    version.storage_bucket &&
    version.file_path &&
    (behavior.kind === "PDF" || behavior.kind === "IMAGE")
  ) {
    const { data } = await supabase.storage
      .from(version.storage_bucket)
      .createSignedUrl(version.file_path, 300);

    signedUrl = data?.signedUrl ?? null;
  }

  const sizeKb =
    typeof version.file_size_bytes === "number"
      ? Math.round(version.file_size_bytes / 1024)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={document.title}
        description={[
          `Versão ${version.version_label}`,
          formatDate(version.document_date),
          version.author,
          version.mime_type,
          sizeKb ? `${sizeKb} KB` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${projectId}/timeline`}
              className={cn(
                buttonVariants({
                  size: "sm",
                  variant: "outline",
                })
              )}
            >
              ← Timeline
            </Link>

            <Link
              href={`/${projectId}/documentos`}
              className={cn(
                buttonVariants({
                  size: "sm",
                  variant: "outline",
                })
              )}
            >
              Documentos
            </Link>

            {version.storage_bucket && version.file_path ? (
              <DocumentDownloadButton
                bucket={version.storage_bucket}
                filePath={version.file_path}
                originalFileName={fileName}
              />
            ) : null}
          </div>
        }
      />

      {version.summary ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm">
              <strong>Resumo:</strong> {version.summary}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-4">
          {behavior.kind === "PDF" && signedUrl ? (
            <iframe
              src={signedUrl}
              title={`Visualização de ${fileName}`}
              className="h-[78vh] w-full rounded-md border"
              sandbox=""
            />
          ) : behavior.kind === "IMAGE" && signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={signedUrl}
              alt={fileName}
              className="max-h-[78vh] w-auto max-w-full rounded-md border"
            />
          ) : extraction?.text_content ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    Conteúdo extraído do documento
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {extraction.page_count
                      ? `${extraction.page_count} página(s)`
                      : ""}
                    {extraction.character_count
                      ? ` · ${extraction.character_count.toLocaleString("pt-BR")} caracteres`
                      : ""}
                  </p>
                </div>

                <span className="rounded-md border px-2 py-1 text-xs">
                  {fileName}
                </span>
              </div>

              <div className="max-h-[72vh] overflow-auto rounded-md border bg-muted/20 p-4">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                  {extraction.text_content}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                Não há visualização incorporada disponível para este
                formato.
              </p>

              <p className="text-muted-foreground">
                O arquivo original pode ser aberto pelo botão de download
                acima.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
