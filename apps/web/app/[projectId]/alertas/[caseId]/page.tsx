import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AlertActionForms } from "@/components/risk-alerts/alert-action-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { slaAreaLabels, slaTimeUnitLabels } from "@/lib/labels";
import { getAlertDetailView } from "@/lib/risk-alerts/alert-detail-data";
import type { AlertActionType } from "@/lib/risk-alerts/types";

export const metadata: Metadata = { title: "Alerta de risco · ACC" };

function fmt(value: string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

// Página AUTENTICADA do alerta. O link do e-mail (?acao=&t=) só
// pré-seleciona a ação e valida o token; nenhum estado muda por GET.
export default async function AlertDetailPage({ params, searchParams }: { params: Promise<{ projectId: string; caseId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId, caseId } = await params;
  if (!isWeeklyReportsEnabled()) notFound();
  const query = (await searchParams) ?? {};
  const token = typeof query.t === "string" ? query.t : null;
  const action = typeof query.acao === "string" ? query.acao : null;
  const view = await getAlertDetailView(projectId, caseId, { token, action });
  if (!view) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Alerta de risco — ${view.title}`} description={`${view.reference} · área ${slaAreaLabels[view.area as keyof typeof slaAreaLabels] ?? view.area} · código ${view.visibleCode}`} />

      <Card>
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">Situação <Badge>{view.riskLevel}</Badge><Badge variant="outline" data-testid="alert-state">{view.stateLabel}</Badge>{view.topLevelReachedAt ? <Badge variant="destructive">Limite de escalonamento atingido</Badge> : null}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Resumo:</span> {view.summary}</p>
          <p><span className="text-muted-foreground">Impacto:</span> {view.impact || "—"}</p>
          <p><span className="text-muted-foreground">Recomendação do Expert:</span> {view.recommendation ?? "—"}</p>
          <p><span className="text-muted-foreground">Responsável atual:</span> {view.currentResponsible.name ?? "não definido"}</p>
          <p><span className="text-muted-foreground">Responsável anterior:</span> {view.previousResponsible.name ?? "—"}</p>
          <p><span className="text-muted-foreground">Nível atual:</span> {view.currentLevelLabel} · <span className="text-muted-foreground">próximo:</span> {view.nextLevelLabel}</p>
          <p><span className="text-muted-foreground">Prazos (Matriz, {slaTimeUnitLabels[view.policy.timeUnit].toLowerCase()}):</span> assumir {view.policy.assumeDeadlineValue}{view.policy.respondDeadlineValue !== null ? ` · responder ${view.policy.respondDeadlineValue}` : ""}{view.policy.completeDeadlineValue !== null ? ` · concluir ${view.policy.completeDeadlineValue}` : ""}{view.policy.usingDefaultRule ? " (default — simulação)" : ""}</p>
          {view.slaAction ? <p><span className="text-muted-foreground">Ação SLA:</span> {view.slaAction.status} · assumir até {fmt(view.slaAction.assumeDueAt, view.timeZone)}{view.slaAction.acknowledgedAt ? ` · assumida em ${fmt(view.slaAction.acknowledgedAt, view.timeZone)}` : ""}{view.slaAction.completedAt ? ` · concluída em ${fmt(view.slaAction.completedAt, view.timeZone)}` : ""}</p> : null}
          {view.nextScheduledEscalation ? <p><span className="text-muted-foreground">Próximo escalonamento por prazo:</span> {view.nextScheduledEscalation.level} — {view.nextScheduledEscalation.reasons.join(" ")}</p> : null}
          <p><span className="text-muted-foreground">Exigências da Matriz:</span> {view.policy.requiresAcknowledgmentConfirmation ? "confirmação obrigatória" : "confirmação não exigida"}; {view.policy.requiresDelayJustification ? "justificativa obrigatória" : "justificativa não exigida"}</p>
          <p><span className="text-muted-foreground">Destinatários suprimidos (piloto):</span> {view.suppressedCount}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ações</CardTitle></CardHeader>
        <CardContent>
          {view.linkAction && !view.linkAction.valid ? <p className="mb-2 text-xs text-amber-800" role="status">Link do e-mail expirado ou inválido — use os botões abaixo normalmente.</p> : null}
          <AlertActionForms
            projectId={projectId}
            caseId={caseId}
            riskLevel={view.riskLevel}
            availableActions={view.availableActions}
            forwardCandidates={view.forwardCandidates}
            expertOptions={view.expertOptions}
            suggestedExpert={view.suggestedExpert}
            requiresJustification={view.policy.requiresDelayJustification}
            nextLevelLabel={view.nextLevelLabel}
            initialAction={view.linkAction?.valid ? (view.linkAction.action as AlertActionType) : null}
            token={view.linkAction?.valid ? token : null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
        <CardContent>
          {view.timeline.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum evento.</p> : (
            <ul className="flex flex-col gap-2 text-sm" data-testid="alert-timeline">
              {view.timeline.map((e) => (
                <li key={e.id} className="rounded border p-2">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{fmt(e.at, view.timeZone)}</span><span>{e.origin}</span><span>{e.actorName ?? "SISTEMA"}</span>{e.fromState && e.toState && e.fromState !== e.toState ? <span>{e.fromState} → {e.toState}</span> : null}{e.fromLevel && e.toLevel ? <span>nível {e.fromLevel} → {e.toLevel}</span> : null}</div>
                  <div className="font-medium">{e.type}{e.targetName ? ` → ${e.targetName}` : ""}{e.expertId ? ` (${e.expertId})` : ""}</div>
                  {e.text ? <p className="whitespace-pre-wrap">{e.text}</p> : null}
                  {e.justification ? <p className="text-xs">Justificativa: {e.justification}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Mensagens e respostas (thread do alerta)</CardTitle></CardHeader>
          <CardContent>
            {view.messages.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma mensagem.</p> : (
              <ul className="flex flex-col gap-2 text-sm">
                {view.messages.map((m) => (
                  <li key={m.id} className="rounded border p-2">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{fmt(m.at, view.timeZone)}</span><span>{m.direction === "INBOUND" ? `de ${m.senderName ?? m.senderEmail ?? "?"}` : m.expertId ? `Expert ${m.expertId}` : "ACC"}</span>{m.classification ? <span>{m.classification}{m.confidence !== null ? ` (${m.confidence})` : ""}</span> : null}<span>{m.status}</span>{m.requiresHumanReview ? <Badge variant="outline">revisão humana</Badge> : null}</div>
                    {m.excerpt ? <p className="whitespace-pre-wrap">{m.excerpt}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Encaminhamentos, devoluções e entregas</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {view.forwards.length === 0 ? <p className="text-muted-foreground">Nenhum encaminhamento.</p> : (
              <ul className="flex flex-col gap-1">
                {view.forwards.map((f) => (
                  <li key={f.id}>{f.fromName ?? "?"} → {f.toName ?? "?"} · assumir até {fmt(f.assumeDueAt, view.timeZone)} · {f.state}{f.returnedAt ? ` · devolvido em ${fmt(f.returnedAt, view.timeZone)}` : ""}{f.pilotException ? " · exceção manual do piloto" : ""}</li>
                ))}
              </ul>
            )}
            <div>
              <p className="mb-1 font-medium">Entregas (outbox)</p>
              {view.outbox.length === 0 ? <p className="text-muted-foreground">Nenhuma.</p> : (
                <ul className="flex flex-col gap-1">
                  {view.outbox.map((o) => (
                    <li key={o.id}>{fmt(o.at, view.timeZone)} · {o.type}{o.escalationLevel ? ` (${o.escalationLevel})` : ""} · {o.recipientName ?? "?"} · {o.status}{o.suppressionLabel ? ` — ${o.suppressionLabel}` : ""} · {o.origin}</li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
