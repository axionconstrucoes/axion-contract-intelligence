import { ContractualAttachmentRow } from "@/components/documents/contractual-attachment-row";
import { DocumentCard } from "@/components/documents/document-card";
import type { LinkableDocumentCandidate } from "@/components/documents/link-existing-document-to-parent-control";
import { LinkExistingDocumentToParentControl } from "@/components/documents/link-existing-document-to-parent-control";
import type { ManagedDocument } from "@/lib/document-management";
import type { ContractualDocumentGroup } from "@/lib/documents/group-contractual-documents";
import { deriveContractualGroupTitles } from "@/lib/documents/group-contractual-documents";

// UMA UNIDADE VISUAL por instrumento contratual — contrato-base/aditivo
// à ESQUERDA, seus anexos formalmente vinculados à DIREITA, ligados por
// um conector decorativo (nunca embaixo um do outro em desktop — essa é
// a queixa que esta versão corrige). Moldura bordô única em volta do
// grupo inteiro. Título de cada coluna fica JUNTO do seu próprio
// conteúdo (nunca uma faixa única no topo do grupo inteiro) — garante
// que, empilhado no mobile, "ANEXOS AO X" apareça logo ANTES dos
// próprios anexos, nunca lá em cima desconectado do que rotula.
//
// Desktop (md+): 3 colunas lado a lado — principal (~35%), conector
// (largura fixa estreita, só decorativo), anexos (resto, ~60-65%).
// Mobile (abaixo de md): empilhado — principal, conector vertical curto
// + separador horizontal, anexos. min-w-0 em cada bloco garante ZERO
// rolagem horizontal mesmo com título longo.
export function ContractualDocumentGroupSection({
  group,
  projectId,
  canUpload,
  canLinkContractualAttachment,
  linkableDocuments,
}: {
  group: ContractualDocumentGroup<ManagedDocument>;
  projectId: string;
  canUpload: boolean;
  // Controle de "vincular documento existente a este instrumento" (área
  // sem anexos) E controle de lixeira (principal + cada anexo) só
  // aparecem para o ADMINISTRADOR — permissão mais estrita que
  // canUpload (que também cobre GESTOR/GERENTE). A RPC continua
  // aceitando ADMINISTRADOR, GESTOR OU GERENTE para vínculo (ver
  // migration) — isto é só UX, nunca a garantia real;
  // trash_project_document é ADMINISTRADOR estrito também no servidor.
  canLinkContractualAttachment: boolean;
  linkableDocuments: LinkableDocumentCandidate[];
}) {
  const { principalTitle, attachmentsTitle } = deriveContractualGroupTitles(group.label);
  const hasMultipleAttachments = group.attachments.length > 1;

  return (
    <div className="overflow-hidden rounded-lg border-2 border-brand-sidebar">
      <div className="flex flex-col md:flex-row md:items-stretch">
        <div className="min-w-0 md:w-[35%] md:shrink-0">
          <div className="truncate bg-brand-sidebar px-2 py-1 text-[11px] font-bold tracking-wide text-brand-sidebar-foreground uppercase">
            {principalTitle}
          </div>
          <div className="min-w-0 p-1.5">
            <DocumentCard
              document={group.principal}
              projectId={projectId}
              canUpload={canUpload}
              canTrash={canLinkContractualAttachment}
            />
          </div>
        </div>

        {/* Conector decorativo — nunca informação real, só deixa claro
            que o contrato/aditivo e seus anexos formam UMA unidade. */}
        <div aria-hidden="true" className="flex items-center justify-center py-1 md:hidden">
          <div className="h-3 w-px bg-brand-sidebar/50" />
        </div>
        <div aria-hidden="true" className="hidden items-center md:flex md:w-10 md:shrink-0">
          <div className="h-px w-full bg-brand-sidebar/50" />
        </div>

        <div className="min-w-0 border-t border-brand-sidebar/30 md:w-auto md:flex-1 md:border-t-0">
          <div className="truncate bg-brand-sidebar px-2 py-1 text-[11px] font-bold tracking-wide text-brand-sidebar-foreground uppercase md:border-l md:border-brand-sidebar-foreground/20">
            {attachmentsTitle}
          </div>

          <div className="min-w-0 p-1.5">
            {group.attachments.length === 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">Nenhum anexo contratual vinculado</p>
                {canLinkContractualAttachment ? (
                  <LinkExistingDocumentToParentControl
                    projectId={projectId}
                    parentDocumentId={group.principal.id}
                    parentLabel={group.label}
                    candidateDocuments={linkableDocuments}
                  />
                ) : null}
              </div>
            ) : hasMultipleAttachments ? (
              <div className="flex flex-col gap-1 border-l-2 border-brand-sidebar/40 pl-3">
                {group.attachments.map((attachment) => (
                  <div key={attachment.id} className="relative min-w-0">
                    <span
                      aria-hidden="true"
                      className="absolute top-1/2 -left-3 h-px w-3 -translate-y-1/2 bg-brand-sidebar/40"
                    />
                    <ContractualAttachmentRow
                      document={attachment}
                      projectId={projectId}
                      canManageDocuments={canUpload}
                      canTrash={canLinkContractualAttachment}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {group.attachments.map((attachment) => (
                  <ContractualAttachmentRow
                    key={attachment.id}
                    document={attachment}
                    projectId={projectId}
                    canManageDocuments={canUpload}
                    canTrash={canLinkContractualAttachment}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
