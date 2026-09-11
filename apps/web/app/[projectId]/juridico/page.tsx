import type { Metadata } from "next";
import Link from "next/link";
import { Building2, FileText, Scale } from "lucide-react";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { PrecontractCurationPanel } from "@/components/ai/precontract-curation-panel";
import { PrecontractWorkspaceClient } from "@/components/legal/precontract-workspace-client";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialAskCommercialDirectorState } from "@/lib/ai/expert-query-state";
import { askLegalConsultantAction } from "@/lib/ai/legal-query-action";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getProject } from "@/lib/data";
import { getManagedDocuments } from "@/lib/document-management";
import {
  toClassificationSnapshots,
  toPrecontractExistingDocuments,
} from "@/lib/legal/precontract-existing-documents";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Jurídico" };

const CONTRACTUAL_KINDS = new Set(["CONTRATO_BASE", "ADITIVO"]);

export default async function ProjectLegalPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, documents, permission] = await Promise.all([
    getProject(projectId),
    getManagedDocuments(projectId),
    getCurrentProjectPermission(projectId),
  ]);
  if (!project) return null;
  const contractualDocuments = documents.filter((document) =>
    CONTRACTUAL_KINDS.has(document.kind) || Boolean(document.parentDocumentId)
  );
  const isPrecontract = project.workspaceType === "PRE_CONTRATUAL";
  const canUpload = permission === "ADMINISTRADOR" || permission === "GESTOR" || permission === "GERENTE";

  // Documentos ja existentes, carregados NO SERVIDOR e entregues ao card:
  // e isto que faz a tela reconhecer, apos um F5, o arquivo que ja esta
  // la — o usuario nunca precisa reenviar o mesmo documento. Nenhuma
  // query nova: reaproveita o `documents` que a pagina ja buscou.
  const existingLegalDocuments = toPrecontractExistingDocuments(documents);
  const classificationSnapshots = toClassificationSnapshots(documents);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isPrecontract ? "Análise jurídica pré-contratual" : "Jurídico"}
        description={isPrecontract
          ? "Ambiente de negociação da minuta antes da contratação, separado das obras assinadas."
          : "Consulta ao contrato assinado, anexos, aditivos e especialista jurídico."}
      />

      {/* Identificação da análise: oportunidade e cliente sempre visíveis
          no topo — é o que diferencia uma análise pré-contratual de
          outra, e o que o usuário precisa conferir antes de perguntar. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-10 gap-y-3 p-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {isPrecontract ? "Oportunidade" : "Obra"}
            </p>
            <p className="truncate text-lg font-semibold">{project.name}</p>
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="size-3.5" />
              Cliente
            </p>
            <p className="truncate text-lg font-semibold">{project.client}</p>
          </div>
        </CardContent>
      </Card>

      {isPrecontract ? (
        // Análise pré-contratual: card único de documento + consulta, com
        // o botão liberado somente quando há conteúdo extraído.
        <PrecontractWorkspaceClient
          projectId={projectId}
          canUpload={canUpload}
          existingDocuments={existingLegalDocuments}
          classificationSnapshots={classificationSnapshots}
        />
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <div><CardTitle className="flex items-center gap-2"><FileText className="size-5" />Base documental</CardTitle><p className="mt-1 text-sm text-muted-foreground">Contrato ou minuta, anexos, aditivos e respectivos anexos.</p></div>
              <Link href={`/${projectId}/documentos`} className={cn(buttonVariants({ variant: "outline" }))}>Gerenciar documentos</Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {contractualDocuments.length ? contractualDocuments.map((document) => (
                <div key={document.id} className="flex items-center justify-between rounded-md border p-3" title={document.versions[0]?.summary || `Documento contratual: ${document.title}`}>
                  <span className="text-sm font-medium">{document.title}</span>
                  <Badge variant="outline">{document.kind.replaceAll("_", " ")}</Badge>
                </div>
              )) : <p className="text-sm text-muted-foreground">Nenhum contrato, minuta, aditivo ou anexo cadastrado.</p>}
            </CardContent>
          </Card>

          <ExpertQueryPanel
            projectId={projectId}
            scope="PROJECT"
            title="Pergunte ao especialista jurídico"
            action={askLegalConsultantAction}
            initialState={initialAskCommercialDirectorState}
          />
        </>
      )}

      {isPrecontract ? <PrecontractCurationPanel projectId={projectId} /> : null}

      {isPrecontract ? <Link href="/juridico" className="inline-flex items-center gap-2 text-sm text-primary"><Scale className="size-4" />Voltar às análises pré-contratuais</Link> : null}
    </div>
  );
}
