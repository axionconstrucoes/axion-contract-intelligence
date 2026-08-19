import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { CategoryBadge, SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { CrossReferenceList } from "@/components/ledger/cross-reference-list";
import { EvidenceViewer } from "@/components/ledger/evidence-viewer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEvent, getUser } from "@/lib/data";
import { findingTypeLabels, formatDateTime, sourceTypeShortLabels } from "@/lib/labels";

export default async function EventDetailPage({ params }: { params: Promise<{ projectId: string; eventId: string }> }) {
  const { eventId } = await params;
  const event = await getEvent(eventId);
  if (!event) notFound();

  let creatorLabel: string;
  if (event.createdByType === "LEGACY") {
    // LEGACY: autoria histórica conhecida sem identidade atual na plataforma
    // — nunca chamar getUser, só exibir o registro preservado.
    creatorLabel = `${event.createdBy} (registro histórico)`;
  } else if (event.createdByType === "SYSTEM") {
    creatorLabel = "sistema (ingestão automática)";
  } else if (event.createdByType === "USER") {
    const creator = await getUser(event.createdBy);
    creatorLabel = creator?.name ?? "Usuário não disponível";
  } else {
    // Compatibilidade transitória: createdByType ausente (mocks antigos).
    const creator = event.createdBy === "sistema" ? null : await getUser(event.createdBy);
    creatorLabel =
      event.createdBy === "sistema"
        ? "sistema (ingestão automática)"
        : (creator?.name ?? "Usuário não disponível");
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDateTime(event.timestamp)}</span>
          <span>·</span>
          <span>{sourceTypeShortLabels[event.sourceType]}</span>
          <span>·</span>
          <span>Registrado por {creatorLabel}</span>
        </div>
        <h1 className="mt-1 text-lg font-semibold">{event.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={event.status} />
          {event.categories.map((c) => (
            <CategoryBadge key={c} category={c} />
          ))}
        </div>
      </div>

      {event.aiAssessment && (
        <Card className="border-severity-alta/30 bg-severity-alta/5">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <ShieldAlert className="size-4 text-severity-alta" />
            <CardTitle>Achado da IA — {findingTypeLabels[event.aiAssessment.findingType]}</CardTitle>
            <SeverityBadge severity={event.aiAssessment.severity} />
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-0">
            <p className="text-sm">{event.aiAssessment.summary}</p>
            <p className="text-xs text-muted-foreground">
              Confiança estimada: {Math.round(event.aiAssessment.confidence * 100)}% — sugestão sujeita a revisão humana, não substitui decisão da equipe.
            </p>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Evidência original</h2>
        <EvidenceViewer evidences={event.evidence} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Confronto com outras fontes</h2>
        <CrossReferenceList crossReferences={event.crossReferences} />
      </div>
    </div>
  );
}
