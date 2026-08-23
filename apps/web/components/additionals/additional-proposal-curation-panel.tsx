"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/shared/badges";
import { expertIconClassName, resolveExpertIcon } from "@/components/ai/expert-visual-identity";
import { runAdditionalProposalCurationAction } from "@/app/[projectId]/adicionais/actions";
import { initialRunAdditionalProposalCurationState } from "@/app/[projectId]/adicionais/actions-state";
import { OFFICIAL_EXPERT_DEFINITIONS } from "@/lib/ai/expert-definitions";
import { confrontationSeverityToAlertSeverity } from "@/lib/labels";

/**
 * "CURADORIA" (seção do requisito): Diretor Comercial IA + Diretor de
 * Planejamento IA + Consultor Jurídico IA, consolidados pelo CEO IA —
 * sempre sob demanda (nunca automático), toda sugestão exige revisão
 * humana. Nenhum destes Experts pode aprovar preço/prazo nem marcar
 * CONTRATADO — ver AdditionalProposalContractedForm para essa ação.
 */
export function AdditionalProposalCurationPanel({ proposalId }: { proposalId: string }) {
  const [state, formAction, pending] = useActionState(runAdditionalProposalCurationAction, initialRunAdditionalProposalCurationState);

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Curadoria de Experts IA</p>
          <p className="text-xs text-muted-foreground">Comercial + Planejamento + Jurídico, consolidados pelo CEO IA.</p>
        </div>
        <form action={formAction}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Analisando…" : "Analisar com Experts IA"}
          </Button>
        </form>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      {state.result ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {state.result.expertResults.map(({ expertId, response }) => {
              const definition = OFFICIAL_EXPERT_DEFINITIONS[expertId];
              const Icon = resolveExpertIcon(definition.visualIdentity);
              return (
                <div key={expertId} className="rounded-md border p-3 text-xs">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icon className={expertIconClassName(definition.visualIdentity, "size-3.5")} aria-hidden="true" />
                      {response.expertName}
                    </span>
                    <SeverityBadge severity={confrontationSeverityToAlertSeverity[response.severity]} />
                  </div>
                  <p className="text-muted-foreground">{response.interpretacao}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 text-xs">
            <p className="mb-1.5 font-medium">Consolidação executiva — CEO IA</p>
            <p className="mb-1">
              <strong>Situação:</strong> {state.result.executiveCuration.situacao}
            </p>
            {state.result.executiveCuration.divergencias.length > 0 ? (
              <div className="mb-1 rounded bg-severity-alta/10 p-2">
                <p className="font-medium text-severity-alta">CONFLITO ENTRE ESPECIALISTAS</p>
                {state.result.executiveCuration.divergencias.map((d, i) => (
                  <div key={i} className="mt-1">
                    <p>{d.topic}</p>
                    {d.positions.map((p, j) => (
                      <p key={j} className="ml-2">
                        {p.expertName}: {p.position}
                      </p>
                    ))}
                    <p className="ml-2 italic">Razão provável: {d.probableReason}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mb-1">
              <strong>Recomendação:</strong> {state.result.executiveCuration.recomendacao}
            </p>
            {state.result.executiveCuration.decisoesHumanasNecessarias.length > 0 ? (
              <div>
                <strong>Decisões humanas necessárias:</strong>
                <ul className="ml-4 list-disc">
                  {state.result.executiveCuration.decisoesHumanasNecessarias.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
