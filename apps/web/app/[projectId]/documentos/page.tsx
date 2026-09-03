import type { Metadata } from "next";
import { ClausesMasterDetail } from "@/components/documents/clauses-master-detail";
import { ContractualDocumentGroupSection } from "@/components/documents/contractual-document-group-section";
import { DocumentCard } from "@/components/documents/document-card";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { DocumentMultiUploadPanel } from "@/components/documents/multi-upload/document-multi-upload-panel";
import { EmailAttachmentsPanel } from "@/components/documents/email-attachments-panel";
import { TrashPanel } from "@/components/documents/trash-panel";
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
import { getContractAttachmentCounts, getManagedDocuments, getTrashedDocuments } from "@/lib/document-management";
import { isContractAttachmentEligibleKind } from "@/lib/documents/contract-attachments/is-contract-attachment-eligible-kind";
import {
  groupDocumentsByContractualStructure,
  sortAndLabelContractualPrincipals,
} from "@/lib/documents/group-contractual-documents";
import { getEmailAttachmentRegistryForProject } from "@/lib/email/attachments/registry/get-attachment-registry";
import {
  formatDate,
  scheduleStatusLabels,
} from "@/lib/labels";

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
    trashedDocuments,
  ] = await Promise.all([
    getManagedDocuments(projectId),
    getClauses(projectId),
    getScheduleActivities(projectId),
    getCurrentProjectPermission(projectId),
    getEmailAttachmentRegistryForProject(projectId),
    getTrashedDocuments(projectId),
  ]);

  // Decisão de negócio (não a hierarquia global de
  // has_project_permission): ADMINISTRADOR, GESTOR e GERENTE podem
  // enviar documentos (GERENTE é sinônimo de GESTOR — ver
  // ProjectPermission em @axion/types). Isto é só UX — a proteção
  // definitiva é sempre a RPC (register_project_document_upload /
  // promote_email_attachment_to_document), que revalida via
  // can_manage_project_documents no servidor.
  const canUpload =
    permission === "ADMINISTRADOR" || permission === "GESTOR" || permission === "GERENTE";

  // Decisão de negócio (não a hierarquia da RPC, que aceita
  // ADMINISTRADOR, GESTOR OU GERENTE): o controle de "vincular documento
  // como anexo contratual" só é OFERECIDO na interface ao ADMINISTRADOR —
  // mais estrito que canUpload. Isto é só UX; a proteção definitiva
  // continua sendo sempre a RPC (link_document_as_contractual_attachment),
  // que revalida a permissão no servidor.
  const canLinkContractualAttachment = permission === "ADMINISTRADOR";

  // "Anexos do Contrato" (card de CONTRATO_BASE) — matriz oficial desta
  // rodada: ADMINISTRADOR/GESTOR/GERENTE/COLABORADOR incluem anexos
  // (can_add_contract_attachment no servidor); exclusão continua
  // restrita a ADMINISTRADOR/GESTOR/GERENTE (mesma regra de canUpload/
  // can_manage_project_documents — LEITURA nunca vê nenhum dos dois
  // controles). Isto é só UX; a RPC revalida os dois níveis no
  // servidor.
  const canAddContractAttachment = canUpload || permission === "COLABORADOR";
  const canDeleteContractAttachment = canUpload;

  // Contagem inicial de "Anexos do Contrato" por versão ATUAL de cada
  // documento CONTRATO_BASE — só para o contador do card já aparecer no
  // primeiro render (o painel em si busca a lista completa sob demanda,
  // só quando expandido). Precisa dos documentos já carregados (para
  // saber quais document_version_id consultar), por isso roda depois do
  // Promise.all acima, nunca em paralelo com ele.
  const contractAttachmentCounts = await getContractAttachmentCounts(
    documents
      .filter((document) => isContractAttachmentEligibleKind(document.kind))
      .map((document) => document.versions[0]?.id)
      .filter((id): id is string => Boolean(id))
  );

  // GRUPOS CONTRATUAIS: Contrato-base | Anexos, Aditivo 01 | Anexos,
  // etc. — ver group-contractual-documents.ts. Com os dados reais de
  // hoje (parentDocumentId sempre null, nenhuma tabela do schema
  // representa esse vínculo ainda), cada grupo aparece honestamente com
  // zero anexos; nenhum vínculo é fabricado na interface.
  const { groups: contractualGroups, ungrouped: ungroupedDocuments } =
    groupDocumentsByContractualStructure(documents);

  // Candidatos a "pai contratual" para o dropdown "Vincular como anexo
  // contratual" (DocumentCard) — mesmos rótulos exibidos nos cabeçalhos
  // dos grupos acima (sortAndLabelContractualPrincipals é a MESMA
  // função usada por groupDocumentsByContractualStructure, nunca uma
  // segunda lógica de rótulo). Só um resolvido no servidor;
  // link_document_as_contractual_attachment revalida tudo de novo a
  // partir só do id, nunca confia neste array vindo do navegador.
  const contractualParentOptions = sortAndLabelContractualPrincipals(documents).map(
    ({ label, principal }) => ({
      id: principal.id,
      label,
      title: principal.title,
    })
  );

  // Candidatos para o controle REVERSO ("vincular documento existente a
  // ESTE contrato/aditivo", oferecido dentro da área "sem anexos" de
  // cada grupo) — sempre a lista de documentos SEM vínculo contratual
  // (ungrouped), nunca um documento já vinculado a outro pai (evita
  // oferecer ali um fluxo de TROCA, que tem suas próprias regras de
  // confirmação já cobertas por LinkContractualAttachmentControl).
  const linkableDocuments = ungroupedDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    kind: document.kind,
  }));

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
              {contractualGroups.map((group) => (
                <ContractualDocumentGroupSection
                  key={group.principal.id}
                  group={group}
                  projectId={projectId}
                  canUpload={canUpload}
                  canLinkContractualAttachment={canLinkContractualAttachment}
                  linkableDocuments={linkableDocuments}
                  contractAttachmentCounts={contractAttachmentCounts}
                  canAddContractAttachment={canAddContractAttachment}
                  canDeleteContractAttachment={canDeleteContractAttachment}
                />
              ))}

              {ungroupedDocuments.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {contractualGroups.length > 0 ? (
                    <p className="text-xs font-medium text-muted-foreground">
                      Demais documentos (sem vínculo contratual)
                    </p>
                  ) : null}

                  {ungroupedDocuments.map((document) => (
                    <DocumentCard
                      key={document.id}
                      document={document}
                      projectId={projectId}
                      canUpload={canUpload}
                      contractualParentOptions={canLinkContractualAttachment ? contractualParentOptions : undefined}
                      canTrash={canLinkContractualAttachment}
                      contractAttachmentCounts={contractAttachmentCounts}
                      canAddContractAttachment={canAddContractAttachment}
                      canDeleteContractAttachment={canDeleteContractAttachment}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {canLinkContractualAttachment ? (
            <details className="rounded-md border p-4">
              <summary className="cursor-pointer text-sm font-medium">Lixeira ({trashedDocuments.length})</summary>
              <div className="pt-4">
                <TrashPanel projectId={projectId} trashedDocuments={trashedDocuments} />
              </div>
            </details>
          ) : null}
        </TabsContent>

        <TabsContent value="clausulas">
          <ClausesMasterDetail clauses={clauses} />
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
