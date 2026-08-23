import Link from "next/link";
import { createSupabaseServerClient } from "@axion/db/server";
import { AdditionalProposalCreateForm } from "@/components/additionals/additional-proposal-create-form";
import { AdditionalProposalStatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getAdditionalProposals } from "@/lib/additionals/get-additional-proposals";
import { formatDate } from "@/lib/labels";

export default async function AdditionalProposalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [proposals, permission] = await Promise.all([
    getAdditionalProposals(await createSupabaseServerClient(), projectId),
    getCurrentProjectPermission(projectId),
  ]);

  const canCreate = permission === "EDITOR" || permission === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Propostas de Adicionais</h1>
        <p className="text-sm text-muted-foreground">
          Escopo, preço e prazo adicionais rastreados por projeto — o contrato-base permanece o instrumento
          vigente; um adicional só é considerado contratado por decisão humana.
        </p>
      </div>

      <Tabs defaultValue="propostas">
        <TabsList>
          <TabsTrigger value="propostas">Propostas ({proposals.length})</TabsTrigger>
          {canCreate ? <TabsTrigger value="nova">+ Nova proposta</TabsTrigger> : null}
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
          <TabsContent value="nova">
            <AdditionalProposalCreateForm projectId={projectId} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
