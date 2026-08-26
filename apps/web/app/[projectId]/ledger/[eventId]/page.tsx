import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { CategoryBadge, ConfrontationCandidateStatusBadge, SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { ConfrontationReviewForms } from "@/components/ledger/confrontation-review-forms";
import { CrossReferenceList } from "@/components/ledger/cross-reference-list";
import { EmailAlertActionHistoryPanel } from "@/components/email-actions/email-alert-action-history-panel";
import { EventNotesSection } from "@/components/ledger/event-notes-section";
import { EvidenceViewer } from "@/components/ledger/evidence-viewer";
import { SendContractAlertForm } from "@/components/ledger/send-contract-alert-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getEvent, getUser } from "@/lib/data";
import { getEventClauseConfrontationCandidates } from "@/lib/event-clause-confrontation-review";
import { alertRiskLevelLabels } from "@/lib/email/templates/contract-alert-template";
import {
  confrontationSeverityToAlertSeverity,
  findingTypeLabels,
  formatDateTime,
  sourceTypeShortLabels,
} from "@/lib/labels";

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; eventId: string }>;
  searchParams: Promise<{ respond?: string; riskLevel?: string; alertId?: string }>;
}) {
  const { projectId, eventId } = await params;
  const resolvedSearchParams = await searchParams;
  const arrivedFromAlertEmail = resolvedSearchParams.respond === "acc";
  const alertRiskLevel = resolvedSearchParams.riskLevel as keyof typeof alertRiskLevelLabels | undefined;

  const [event, confrontationCandidates, permission] = await Promise.all([
    getEvent(eventId),
    getEventClauseConfrontationCandidates(eventId),
    getCurrentProjectPermission(projectId),
  ]);

  if (!event) notFound();

  const canReview = permission === "ADMINISTRADOR";

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
      {arrivedFromAlertEmail && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
          Você chegou aqui a partir de um alerta de{" "}
          {alertRiskLevel && alertRiskLevelLabels[alertRiskLevel]
            ? `risco ${alertRiskLevelLabels[alertRiskLevel]}`
            : "risco"}{" "}
          enviado por e-mail. Sua resposta em &quot;Anotações do Evento&quot; abaixo fica registrada e vinculada a
          este evento.
        </div>
      )}

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
          <CardContent className="flex flex-col gap-3 pt-0">
            <p className="text-sm">{event.aiAssessment.summary}</p>
            <p className="text-xs text-muted-foreground">
              Confiança estimada: {Math.round(event.aiAssessment.confidence * 100)}% — sugestão sujeita a revisão humana, não substitui decisão da equipe.
            </p>
            {canReview && <SendContractAlertForm projectId={projectId} eventId={event.id} />}
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

      <div id="responder-ao-acc">
        <EventNotesSection projectId={projectId} eventId={event.id} canReview={canReview} />
      </div>

      {/* contract_events não tem responsável/prazo/ciência nativos —
          DAR CIÊNCIA/ASSUMIR RESPONSABILIDADE/DEFINIR PRAZO via e-mail
          (RESPONDER AO ACC já aparece em Anotações do Evento acima)
          só existem aqui (ver relatório da feature de e-mail acionável). */}
      <EmailAlertActionHistoryPanel alertKind="CONTRACT_EVENT" alertId={event.id} />

      <div>
        <h2 className="mb-2 text-sm font-semibold">Confrontação contratual — Revisão humana</h2>

        {confrontationCandidates.length === 0 ? (
          <EmptyState message="Nenhum candidato de confronto Evento x Cláusula para este evento." />
        ) : (
          <div className="flex flex-col gap-4">
            {confrontationCandidates.map((candidate) => (
              <Card key={candidate.id}>
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        Cláusula {candidate.clauseNumber}
                      </p>
                      <CardTitle className="text-base">{candidate.clauseTitle}</CardTitle>
                    </div>

                    <div className="rounded-full border px-3 py-1 text-xs font-medium">
                      Confiança {Math.round(candidate.confidence * 100)}%
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <ConfrontationCandidateStatusBadge status={candidate.status} />
                    <Badge variant="outline">{findingTypeLabels[candidate.findingType]}</Badge>
                    <SeverityBadge severity={confrontationSeverityToAlertSeverity[candidate.severity]} />
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                  <p className="text-sm">{candidate.summary}</p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Fundamento do evento</p>
                      <p className="mt-1 text-muted-foreground">{candidate.eventBasis}</p>
                    </div>

                    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Fundamento da cláusula</p>
                      <p className="mt-1 text-muted-foreground">{candidate.clauseBasis}</p>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Produzido por análise automatizada ({candidate.analyzer} v{candidate.analyzerVersion}) — exige
                    revisão humana antes de gerar confronto definitivo.
                  </p>

                  {candidate.status !== "PENDING_REVIEW" ? (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                      <p>
                        {candidate.status === "APPROVED" ? "Aprovado" : "Rejeitado"} em{" "}
                        {candidate.reviewedAt ? formatDateTime(candidate.reviewedAt) : "data não disponível"}.
                      </p>
                      {candidate.reviewNote ? <p className="mt-1">Observação: {candidate.reviewNote}</p> : null}
                    </div>
                  ) : canReview ? (
                    <ConfrontationReviewForms
                      projectId={projectId}
                      eventId={event.id}
                      candidateId={candidate.id}
                    />
                  ) : (
                    <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                      Você possui acesso de leitura. Aprovação ou rejeição exige permissão EDITOR ou ADMIN.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ExpertQueryPanel projectId={projectId} eventId={event.id} scope="EVENT" />
    </div>
  );
}
