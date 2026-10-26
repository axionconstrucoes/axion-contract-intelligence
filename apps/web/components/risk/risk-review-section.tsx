import { createSupabaseServerClient } from "@axion/db/server";

import { reviewRiskClassificationAction } from "@/app/[projectId]/risco/actions";
import { RiskReviewPanel, type RiskReviewHistoryItem } from "@/components/risk/risk-review-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getUser } from "@/lib/data";
import { loadRiskSourceContext } from "@/lib/risk-classification/load-risk-source-context";

function today(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // dia corrido em America/Sao_Paulo
}

/** Seção "Classificação de risco" de um evento do Event Ledger (server component). */
export async function EventRiskReviewSection({ projectId, eventId }: { projectId: string; eventId: string }) {
  const supabase = await createSupabaseServerClient();
  const [context, permission] = await Promise.all([
    loadRiskSourceContext(supabase, { projectId, sourceType: "CONTRACT_EVENT", sourceId: eventId, today: today() }),
    getCurrentProjectPermission(projectId),
  ]);
  if (!context) return null;

  const reviewerIds = Array.from(new Set(context.history.map((h) => h.reviewerUserId).filter((id): id is string => Boolean(id))));
  const reviewers = new Map(
    await Promise.all(reviewerIds.map(async (id) => [id, (await getUser(id).catch(() => null))?.name ?? null] as const))
  );
  const history: RiskReviewHistoryItem[] = context.history.map((h) => ({
    id: h.id,
    previousLevel: h.previousLevel,
    newLevel: h.newLevel,
    suggestedLevel: h.suggestedLevel,
    justification: h.justification,
    reference: h.reference,
    origin: h.origin,
    reviewerName: h.reviewerUserId ? reviewers.get(h.reviewerUserId) ?? null : null,
    createdAt: h.createdAt,
  }));
  const canReview = permission === "ADMINISTRADOR" || permission === "GESTOR" || permission === "GERENTE";

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle>Classificação de risco</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <RiskReviewPanel
          action={reviewRiskClassificationAction.bind(null, projectId, "CONTRACT_EVENT", eventId)}
          currentLevel={context.currentLevel}
          originalLevel={context.originalLevel}
          originalLabel="Classificação da IA"
          canReview={canReview}
          verifiedClause={context.verifiedClause}
          obligationDescription={context.obligationDescription}
          evidence={context.evidence}
          recordDeadline={null}
          history={history}
        />
      </CardContent>
    </Card>
  );
}
