import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Scale } from "lucide-react";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { PrecontractCurationPanel } from "@/components/ai/precontract-curation-panel";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialAskCommercialDirectorState } from "@/lib/ai/expert-query-state";
import { askLegalConsultantAction } from "@/lib/ai/legal-query-action";
import { getProject } from "@/lib/data";
import { getManagedDocuments } from "@/lib/document-management";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Jurídico" };

const CONTRACTUAL_KINDS = new Set(["CONTRATO_BASE", "ADITIVO"]);

export default async function ProjectLegalPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, documents] = await Promise.all([getProject(projectId), getManagedDocuments(projectId)]);
  if (!project) return null;
  const contractualDocuments = documents.filter((document) =>
    CONTRACTUAL_KINDS.has(document.kind) || Boolean(document.parentDocumentId)
  );
  const isPrecontract = project.workspaceType === "PRE_CONTRATUAL";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isPrecontract ? "Análise jurídica pré-contratual" : "Jurídico"}
        description={isPrecontract
          ? "Ambiente de negociação da minuta antes da contratação, separado das obras assinadas."
          : "Consulta ao contrato assinado, anexos, aditivos e especialista jurídico."}
      />

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

      {isPrecontract ? <PrecontractCurationPanel projectId={projectId} /> : null}

      <ExpertQueryPanel
        projectId={projectId}
        scope="PROJECT"
        title="Pergunte ao especialista jurídico"
        action={askLegalConsultantAction}
        initialState={initialAskCommercialDirectorState}
      />

      {isPrecontract ? <Link href="/juridico" className="inline-flex items-center gap-2 text-sm text-primary"><Scale className="size-4" />Voltar às análises pré-contratuais</Link> : null}
    </div>
  );
}
