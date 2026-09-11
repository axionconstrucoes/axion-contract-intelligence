"use client";

import { useActionState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { AiPendingIndicator } from "@/components/ai/ai-pending-indicator";
import { SeverityBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confrontationSeverityToAlertSeverity } from "@/lib/labels";
import { runMultiExpertCurationAction } from "@/app/[projectId]/ledger/[eventId]/run-multi-expert-curation-actions";
import { initialRunMultiExpertCurationState } from "@/app/[projectId]/ledger/[eventId]/run-multi-expert-curation-actions-state";

/**
 * Gatilho MANUAL (nunca automático) da curadoria multiagente já
 * existente — mesmo princípio já usado por AssessScheduleDelayButton:
 * "IA prepara → humano dispara → resultado gravado e rastreável". Só
 * visível para quem já vê a tela do evento com permissão de escrita
 * (checado de novo no servidor pela Server Action). Nenhuma decisão é
 * tomada automaticamente — o resultado é sempre apresentado como
 * sugestão sujeita a revisão humana.
 */
export function RunMultiExpertCurationButton({ projectId, eventId }: { projectId: string; eventId: string }) {
  const [state, formAction, pending] = useActionState(runMultiExpertCurationAction, initialRunMultiExpertCurationState);
  // Mesma regra do ExpertQueryPanel: ao disparar nova análise, o
  // resultado anterior sai da tela — só a execução atual é exibida. O
  // registro em Auditoria continua sendo feito pela Server Action.
  const displayedResult = pending ? null : state.success;

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <FlaskConical className="size-4 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-base">Curadoria multiagente (Experts IA)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Roteia este evento aos Experts IA competentes e consolida as posições via CEO IA. Análise de IA sujeita a
          revisão humana — nenhuma ação é executada automaticamente.
        </p>

        <form action={formAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="eventId" value={eventId} />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Executando análise…
              </>
            ) : (
              "Executar análise multiagente"
            )}
          </Button>
        </form>

        {pending ? (
          <AiPendingIndicator message="Consultando os Experts IA e consolidando via CEO IA. Isso pode levar algum tempo — aguarde nesta tela." />
        ) : null}

        {!pending && state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

        {displayedResult ? (
          <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-muted-foreground">Tema roteado</span>
              <span>{displayedResult.routing.topic}</span>
              <SeverityBadge severity={confrontationSeverityToAlertSeverity[displayedResult.executiveCuration.overallSeverity]} />
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Experts consultados</p>
              <p className="mt-0.5">
                {displayedResult.expertResults.length > 0
                  ? displayedResult.expertResults.map((r) => r.response.expertName).join(", ")
                  : "Nenhum — roteamento não selecionou um especialista para este tema."}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Situação (CEO IA)</p>
              <p className="mt-0.5">{displayedResult.executiveCuration.situacao}</p>
            </div>

            {displayedResult.executiveCuration.divergencias.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Divergências entre Experts</p>
                <ul className="mt-0.5 list-disc space-y-1 pl-5">
                  {displayedResult.executiveCuration.divergencias.map((d, i) => (
                    <li key={i}>
                      <span className="font-medium">{d.topic}:</span> {d.probableReason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Recomendação do CEO IA</p>
              <p className="mt-0.5">{displayedResult.executiveCuration.recomendacao}</p>
            </div>

            {displayedResult.executiveCuration.decisoesHumanasNecessarias.length > 0 ? (
              <div className="rounded border border-severity-alta/40 bg-severity-alta/10 p-2 text-severity-alta">
                <p className="text-xs font-medium uppercase">Decisões humanas necessárias</p>
                <ul className="mt-0.5 list-disc space-y-1 pl-5">
                  {displayedResult.executiveCuration.decisoesHumanasNecessarias.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Análise de IA — nunca substitui decisão humana. Registrada em Auditoria (
              {new Date(displayedResult.audit.generatedAt).toLocaleString("pt-BR")}).
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
