import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeliveryAdminControls } from "@/components/delivery/delivery-admin-controls";
import { DeliveryItemsTable } from "@/components/delivery/delivery-items-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { createSupabaseServerClient } from "@axion/db/server";
import type { RiskReviewHistoryItem } from "@/components/risk/risk-review-panel";
import { getDeliveryOverview } from "@/lib/delivery/delivery-data";
import { loadRiskReviews } from "@/lib/risk-classification/reviewed-severity";

export const metadata: Metadata = { title: "Providências e pendências para entrega" };

function todayDay(): string {
  // Dia corrido em UTC-3 (America/Sao_Paulo): evita virar o dia 3 horas antes no servidor em UTC.
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function ProvidenciasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const overview = await getDeliveryOverview(projectId);
  if (!overview) notFound();

  // Histórico de classificação de risco das providências (uma consulta para a tabela toda).
  const riskHistoryByItem: Record<string, RiskReviewHistoryItem[]> = {};
  if (overview.available && overview.items.length > 0) {
    const reviews = await loadRiskReviews(await createSupabaseServerClient(), {
      sourceType: "DELIVERY_ITEM",
      sourceIds: overview.items.map((item) => item.id),
    });
    const nameById = new Map(overview.members.map((m) => [m.userId, m.name]));
    for (const review of reviews) {
      (riskHistoryByItem[review.sourceId] ??= []).push({
        id: review.id,
        previousLevel: review.previousLevel,
        newLevel: review.newLevel,
        suggestedLevel: review.suggestedLevel,
        justification: review.justification,
        reference: review.reference,
        origin: review.origin,
        reviewerName: review.reviewerUserId ? nameById.get(review.reviewerUserId) ?? null : null,
        createdAt: review.createdAt,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Providências e pendências para entrega"
        description={`${overview.projectName} — tabela única de providências: os alertas usam estes mesmos registros.`}
      />

      {!overview.available ? (
        <EmptyState message="Este módulo ainda não foi habilitado neste ambiente (a migration das providências não foi aplicada)." />
      ) : (
        <>
          {overview.canEdit ? <DeliveryAdminControls projectId={projectId} hasItems={overview.items.length > 0} /> : null}
          {overview.items.length === 0 ? (
            <EmptyState message="Nenhuma providência cadastrada. Cadastre o checklist inicial ou adicione providências específicas da obra." />
          ) : (
            <DeliveryItemsTable
              projectId={projectId}
              items={overview.items}
              members={overview.members}
              projectEndDay={overview.projectEndDay}
              projectStartDay={overview.projectStartDay}
              startCandidates={overview.startCandidates}
              today={todayDay()}
              canEdit={overview.canEdit}
              riskHistoryByItem={riskHistoryByItem}
            />
          )}
        </>
      )}
    </div>
  );
}
