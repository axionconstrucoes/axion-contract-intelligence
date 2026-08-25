import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";
import { AdditionalProposalApprovalsForm } from "@/components/additionals/additional-proposal-approvals-form";
import { AdditionalProposalChecklist } from "@/components/additionals/additional-proposal-checklist";
import { AdditionalProposalContractedForm } from "@/components/additionals/additional-proposal-contracted-form";
import { AdditionalProposalCurationPanel } from "@/components/additionals/additional-proposal-curation-panel";
import { AdditionalProposalStatusForm } from "@/components/additionals/additional-proposal-status-form";
import { AdditionalProposalStatusBadge, SeverityBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdditionalProposal, getAdditionalProposalLinks, getAdditionalProposals } from "@/lib/additionals/get-additional-proposals";
import { suggestExistingSourcesForProposal } from "@/lib/additionals/suggest-existing-sources";
import { computeScheduleFormalizationAlert } from "@/lib/additionals/schedule-formalization-alert";
import { computeClosingGateAssessment } from "@/lib/additionals/closing-gate";
import { additionalProposalFormalizationTypeLabels, confrontationSeverityToAlertSeverity, formatDate, formatDateTime } from "@/lib/labels";

export default async function AdditionalProposalDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; proposalId: string }>;
}) {
  const { projectId, proposalId } = await params;
  const supabase = await createSupabaseServerClient();

  const proposal = await getAdditionalProposal(supabase, proposalId);
  if (!proposal || proposal.projectId !== projectId) notFound();

  const [links, suggestions, allProposals] = await Promise.all([
    getAdditionalProposalLinks(supabase, proposalId),
    suggestExistingSourcesForProposal(supabase, projectId, proposal.proposalNumber),
    getAdditionalProposals(supabase, projectId),
  ]);

  const scheduleAlert = computeScheduleFormalizationAlert(proposal);
  const closingGate = computeClosingGateAssessment(proposal, allProposals);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            {proposal.proposalNumber} — {proposal.title}
          </h1>
          <p className="text-sm text-muted-foreground">{proposal.description || "Sem descrição."}</p>
        </div>
        <AdditionalProposalStatusBadge status={proposal.status} />
      </div>

      {scheduleAlert.active ? (
        <div className="flex items-center gap-2 rounded-md border border-severity-alta/40 bg-severity-alta/10 p-3 text-sm">
          <SeverityBadge severity={scheduleAlert.severity === "HIGH" ? "ALTA" : "MEDIA"} />
          <span className="font-semibold">{scheduleAlert.message}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Dados da proposta</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p>Origem: {proposal.sourceType === "DRIVE" ? "Google Drive" : proposal.sourceType === "MANUAL" ? "Manual" : "Fonte existente no ACC"}</p>
          {proposal.driveUrl ? <p>Drive: {proposal.driveUrl}</p> : null}
          {proposal.proposalDate ? <p>Data: {formatDate(proposal.proposalDate)}</p> : null}
          {proposal.proposedValue != null ? <p>Valor proposto: {proposal.proposedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p> : null}
          {proposal.note ? <p className="sm:col-span-2">Observação: {proposal.note}</p> : null}
          <p className="sm:col-span-2 text-xs text-muted-foreground">Criado em {formatDateTime(proposal.createdAt)}</p>
        </CardContent>
      </Card>

      {proposal.status !== "CONTRACTED" ? (
        <AdditionalProposalStatusForm projectId={projectId} proposalId={proposal.id} currentStatus={proposal.status} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Contratação</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <p>Data: {proposal.contractedAt ? formatDate(proposal.contractedAt) : "—"}</p>
            {proposal.contractedValue != null ? (
              <p>Valor contratado: {proposal.contractedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
            ) : null}
            <p>Formalização: {proposal.formalizationType ? additionalProposalFormalizationTypeLabels[proposal.formalizationType] : "—"}</p>
            <p>Execução iniciada: {proposal.executionStarted ? "Sim" : "Não"}</p>
            {proposal.reservationRisk ? (
              <div className="sm:col-span-2 rounded bg-severity-alta/10 p-2">
                <p className="font-medium text-severity-alta">Formalização com ressalva</p>
                {proposal.reservationConflictingClause ? <p>Cláusula conflitante: {proposal.reservationConflictingClause}</p> : null}
                <p>Risco: {proposal.reservationRisk}</p>
                {proposal.reservationRecommendation ? <p>Recomendação: {proposal.reservationRecommendation}</p> : null}
                <p className="italic">Decisão humana necessária.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      <AdditionalProposalApprovalsForm projectId={projectId} proposal={proposal} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Gate de fechamento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Recomendação: {closingGate.recommendation}</Badge>
            <span className="flex items-center gap-1.5 text-xs">
              Impacto acumulado: <SeverityBadge severity={confrontationSeverityToAlertSeverity[closingGate.cumulativeImpactStatus]} />
            </span>
            <Badge variant="outline">Contratual: {closingGate.contractualStatus}</Badge>
          </div>
          {closingGate.missingInformation.length > 0 ? (
            <ul className="ml-4 list-disc text-xs text-muted-foreground">
              {closingGate.missingInformation.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs italic text-muted-foreground">Decisão humana sempre necessária — a IA nunca executa contratação.</p>
        </CardContent>
      </Card>

      {proposal.status !== "CONTRACTED" ? <AdditionalProposalContractedForm projectId={projectId} proposalId={proposal.id} /> : null}

      <AdditionalProposalChecklist projectId={projectId} proposalId={proposal.id} links={links} suggestions={suggestions} />

      <AdditionalProposalCurationPanel proposalId={proposal.id} />
    </div>
  );
}
