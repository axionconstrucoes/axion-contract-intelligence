import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import { TrashDocumentControl } from "@/components/documents/trash-document-control";
import { UnlinkContractualAttachmentControl } from "@/components/documents/unlink-contractual-attachment-control";
import { Badge } from "@/components/ui/badge";
import type { ManagedDocument } from "@/lib/document-management";
import { getDocumentKindCardAppearance } from "@/lib/documents/document-kind-card-appearance";

// Linha compacta de anexo contratual — deliberadamente NÃO um Card
// inteiro (ver requisito: "attachments as rows, not tall cards"), mas
// ainda assim recebe a MESMA regra de cor bordô do documento principal
// (getDocumentKindCardAppearance com isContractualAttachment: true —
// "a condição de anexo contratual prevalece sobre o tipo original")
// mais o badge ANEXO CONTRATUAL — só chamado aqui, o único lugar da
// aplicação onde um documento é de fato sabido (vínculo real e
// persistido, nunca inferido) como anexo contratual de outro.
export function ContractualAttachmentRow({
  document,
  projectId,
  canManageDocuments,
  // Somente ADMINISTRADOR (ver documentos/page.tsx,
  // canLinkContractualAttachment) — ausente/false = nenhum controle de
  // lixeira aqui.
  canTrash = false,
}: {
  document: ManagedDocument;
  projectId: string;
  canManageDocuments: boolean;
  canTrash?: boolean;
}) {
  const current = document.versions[0];
  const appearance = getDocumentKindCardAppearance(document.kind, { isContractualAttachment: true });

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-md px-2 py-1.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-2 ${appearance.cardClassName}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`truncate font-medium ${appearance.titleClassName}`}>{document.title}</span>
          <Badge variant="outline" className={appearance.badgeClassName}>
            ANEXO CONTRATUAL
          </Badge>
        </div>
        <span className="text-xs opacity-80">
          {document.kind.replaceAll("_", " ")}
          {current ? ` · v. vigente ${current.versionLabel}` : ""}
        </span>
        {document.contractualIncorporationBasis ? (
          <span className="truncate text-xs opacity-80">Fundamento: {document.contractualIncorporationBasis}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
        {current?.filePath && current.storageBucket ? (
          <div className={appearance.contentPanelClassName}>
            <DocumentDownloadButton
              bucket={current.storageBucket}
              filePath={current.filePath}
              originalFileName={current.originalFileName ?? "documento"}
            />
          </div>
        ) : null}

        {canManageDocuments ? (
          <UnlinkContractualAttachmentControl projectId={projectId} documentId={document.id} documentTitle={document.title} />
        ) : null}

        {canTrash ? (
          <TrashDocumentControl projectId={projectId} documentId={document.id} documentTitle={document.title} />
        ) : null}
      </div>
    </div>
  );
}
