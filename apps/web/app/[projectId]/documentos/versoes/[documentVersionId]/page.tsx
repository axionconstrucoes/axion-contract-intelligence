import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createSupabaseServerClient } from "@axion/db/server";
import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { ExtractionCoveragePanel } from "@/components/documents/extraction-coverage-panel";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { computeExtractionCoverage, type PageCoverage } from "@/lib/documents/extraction/extraction-coverage";
import {
  FONT_ENCODING_REPAIR_VERSION,
  normalizeSegmentText,
  type FontEncodingRepair,
} from "@/lib/documents/extraction/repair-font-encoding";
import { resolveAttachmentOpenBehavior } from "@/lib/email/registry/resolve-attachment-open-behavior";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Visualizar documento",
};

// Estados reais de document_extractions.status (migration
// 20260821011133_document_processing_foundation.sql): PROCESSING,
// PROCESSED, FAILED. "SUCCEEDED" não existe — a consulta antiga nunca
// encontrava extração alguma.
const EXTRACTION_STATUS_PROCESSED = "PROCESSED";

function formatDate(value: string | null): string {
  if (!value) return "Data não disponível";

  const [year, month, day] = value.slice(0, 10).split("-");

  if (!year || !month || !day) return value;

  return `${day}/${month}/${year}`;
}

type VersionFile = {
  id: string;
  file_role: string;
  original_file_name: string;
  mime_type: string | null;
  storage_bucket: string;
  storage_path: string;
  description: string | null;
  uploaded_at: string;
};

export default async function DocumentVersionViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{
    projectId: string;
    documentVersionId: string;
  }>;
  searchParams: Promise<{ arquivo?: string; pagina?: string; paginaGlobal?: string; texto?: string }>;
}) {
  const [{ projectId, documentVersionId }, query] = await Promise.all([params, searchParams]);

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

  const [{ data: document }, { data: extractions }, { data: fileRows }] =
    await Promise.all([
      supabase
        .from("documents")
        .select("id,title,kind")
        .eq("id", version.document_id)
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .maybeSingle(),

      // Todas as extrações PROCESSED (histórico preservado em
      // reprocessamentos); a exibida é sempre a mais recente.
      supabase
        .from("document_extractions")
        .select(
          "id,status,extractor,extractor_version,text_content,page_count,character_count,error_message,completed_at"
        )
        .eq("document_version_id", version.id)
        .eq("status", EXTRACTION_STATUS_PROCESSED)
        .order("completed_at", { ascending: false }),

      // Pacote documental da versão: arquivo principal + partes/anexos.
      supabase
        .from("document_version_files")
        .select("id,file_role,original_file_name,mime_type,storage_bucket,storage_path,description,uploaded_at")
        .eq("document_version_id", version.id)
        .in("file_role", ["PRINCIPAL", "ANEXO_CONTRATUAL"])
        .order("uploaded_at", { ascending: true }),
    ]);

  if (!document) {
    notFound();
  }

  const extraction = extractions?.[0] ?? null;
  const previousExtractionCount = Math.max(0, (extractions?.length ?? 0) - 1);

  // Paginado: o PostgREST limita cada resposta (padrão 1000 linhas) —
  // sem isso, documentos grandes mostrariam páginas "sem texto" falsas.
  const SEGMENT_PAGE_SIZE = 1000;
  const segments: Array<{ segment_index: number; page_number: number | null; locator: string | null; text_content: string }> = [];
  if (extraction) {
    for (let from = 0; ; from += SEGMENT_PAGE_SIZE) {
      const { data: batch, error: segmentError } = await supabase
        .from("document_text_segments")
        .select("segment_index,page_number,locator,text_content")
        .eq("extraction_id", extraction.id)
        .order("segment_index", { ascending: true })
        .range(from, from + SEGMENT_PAGE_SIZE - 1);
      if (segmentError) {
        throw new Error(`Falha ao carregar o texto extraído: ${segmentError.message}`);
      }
      segments.push(...(batch ?? []));
      if (!batch || batch.length < SEGMENT_PAGE_SIZE) break;
    }
  }
  const coverage = extraction ? computeExtractionCoverage(segments, extraction.page_count) : null;

  // Arquivos da versão (principal primeiro). Versões antigas sem pacote
  // documental usam o arquivo registrado na própria versão.
  const files: VersionFile[] = (fileRows as VersionFile[] | null)?.length
    ? [...(fileRows as VersionFile[])].sort((a, b) =>
        a.file_role === b.file_role ? 0 : a.file_role === "PRINCIPAL" ? -1 : 1
      )
    : version.file_path && version.storage_bucket
      ? [
          {
            id: "principal",
            file_role: "PRINCIPAL",
            original_file_name: version.original_file_name ?? document.title ?? "documento",
            mime_type: version.mime_type,
            storage_bucket: version.storage_bucket,
            storage_path: version.file_path,
            description: null,
            uploaded_at: version.uploaded_at,
          },
        ]
      : [];

  const fileByName = new Map(files.map((file) => [file.original_file_name, file]));
  // ?paginaGlobal=N (ex.: vindo da revisão de cláusulas): resolve arquivo
  // e página local pela cobertura da extração (Parte 1/Parte 2).
  const globalPage = Number.parseInt(query.paginaGlobal ?? "", 10);
  const globalPageInfo =
    Number.isFinite(globalPage) && coverage
      ? [...coverage.pendingPages, ...coverage.visualReview.uniquePages].find((page) => page.globalPage === globalPage) ??
        null
      : null;
  const globalFileFromSegments =
    Number.isFinite(globalPage) && !globalPageInfo
      ? segments.find((segment) => segment.page_number === globalPage)?.locator?.match(/^(.+?) · pág\. local (\d+) ·/)
      : null;
  const resolvedGlobal = globalPageInfo
    ? { fileName: globalPageInfo.fileName, localPage: globalPageInfo.localPage }
    : globalFileFromSegments
      ? { fileName: globalFileFromSegments[1], localPage: Number(globalFileFromSegments[2]) }
      : null;

  const selectedFile =
    (resolvedGlobal ? fileByName.get(resolvedGlobal.fileName) : undefined) ??
    files.find((file) => file.id === query.arquivo) ??
    files[0] ??
    null;
  const requestedPage = resolvedGlobal ? resolvedGlobal.localPage : Number.parseInt(query.pagina ?? "", 10);
  const selectedPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : null;

  const baseHref = `/${projectId}/documentos/versoes/${documentVersionId}`;
  const hrefForPage = (page: PageCoverage) => {
    const file = fileByName.get(page.fileName);
    return file ? `${baseHref}?arquivo=${file.id}&pagina=${page.localPage}#original` : null;
  };

  const fileName =
    selectedFile?.original_file_name ??
    version.original_file_name ??
    document.title ??
    "documento";

  const behavior = resolveAttachmentOpenBehavior({
    mimeType: selectedFile?.mime_type ?? version.mime_type,
    fileName,
  });

  let signedUrl: string | null = null;

  if (
    selectedFile &&
    (behavior.kind === "PDF" || behavior.kind === "IMAGE")
  ) {
    const { data } = await supabase.storage
      .from(selectedFile.storage_bucket)
      .createSignedUrl(selectedFile.storage_path, 300);

    signedUrl = data?.signedUrl ?? null;
  }

  // Visualizador de PDF do navegador abre direto na página pedida.
  const viewerUrl =
    signedUrl && behavior.kind === "PDF" && selectedPage ? `${signedUrl}#page=${selectedPage}` : signedUrl;

  // Camada normalizada (busca/análise) — calculada na leitura; o texto
  // original da extração permanece intacto como evidência.
  const showNormalized = query.texto === "normalizado";
  const repairs: FontEncodingRepair[] = [];
  const normalizedText = segments
    .map((segment) => {
      const result = normalizeSegmentText(segment.text_content, segment.locator);
      repairs.push(...result.repairs);
      return result.text;
    })
    .join("\n\n");
  const repairSamples = [...new Map(repairs.map((repair) => [`${repair.original}→${repair.normalized}`, repair])).values()].slice(0, 30);

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

            {selectedFile ? (
              <DocumentDownloadButton
                bucket={selectedFile.storage_bucket}
                filePath={selectedFile.storage_path}
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

      {extraction ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">Leitura do documento (extração mais recente)</p>
              <p className="text-xs text-muted-foreground">
                {extraction.extractor} {extraction.extractor_version}
                {extraction.completed_at ? ` · concluída em ${formatDate(extraction.completed_at)}` : ""}
                {previousExtractionCount > 0
                  ? ` · ${previousExtractionCount} extração(ões) anterior(es) preservada(s) como histórico`
                  : ""}
              </p>
            </div>
            <ExtractionCoveragePanel
              coverage={coverage}
              coverageMessage={extraction.error_message}
              hrefForPage={hrefForPage}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">
            Nenhuma extração processada para esta versão
            {version.processing_status ? ` (status: ${version.processing_status})` : ""}.
          </CardContent>
        </Card>
      )}

      <Card id="original">
        <CardContent className="flex flex-col gap-3 pt-4">
          {files.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Arquivo original:</span>
              {files.map((file) => (
                <Link
                  key={file.id}
                  href={`${baseHref}?arquivo=${file.id}#original`}
                  title={file.description ?? undefined}
                  className={cn(
                    buttonVariants({ size: "sm", variant: file.id === selectedFile?.id ? "default" : "outline" })
                  )}
                >
                  {file.original_file_name}
                </Link>
              ))}
            </div>
          ) : null}

          {selectedPage && selectedFile ? (
            <p className="text-xs text-muted-foreground">
              Exibindo {selectedFile.original_file_name}, página {selectedPage} do arquivo.
            </p>
          ) : null}

          {behavior.kind === "PDF" && viewerUrl ? (
            <iframe
              key={viewerUrl}
              src={viewerUrl}
              title={`Visualização de ${fileName}`}
              className="h-[78vh] w-full rounded-md border"
            />
          ) : behavior.kind === "IMAGE" && signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={signedUrl}
              alt={fileName}
              className="max-h-[78vh] w-auto max-w-full rounded-md border"
            />
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

      {extraction?.text_content ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">
                  Conteúdo extraído do documento {showNormalized ? "(camada normalizada)" : "(texto original)"}
                </p>

                <p className="text-xs text-muted-foreground">
                  {extraction.page_count
                    ? `${extraction.page_count} página(s)`
                    : ""}
                  {extraction.character_count
                    ? ` · ${extraction.character_count.toLocaleString("pt-BR")} caracteres`
                    : ""}
                  {coverage && !coverage.complete ? " · leitura parcial" : ""}
                </p>
              </div>

              {repairs.length > 0 ? (
                <div className="flex gap-2">
                  <Link
                    href={`${baseHref}`}
                    className={cn(buttonVariants({ size: "sm", variant: showNormalized ? "outline" : "default" }))}
                  >
                    Texto original
                  </Link>
                  <Link
                    href={`${baseHref}?texto=normalizado`}
                    className={cn(buttonVariants({ size: "sm", variant: showNormalized ? "default" : "outline" }))}
                  >
                    Normalizado (busca/análise)
                  </Link>
                </div>
              ) : null}
            </div>

            {repairs.length > 0 ? (
              <details className="rounded-md border p-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  Codificação de fonte corrigida na camada normalizada: {repairs.length.toLocaleString("pt-BR")}{" "}
                  correções ({FONT_ENCODING_REPAIR_VERSION}). O texto original não é alterado.
                </summary>
                <p className="mt-2">
                  Amostra (original → normalizado):{" "}
                  {repairSamples.map((repair) => `${repair.original} → ${repair.normalized}`).join(" · ")}
                </p>
              </details>
            ) : null}

            <div className="max-h-[72vh] overflow-auto rounded-md border bg-muted/20 p-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                {showNormalized ? normalizedText : extraction.text_content}
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
