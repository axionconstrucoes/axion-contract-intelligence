import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@axion/db/server";
import { AdditionalProposalCreateForm } from "@/components/additionals/additional-proposal-create-form";
import { PageHeader } from "@/components/layout/page-header";
import { AdditionalProposalStatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getAdditionalProposals } from "@/lib/additionals/get-additional-proposals";
import { isProposalDriveFixtureAllowed } from "@/lib/additionals/proposal-drive-lookup/get-proposal-drive-lookup-client";
import { listOrcamentosProposalFolders } from "@/lib/additionals/proposal-drive-lookup/list-orcamentos-proposals";
import { formatDate } from "@/lib/labels";

export const metadata: Metadata = { title: "Adicionais" };

export default async function AdditionalProposalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [proposals, permission, driveProposalFolders] = await Promise.all([
    getAdditionalProposals(await createSupabaseServerClient(), projectId),
    getCurrentProjectPermission(projectId),
    listOrcamentosProposalFolders(),
  ]);

  const canCreate = permission === "ADMINISTRADOR";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Propostas de Adicionais"
        description="Escopo, preço e prazo adicionais rastreados por projeto — o contrato-base permanece o instrumento vigente; um adicional só é considerado contratado por decisão humana."
      />

      <Tabs defaultValue="propostas">
        <TabsList>
          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="propostas">Propostas ({proposals.length})</TabsTrigger>
            <FeatureInfo helpId="adicionais-tab-propostas" />
          </span>
          {canCreate ? (
            <span className="inline-flex items-center gap-1">
              <TabsTrigger value="nova">+ Nova proposta</TabsTrigger>
              <FeatureInfo helpId="adicionais-nova-proposta" />
            </span>
          ) : null}
        </TabsList>

        <TabsContent value="propostas" className="flex flex-col gap-3">
          {proposals.length === 0 ? (
            <EmptyState message="Nenhuma proposta de adicional. Cadastre a primeira na aba “+ Nova proposta”." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {proposals.map((proposal) => (
                <Link key={proposal.id} href={`/${projectId}/adicionais/${proposal.id}`}>
                  <Card className="flex h-full flex-col transition-colors hover:border-primary">
                    <CardHeader className="gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm">{proposal.proposalNumber}</CardTitle>
                        <AdditionalProposalStatusBadge status={proposal.status} />
                      </div>
                      <p className="text-xs font-medium">{proposal.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{proposal.description || "Sem descrição."}</p>
                    </CardHeader>
                    <CardContent className="mt-auto text-xs text-muted-foreground">
                      {proposal.proposalDate ? `Data: ${formatDate(proposal.proposalDate)}` : `Criado em ${formatDate(proposal.createdAt)}`}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {canCreate ? (
          <TabsContent value="nova" className="flex flex-col gap-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              Nova proposta de adicional
              <FeatureInfo helpId="adicionais-nova-proposta" />
            </h2>
            <AdditionalProposalCreateForm
              projectId={projectId}
              driveProposalFolders={driveProposalFolders}
              driveIntegrationConfigured={isProposalDriveFixtureAllowed()}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
