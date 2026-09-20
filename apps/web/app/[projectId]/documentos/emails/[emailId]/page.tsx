import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentDownloadButton } from "@/components/documents/document-download-button";
import {
  INTAKE_STATUS_LABELS,
  RISK_LABELS,
  riskBadgeClassName,
} from "@/components/documents/email-registry/email-registry-panel";
import {
  BaselineSelectorForm,
  ClassificationConfirmForm,
  IntakeReviewForm,
} from "@/components/documents/email-registry/email-registry-review-forms";
import { WeeklyReportWorkbookSection } from "@/components/documents/email-registry/weekly-report-workbook-section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getProjects } from "@/lib/data";
import { isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { getEmailDocumentDetail } from "@/lib/email/registry/email-document-registry-data";
import { EMAIL_CLASSIFICATION_LABELS } from "@/lib/email/registry/email-document-registry-shared";
import { resolveAttachmentOpenBehavior } from "@/lib/email/registry/resolve-attachment-open-behavior";
import { hasProjectEditPermission } from "@/lib/users/project-permission";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "E-mail · Documentos" };

// Detalhe de UM envio por e-mail (pacote documental): metadados, TODOS
// os anexos do mesmo message_id (abrir/baixar com fallback seguro por
// formato), decisão da ingestão semanal, cronograma MPP + comparações,
// planilha Excel do relatório semanal (Curva S, Linha de Base, Financeiro,
// Histograma, SSMA), risco, revisão humana e histórico auditado. Toda leitura via client de sessão (RLS).

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function valueOrDash(value: unknown, suffix = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  return `${value}${suffix}`;
}

export default async function EmailDocumentDetailPage({ params }: { params: Promise<{ projectId: string; emailId: string }> }) {
  const { projectId, emailId } = await params;
  if (!isWeeklyReportsEnabled()) notFound();
  const [detail, permission, projects] = await Promise.all([getEmailDocumentDetail(projectId, emailId), getCurrentProjectPermission(projectId), getProjects()]);
  if (!detail) notFound();

  const { email, attachments, intake, scheduleVersion, comparisons, workbooks, reviewEvents, activeBaseline, extractedScheduleVersions } = detail;
  const isAdmin = permission === "ADMINISTRADOR";
  const canEdit = hasProjectEditPermission(permission);
  const otherProjects = projects.filter((project) => project.id !== projectId).map((project) => ({ id: project.id, label: `${project.code} — ${project.name}` }));
  const isWeeklyReport = email.classification === "RELATORIO_SEMANAL" || intake !== null;
  const attachmentOptions = Object.entries(EMAIL_CLASSIFICATION_LABELS)
    .map(([value, label]) => ({ value, label }))
    .concat([
      { value: "RELATORIO_SEMANAL_PLANEJAMENTO", label: "Planilha do relatório semanal (Curva S / Linha de Base / Financeiro / Histograma / SSMA)" },
      { value: "CRONOGRAMA_MPP", label: "Cronograma MPP" },
    ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={email.subject}
        description={`${email.direction ?? "—"} · ${formatDateTime(email.sentAt)} · ${email.fromAddress} → ${email.toAddress}`}
        actions={
          <Link href={`/${projectId}/documentos?tab=registro-email`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
            ← Registro por e-mail
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Metadados do e-mail</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs sm:grid-cols-2">
            <div><span className="text-muted-foreground">Projeto:</span> {projectId}</div>
            <div><span className="text-muted-foreground">Caixa monitorada:</span> {valueOrDash(email.mailboxAddress)}</div>
            <div><span className="text-muted-foreground">message_id (Gmail):</span> <code>{valueOrDash(email.providerMessageId)}</code></div>
            <div><span className="text-muted-foreground">thread_id:</span> <code>{valueOrDash(email.providerThreadId)}</code></div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Message-ID (cabeçalho):</span> <code className="break-all">{valueOrDash(email.messageIdHeader)}</code></div>
            <div><span className="text-muted-foreground">Direção:</span> {valueOrDash(email.direction)}</div>
            <div><span className="text-muted-foreground">Labels/pasta:</span> {email.providerLabels.length ? email.providerLabels.join(", ") : "—"}</div>
            <div><span className="text-muted-foreground">Origem da sincronização:</span> Gmail Inbound Sync (caixa corporativa AXION)</div>
            <div><span className="text-muted-foreground">Semana da obra:</span> {email.workWeekLabel ?? "não identificada"} {email.workWeekStatus === "NOT_IDENTIFIED" ? <Badge variant="outline" className="ml-1 border-violet-600 text-violet-700">revisão</Badge> : null}</div>
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Classificação:</span> {email.classification ? EMAIL_CLASSIFICATION_LABELS[email.classification] : "Não classificado"} ({email.classificationStatus}
              {email.classificationConfidence !== null ? `, confiança ${Math.round(email.classificationConfidence * 100)}%` : ""})
              {email.sentToClient ? <Badge variant="outline" className="ml-2">Enviado ao cliente</Badge> : null}
              {email.classificationReasons.length ? <span className="block text-muted-foreground">Motivos: {email.classificationReasons.join("; ")}</span> : null}
            </div>
            {canEdit ? (
              <div className="sm:col-span-2">
                <ClassificationConfirmForm projectId={projectId} emailId={email.id} emailAttachmentId={null} current={email.classification} options={Object.entries(EMAIL_CLASSIFICATION_LABELS).map(([value, label]) => ({ value, label }))} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Envio semanal (ingestão)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            {intake ? (
              <>
                <div>
                  <span className="text-muted-foreground">Status:</span> <strong>{INTAKE_STATUS_LABELS[intake.status] ?? intake.status}</strong>
                </div>
                <div><span className="text-muted-foreground">Regra:</span> <code>{intake.decisionRule}</code></div>
                <div><span className="text-muted-foreground">Escalão (Matriz):</span> {valueOrDash(intake.senderTier)}</div>
                <div><span className="text-muted-foreground">Semana civil / obra:</span> {intake.weekStart} / {intake.workWeekLabel ?? "—"}</div>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {intake.decisionReasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
                {intake.failureError ? <p className="text-destructive">Erro: {intake.failureError}</p> : null}
                {intake.duplicateOfDocumentVersionId ? <p>Arquivo já conhecido: document_version <code>{intake.duplicateOfDocumentVersionId}</code> (nenhuma versão nova; envio conta como recebido).</p> : null}
                {intake.documentVersionId ? <p>Versão criada: <code>{intake.documentVersionId}</code></p> : null}
                {intake.reviewedAt ? <p className="text-muted-foreground">Última revisão: {formatDateTime(intake.reviewedAt)} — {intake.reviewNote}</p> : null}
              </>
            ) : (
              <p className="text-muted-foreground">Este e-mail não foi avaliado pela ingestão semanal de cronograma.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Anexos ({attachments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum anexo ingerido para este message_id (o inbound sync grava metadados; anexos são baixados pela ingestão quando a mensagem é candidata).</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Ext.</TableHead>
                    <TableHead>MIME</TableHead>
                    <TableHead className="text-right">Tamanho</TableHead>
                    <TableHead>SHA-256</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Classificação</TableHead>
                    <TableHead>Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attachments.map((attachment) => {
                    const behavior = resolveAttachmentOpenBehavior(attachment);
                    const isSelected = intake?.selectedEmailAttachmentId === attachment.id;
                    return (
                      <TableRow key={attachment.id} data-testid="email-attachment-row">
                        <TableCell className="max-w-[260px] text-xs">
                          <span className="block truncate" title={attachment.fileName}>{attachment.fileName}</span>
                          {isSelected ? <Badge variant="outline">anexo principal</Badge> : null}
                        </TableCell>
                        <TableCell className="text-xs">{attachment.extension || "—"}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-xs" title={attachment.mimeType}>{attachment.mimeType}</TableCell>
                        <TableCell className="text-right text-xs">{formatBytes(attachment.sizeBytes)}</TableCell>
                        <TableCell className="text-xs"><code title={attachment.sha256Hash}>{attachment.sha256Hash.slice(0, 12)}…</code></TableCell>
                        <TableCell className="max-w-[160px] truncate text-xs" title={`${attachment.storageBucket}/${attachment.storagePath}`}>{attachment.storageBucket}</TableCell>
                        <TableCell className="text-xs">{attachment.processingStatus}{attachment.documentVersionId ? " · documento" : ""}</TableCell>
                        <TableCell className="text-xs">
                          <span className="block">Sugerida: {valueOrDash(attachment.suggestedClassification)}{attachment.classificationConfidence !== null ? ` (${Math.round(attachment.classificationConfidence * 100)}%)` : ""}</span>
                          <span className="block">Confirmada: {valueOrDash(attachment.confirmedClassification)}</span>
                          {canEdit ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-muted-foreground">Corrigir</summary>
                              <ClassificationConfirmForm projectId={projectId} emailId={email.id} emailAttachmentId={attachment.id} current={attachment.confirmedClassification ?? attachment.suggestedClassification} options={attachmentOptions} />
                            </details>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-col gap-1">
                            {behavior.kind === "PDF" || behavior.kind === "IMAGE" ? (
                              <Link href={`/${projectId}/documentos/emails/${email.id}/anexos/${attachment.id}`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))} title={behavior.label} aria-label={`${behavior.label}: ${attachment.fileName}`}>
                                {behavior.label}
                              </Link>
                            ) : behavior.kind === "MPP" && scheduleVersion ? (
                              <Link href={`/${projectId}/documentos?tab=cronograma`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))} title="Abrir cronograma estruturado">
                                {behavior.label}
                              </Link>
                            ) : null}
                            <DocumentDownloadButton bucket={attachment.storageBucket} filePath={attachment.storagePath} originalFileName={attachment.fileName} />
                            {behavior.reason ? <span className="text-muted-foreground" title={behavior.reason}>{behavior.reason}</span> : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {isWeeklyReport ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Cronograma MPP e comparações</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs">
              {scheduleVersion ? (
                <div>
                  <span className="text-muted-foreground">schedule_version:</span> <code>{scheduleVersion.id}</code> · extração <strong>{scheduleVersion.extractionStatus}</strong> · status_date {valueOrDash(scheduleVersion.statusDate)} · {scheduleVersion.activityCount} atividades
                </div>
              ) : (
                <p className="text-muted-foreground">Nenhuma versão de cronograma criada para este envio{intake?.status === "RECEIVED_DUPLICATE" ? " (arquivo já conhecido)" : ""}.</p>
              )}
              {comparisons.length === 0 ? (
                <p className="text-muted-foreground">Comparações ainda não preparadas (aguardam extração EXTRACTED pelo worker MPXJ).</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {comparisons.map((comparison) => {
                    const metrics = comparison.metrics as Record<string, Record<string, unknown>> | null;
                    return (
                      <div key={comparison.comparisonType} className="rounded-md border p-3">
                        <div className="flex items-center justify-between">
                          <strong>{comparison.comparisonType === "PREVIOUS_WEEKLY" ? "Atual × semana anterior" : "Atual × baseline oficial"}</strong>
                          {comparison.riskClassification ? (
                            <Badge variant="outline" className={riskBadgeClassName(comparison.riskClassification)}>{RISK_LABELS[comparison.riskClassification] ?? comparison.riskClassification}</Badge>
                          ) : (
                            <Badge variant="outline">{comparison.status}</Badge>
                          )}
                        </div>
                        {metrics ? (
                          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                            <li>Data final: {valueOrDash(metrics.finalDate?.slipDays, " dia(s)")}</li>
                            <li>Marcos deslizados: {valueOrDash(metrics.milestones?.slippedCount)} (máx. {valueOrDash(metrics.milestones?.maxSlipDays, " d")})</li>
                            <li>Caminho crítico: +{valueOrDash(metrics.criticalPath?.enteredCount)} / −{valueOrDash(metrics.criticalPath?.leftCount)}</li>
                            <li>Folga mínima: {valueOrDash(metrics.totalFloat?.currentMinDays, " d")}</li>
                            <li>Vencidas: {valueOrDash(metrics.overdue?.currentCount)} ({valueOrDash(metrics.overdue?.deltaCount)})</li>
                            <li>Add/rem: {valueOrDash(metrics.matching?.addedCount)}/{valueOrDash(metrics.matching?.removedCount)}</li>
                            <li>Durações alteradas: {valueOrDash(metrics.durations?.changedCount)}</li>
                            <li>Relações alteradas: {valueOrDash(metrics.relations?.changedCount)}</li>
                            <li>Avanço: {valueOrDash(metrics.progress?.currentPercent, "%")} ({valueOrDash(metrics.progress?.deltaPercent, " p.p.")})</li>
                            <li>Tendência do atraso: {valueOrDash(metrics.delay?.trend)} ({valueOrDash(metrics.delay?.trendDays, " d")})</li>
                          </ul>
                        ) : null}
                        {comparison.missingThresholds.length ? <p className="mt-2 text-violet-700">Limites ausentes: {comparison.missingThresholds.join(", ")}</p> : null}
                        <ul className="mt-2 list-disc pl-4 text-muted-foreground">
                          {comparison.riskReasons.slice(0, 6).map((reason, index) => (
                            <li key={index}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-muted-foreground">
                Análise do Expert de Planejamento: <Link href={`/${projectId}/experts-ia`} className="underline">abrir Experts IA</Link> (usa estas mesmas versões extraídas como contexto).
              </p>
            </CardContent>
          </Card>

          {workbooks.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Relatório Semanal (Excel)</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Nenhuma planilha do relatório semanal lida para este envio. A Curva S, a Linha de Base, o Financeiro, o Histograma e o SSMA vêm exclusivamente da planilha Excel anexada (nunca de PDF/imagem); planilhas .xlsx são processadas pelo worker com valores armazenados.
              </CardContent>
            </Card>
          ) : (
            workbooks.map((workbook) => <WeeklyReportWorkbookSection key={workbook.id} workbook={workbook} projectId={projectId} emailId={email.id} canEdit={canEdit} />)
          )}

          {detail.otherSendsSameWeek.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Outros envios da mesma semana da obra ({email.workWeekLabel})</CardTitle>
              </CardHeader>
              <CardContent className="text-xs">
                <ul className="list-disc pl-4">
                  {detail.otherSendsSameWeek.map((other) => (
                    <li key={other.emailId}>
                      <Link href={`/${projectId}/documentos/emails/${other.emailId}`} className="underline">{formatDateTime(other.sentAt)}</Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-muted-foreground">Todos os envios são preservados; o mais recente com status recebido/autorizado é o válido. Nenhuma versão anterior é sobrescrita.</p>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {isAdmin && intake ? (
        <Card>
          <CardHeader>
            <CardTitle>Revisão humana</CardTitle>
          </CardHeader>
          <CardContent>
            <IntakeReviewForm projectId={projectId} emailId={email.id} intakeId={intake.id} intakeStatus={intake.status} attachments={attachments.map((item) => ({ id: item.id, fileName: item.fileName }))} otherProjects={otherProjects} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && isWeeklyReport ? (
        <Card>
          <CardHeader>
            <CardTitle>Baseline oficial</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            <p>
              Baseline ativa: {activeBaseline ? <><code>{activeBaseline.scheduleVersionId}</code> desde {formatDateTime(activeBaseline.effectiveFrom)} — {activeBaseline.justification}</> : "não definida (comparação com baseline fica em REVIEW_REQUIRED)"}
            </p>
            <BaselineSelectorForm projectId={projectId} emailId={email.id} versions={extractedScheduleVersions} activeScheduleVersionId={activeBaseline?.scheduleVersionId ?? null} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de revisão e auditoria</CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {reviewEvents.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma decisão humana registrada para este envio.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {reviewEvents.map((event) => (
                <li key={event.id} className="rounded-md border p-2">
                  <div>
                    <strong>{event.action}</strong> · {event.entityType} · {formatDateTime(event.decidedAt)} · {event.decidedByName ?? event.decidedByUserId}
                  </div>
                  <div className="text-muted-foreground">
                    {event.field ? `${event.field}: ` : ""}
                    {JSON.stringify(event.previousValue)} → {JSON.stringify(event.newValue)}
                  </div>
                  <div>Justificativa: {event.justification}</div>
                  {event.reprocessResult ? <div className="text-muted-foreground">Reprocessamento: {JSON.stringify(event.reprocessResult)}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
