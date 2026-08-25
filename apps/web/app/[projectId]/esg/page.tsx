import type { Metadata } from "next";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { EsgManagerialSummary, type EsgManagerialRow } from "@/components/esg/esg-managerial-summary";
import { EsgObligationForm } from "@/components/esg/esg-obligation-form";
import { EsgReviewForm } from "@/components/esg/esg-review-form";
import { EsgSubmissionForm } from "@/components/esg/esg-submission-form";
import { EsgTechnicianPendingList, type EsgPendingItem } from "@/components/esg/esg-technician-pending-list";
import { PageHeader } from "@/components/layout/page-header";
import { SeverityBadge } from "@/components/shared/badges";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { askEsgDirectorAction } from "@/lib/ai/esg-query-action";
import { canEditProjectContent, getCurrentProjectPermission, isProjectAdministrator } from "@/lib/contract-review";
import { getClauses } from "@/lib/data";
import { computeObligationRisk } from "@/lib/esg/compute-obligation-risk";
import {
  getEsgObligationEvidenceForProject,
  getEsgObligationSubmissionsForProject,
  getEsgObligations,
} from "@/lib/esg/esg-obligations-data";
import type { EsgObligationEvidence, EsgObligationSubmission } from "@/lib/esg/types";
import {
  confrontationSeverityToAlertSeverity,
  esgObligationCategoryLabels,
  esgObligationPeriodicityLabels,
  esgObligationStatusLabels,
  esgEvidenceKindLabels,
  formatDate,
  formatDateTime,
} from "@/lib/labels";

export const metadata: Metadata = { title: "ESG / SSMA" };

export default async function EsgObligationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [obligations, submissions, evidence, permission, clauses] = await Promise.all([
    getEsgObligations(projectId),
    getEsgObligationSubmissionsForProject(projectId),
    getEsgObligationEvidenceForProject(projectId),
    getCurrentProjectPermission(projectId),
    getClauses(projectId),
  ]);

  const canFill = canEditProjectContent(permission);
  const canConfigure = canEditProjectContent(permission);
  const canReview = isProjectAdministrator(permission);

  const submissionsByObligationId = new Map<string, EsgObligationSubmission[]>();
  for (const submission of submissions) {
    const list = submissionsByObligationId.get(submission.obligationId) ?? [];
    list.push(submission);
    submissionsByObligationId.set(submission.obligationId, list);
  }

  const evidenceBySubmissionId = new Map<string, EsgObligationEvidence[]>();
  for (const item of evidence) {
    const list = evidenceBySubmissionId.get(item.submissionId) ?? [];
    list.push(item);
    evidenceBySubmissionId.set(item.submissionId, list);
  }

  const today = new Date().toISOString().slice(0, 10);

  const pendingItems: EsgPendingItem[] = [];
  const managerialRows: EsgManagerialRow[] = [];

  for (const obligation of obligations) {
    // submissions já vem ordenado por reference_date desc (ver
    // getEsgObligationSubmissionsForProject) — o primeiro é o mais recente.
    const obligationSubmissions = submissionsByObligationId.get(obligation.id) ?? [];
    const latest = obligationSubmissions[0] ?? null;
    const latestEvidenceCount = latest ? (evidenceBySubmissionId.get(latest.id)?.length ?? 0) : 0;
    const previous = obligationSubmissions[1] ?? null;

    const risk = latest
      ? computeObligationRisk({
          status: latest.status,
          dueDate: latest.dueDate,
          today,
          requiresEvidence: Boolean(obligation.requiredEvidenceDescription),
          evidenceCount: latestEvidenceCount,
          hasPenaltyDescribed: Boolean(obligation.penaltyDescription),
          previousRiskLevel: previous?.riskLevel ?? null,
        })
      : null;

    managerialRows.push({
      obligationId: obligation.id,
      title: obligation.title,
      category: obligation.category,
      responsibleLabel: obligation.responsibleLabel ?? obligation.responsibleName,
      latestStatus: latest?.status ?? null,
      latestRisk: risk?.riskLevel ?? null,
      latestReferenceDate: latest?.referenceDate ?? null,
    });

    const needsAttention =
      !latest || latest.status === "PENDENTE" || latest.status === "NAO_CUMPRIDO" || latest.status === "CUMPRIDO_PARCIALMENTE";

    if (needsAttention) {
      pendingItems.push({
        obligationId: obligation.id,
        title: obligation.title,
        category: obligation.category,
        dueDate: latest?.dueDate ?? null,
        requiredEvidenceDescription: obligation.requiredEvidenceDescription,
        evidenceCount: latestEvidenceCount,
        hasSubmission: Boolean(latest),
      });
    }
  }

  const clauseOptions = clauses.map((c) => ({
    id: c.id,
    label: `Cláusula ${c.clauseNumber} — ${c.title}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          title="Comprovação de Obrigações ESG/SSMA"
          description="Obrigações contratuais de ESG/SSMA — prazo, comprovação, evidência, status e risco de penalidade. Não é um sistema de ESG corporativo nem de gestão operacional de segurança do trabalho."
        />
      </div>

      <Tabs defaultValue="pendencias">
        <TabsList>
          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="pendencias">Minhas pendências</TabsTrigger>
            <FeatureInfo helpId="esg-tab-pendencias" />
          </span>
          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="gerencial">Visão gerencial</TabsTrigger>
            <FeatureInfo helpId="esg-tab-gerencial" />
          </span>
          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="checklist">Checklist do projeto</TabsTrigger>
            <FeatureInfo helpId="esg-tab-checklist" />
          </span>
          <span className="inline-flex items-center gap-1">
            <TabsTrigger value="consultar">Diretor de ESG IA</TabsTrigger>
            <FeatureInfo helpId="esg-tab-consultar" />
          </span>
        </TabsList>

        <TabsContent value="pendencias">
          <EsgTechnicianPendingList items={pendingItems} />
        </TabsContent>

        <TabsContent value="gerencial">
          <EsgManagerialSummary rows={managerialRows} />
        </TabsContent>

        <TabsContent value="checklist" className="flex flex-col gap-4">
          {canConfigure ? (
            <Card>
              <CardHeader>
                <CardTitle>Nova obrigação</CardTitle>
              </CardHeader>
              <CardContent>
                <EsgObligationForm projectId={projectId} clauseOptions={clauseOptions} />
              </CardContent>
            </Card>
          ) : null}

          {obligations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma obrigação ESG/SSMA configurada para este projeto.</p>
          ) : (
            obligations.map((obligation) => {
              const obligationSubmissions = submissionsByObligationId.get(obligation.id) ?? [];
              return (
                <Card key={obligation.id}>
                  <CardHeader className="gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{obligation.title}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {esgObligationCategoryLabels[obligation.category]} · {esgObligationPeriodicityLabels[obligation.periodicity]}
                        </p>
                      </div>
                      {!obligation.active ? <Badge variant="outline">Inativa</Badge> : null}
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {obligation.clauseNumber ? <span>Cláusula {obligation.clauseNumber}</span> : null}
                      {obligation.sourceReference ? <span>{obligation.sourceReference}</span> : null}
                      {obligation.sourceDocumentTitle ? <span>Fonte: {obligation.sourceDocumentTitle}</span> : null}
                      {obligation.responsibleLabel ?? obligation.responsibleName ? (
                        <span>Responsável: {obligation.responsibleLabel ?? obligation.responsibleName}</span>
                      ) : null}
                      {obligation.requiredEvidenceDescription ? (
                        <span>Evidência exigida: {obligation.requiredEvidenceDescription}</span>
                      ) : null}
                      {obligation.penaltyDescription ? <span>Penalidade: {obligation.penaltyDescription}</span> : null}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-4">
                    {obligationSubmissions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma comprovação registrada ainda.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {obligationSubmissions.map((submission) => {
                          const submissionEvidence = evidenceBySubmissionId.get(submission.id) ?? [];
                          return (
                            <li key={submission.id} className="rounded-md border bg-muted/30 p-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {submission.referencePeriodLabel ?? formatDate(submission.referenceDate)}
                                </span>
                                <Badge variant="outline">{esgObligationStatusLabels[submission.status]}</Badge>
                                {submission.riskLevel ? (
                                  <SeverityBadge severity={confrontationSeverityToAlertSeverity[submission.riskLevel]} />
                                ) : null}
                                <span className="text-xs text-muted-foreground">
                                  preenchido por {submission.filledByName ?? "usuário não disponível"} em{" "}
                                  {formatDateTime(submission.createdAt)}
                                </span>
                              </div>

                              {submission.description ? <p className="mt-1">{submission.description}</p> : null}
                              {submission.observation ? (
                                <p className="mt-1 text-xs text-muted-foreground">Obs.: {submission.observation}</p>
                              ) : null}
                              {submission.justification ? (
                                <p className="mt-1 text-xs text-muted-foreground">Justificativa: {submission.justification}</p>
                              ) : null}

                              {submissionEvidence.length > 0 ? (
                                <ul className="mt-2 flex flex-wrap gap-2">
                                  {submissionEvidence.map((file) => (
                                    <li key={file.id} className="rounded border px-2 py-1 text-xs">
                                      {esgEvidenceKindLabels[file.evidenceKind]}: {file.originalFileName}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}

                              {submission.reviewedByName ? (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Revisado por {submission.reviewedByName} em{" "}
                                  {submission.reviewedAt ? formatDateTime(submission.reviewedAt) : "data não disponível"}
                                  {submission.reviewNote ? ` — ${submission.reviewNote}` : ""}
                                </p>
                              ) : null}

                              {canReview ? (
                                <div className="mt-2">
                                  <EsgReviewForm
                                    projectId={projectId}
                                    submissionId={submission.id}
                                    currentStatus={submission.status}
                                  />
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {canFill ? (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium">Registrar nova comprovação</summary>
                        <div className="pt-3">
                          <EsgSubmissionForm
                            projectId={projectId}
                            obligationId={obligation.id}
                            isDds={obligation.category === "DDS"}
                          />
                        </div>
                      </details>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="consultar">
          <ExpertQueryPanel
            projectId={projectId}
            scope="PROJECT"
            title="Diretor de ESG IA"
            action={askEsgDirectorAction}
            initialState={{ response: null, error: null, meta: null }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
