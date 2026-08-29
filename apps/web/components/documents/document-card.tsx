import { ClientResponsesSection } from "@/components/documents/client-responses-section";
import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { LinkClientResponseControl } from "@/components/documents/link-client-response-control";
import type { ContractualParentOption } from "@/components/documents/link-contractual-attachment-control";
import { LinkContractualAttachmentControl } from "@/components/documents/link-contractual-attachment-control";
import { TrashDocumentControl } from "@/components/documents/trash-document-control";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ManagedDocument } from "@/lib/document-management";
import { getDocumentKindCardAppearance } from "@/lib/documents/document-kind-card-appearance";
import { formatDate } from "@/lib/labels";

// Cartão completo de um documento (título, badge de tipo, todas as
// versões com metadados/download, formulário de nova versão) — extraído
// de documentos/page.tsx para ser reaproveitado tanto pelo documento
// "principal" de um grupo contratual (Contrato-base/Aditivo N) quanto
// pelos documentos sem vínculo contratual (lista geral). Nenhum
// comportamento mudou nesta extração — mesmo markup, mesmas classes.
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

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentCard({
  document,
  projectId,
  canUpload,
  // Só preenchido pela lista de documentos SEM vínculo contratual
  // (ungrouped) em page.tsx — um documento já vinculado nunca passa
  // por aqui, é renderizado por ContractualAttachmentRow dentro do
  // grupo do pai (garantia estrutural do agrupador, não deste
  // componente). Ausente/undefined = "Vincular como anexo contratual"
  // não é oferecido aqui (ex.: ao renderizar o principal de um grupo).
  contractualParentOptions,
  // Somente ADMINISTRADOR (mesma permissão de
  // canLinkContractualAttachment, ver documentos/page.tsx) — ausente/
  // false = nenhum controle de lixeira é oferecido aqui.
  canTrash = false,
}: {
  document: ManagedDocument;
  projectId: string;
  canUpload: boolean;
  contractualParentOptions?: ContractualParentOption[];
  canTrash?: boolean;
}) {
  const current = document.versions[0];
  const nextVersionIndex = (current?.versionIndex ?? 0) + 1;
  // Nenhum parâmetro isContractualAttachment é passado aqui: quando
  // este cartão renderiza o documento PRINCIPAL de um grupo contratual
  // (ver contractual-document-group-section.tsx), esse documento já É
  // o contrato-base/aditivo — document.kind sozinho já garante bordô,
  // sem precisar (nem fingir) um vínculo de anexo.
  const kindAppearance = getDocumentKindCardAppearance(document.kind);

  return (
    <Card className={kindAppearance.cardClassName}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 px-2.5 py-1.5">
        <div>
          <CardTitle className={`text-sm ${kindAppearance.titleClassName}`}>{document.title}</CardTitle>

          <p className="text-xs opacity-80">
            {document.versions.length} {document.versions.length === 1 ? "versão" : "versões"}
          </p>
        </div>

        <Badge variant="outline" className={kindAppearance.badgeClassName}>
          {document.kind.replaceAll("_", " ")}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-1.5 p-2.5 pt-0">
        <div className={`flex flex-col gap-1.5 ${kindAppearance.contentPanelClassName}`}>
          {document.versions.map((version) => (
            <div key={version.id} className="rounded-md border p-1.5">
              <div className="flex flex-col justify-between gap-2 md:flex-row">
                <div className="flex flex-col gap-0.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>Versão {version.versionLabel}</strong>

                    <Badge variant="outline">
                      {PROCESSING_LABELS[version.processingStatus] ?? version.processingStatus}
                    </Badge>

                    {version.sourceLanguage ? (
                      <Badge variant="outline">
                        Idioma: {SOURCE_LANGUAGE_LABELS[version.sourceLanguage] ?? version.sourceLanguage}
                      </Badge>
                    ) : null}

                    {version.requiresHumanReview ? <Badge variant="secondary">Revisão humana necessária</Badge> : null}
                  </div>

                  {version.requiresHumanReview ? (
                    <span className="text-xs text-muted-foreground">
                      Extração de participantes, decisões, responsáveis, prazos e pendências ainda não está
                      implementada nesta etapa.
                    </span>
                  ) : null}

                  <span className="text-muted-foreground">
                    {formatDate(version.documentDate)} · {version.author}
                  </span>

                  <span>{version.summary}</span>

                  {version.originalFileName ? (
                    <span className="text-xs text-muted-foreground">
                      {version.originalFileName}
                      {version.fileSizeBytes ? ` · ${formatBytes(version.fileSizeBytes)}` : ""}
                    </span>
                  ) : null}

                  {version.processingError ? <span className="text-xs text-destructive">{version.processingError}</span> : null}

                  <ClientResponsesSection documentVersionId={version.id} />
                  {canUpload ? <LinkClientResponseControl projectId={projectId} documentVersionId={version.id} /> : null}
                </div>

                {version.filePath && version.storageBucket ? (
                  <DocumentDownloadButton
                    bucket={version.storageBucket}
                    filePath={version.filePath}
                    originalFileName={version.originalFileName ?? "documento"}
                  />
                ) : null}
              </div>
            </div>
          ))}

          {canUpload ? (
            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-medium">Adicionar nova versão</summary>

              <div className="pt-2">
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

          {contractualParentOptions && contractualParentOptions.length > 0 ? (
            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-medium">Vincular como anexo contratual</summary>

              <div className="pt-2">
                <LinkContractualAttachmentControl
                  projectId={projectId}
                  childDocumentId={document.id}
                  childDocumentTitle={document.title}
                  parentOptions={contractualParentOptions}
                  currentParentId={document.parentDocumentId}
                  currentParentLabel={null}
                />
              </div>
            </details>
          ) : null}

          {canTrash ? (
            <TrashDocumentControl projectId={projectId} documentId={document.id} documentTitle={document.title} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
