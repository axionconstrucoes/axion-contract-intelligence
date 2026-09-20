import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { resolveAttachmentOpenBehavior } from "@/lib/email/registry/resolve-attachment-open-behavior";
import { cn } from "@/lib/utils";
import { createSupabaseServerClient } from "@axion/db/server";

export const metadata: Metadata = { title: "Anexo · Documentos" };

// Viewer do ACC para anexos de e-mail. A linha do anexo é lida pelo
// client de SESSÃO (RLS de email_attachments: só membros do projeto) e
// a URL assinada de curta duração é gerada com o mesmo client (Storage
// RLS por prefixo do projeto — mesmo mecanismo de DocumentDownloadButton).
// PDF => <iframe> (visualizador nativo do navegador, sandbox); imagem =>
// <img>. Nenhum conteúdo é executado; outros formatos só metadados e
// download controlado.

export default async function EmailAttachmentViewerPage({ params }: { params: Promise<{ projectId: string; emailId: string; attachmentId: string }> }) {
  const { projectId, emailId, attachmentId } = await params;
  if (!isWeeklyReportsEnabled()) notFound();
  const supabase = await createSupabaseServerClient();

  const { data: attachment, error } = await supabase
    .from("email_attachments")
    .select("id,original_file_name,mime_type,file_size_bytes,sha256_hash,storage_bucket,storage_path,project_id,email_id")
    .eq("id", attachmentId)
    .eq("email_id", emailId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar anexo: ${error.message}`);
  if (!attachment) notFound();

  const behavior = resolveAttachmentOpenBehavior({ mimeType: attachment.mime_type, fileName: attachment.original_file_name });
  let signedUrl: string | null = null;
  if (behavior.kind === "PDF" || behavior.kind === "IMAGE") {
    const { data } = await supabase.storage.from(attachment.storage_bucket).createSignedUrl(attachment.storage_path, 300);
    signedUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={attachment.original_file_name}
        description={`${attachment.mime_type} · ${Math.round(Number(attachment.file_size_bytes) / 1024)} KB · SHA-256 ${String(attachment.sha256_hash).slice(0, 16)}…`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/${projectId}/documentos/emails/${emailId}`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              ← E-mail
            </Link>
            <DocumentDownloadButton bucket={attachment.storage_bucket} filePath={attachment.storage_path} originalFileName={attachment.original_file_name} />
          </div>
        }
      />

      <Card>
        <CardContent className="pt-4">
          {behavior.kind === "PDF" && signedUrl ? (
            <iframe
              src={signedUrl}
              title={`Visualização de ${attachment.original_file_name}`}
              className="h-[80vh] w-full rounded-md border"
              sandbox=""
            />
          ) : behavior.kind === "IMAGE" && signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signedUrl} alt={attachment.original_file_name} className="max-h-[80vh] w-auto max-w-full rounded-md border" />
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p>{behavior.reason ?? "Visualização indisponível para este formato."}</p>
              <p className="text-xs text-muted-foreground">
                O ACC nunca executa o conteúdo do anexo. Use o download controlado acima; o arquivo original permanece íntegro no Storage (SHA-256 registrado).
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
