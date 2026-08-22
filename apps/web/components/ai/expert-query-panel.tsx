"use client";

import { useActionState } from "react";
import { FlaskConical } from "lucide-react";
import { SeverityBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { confrontationSeverityToAlertSeverity } from "@/lib/labels";
import {
  askCommercialDirectorAction,
  initialAskCommercialDirectorState,
  type AskCommercialDirectorState,
} from "@/lib/ai/expert-query-action";
import type { ExpertQueryScope } from "@/lib/ai/query/types";

type AskExpertState = AskCommercialDirectorState;
type AskExpertAction = (state: AskExpertState, formData: FormData) => Promise<AskExpertState>;

const REQUIREMENT_KIND_LABELS: Record<string, string> = {
  LEGAL_REQUIREMENT: "Exigência legal",
  CONTRACTUAL_REQUIREMENT: "Exigência contratual",
  NEGOTIATION_PRACTICE: "Prática negocial (não é obrigação)",
  AI_RECOMMENDATION: "Recomendação da IA",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nenhum item identificado.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function ExpertQueryPanel({
  projectId,
  eventId,
  scope,
  title = "Diretor Comercial IA",
  action = askCommercialDirectorAction,
  initialState = initialAskCommercialDirectorState,
}: {
  projectId: string;
  eventId?: string;
  scope: ExpertQueryScope;
  /** Nome exibido do Expert — permite reaproveitar este painel para qualquer Expert Query já implementado. */
  title?: string;
  /** Server Action deste Expert (ver askCommercialDirectorAction/askEsgDirectorAction) — mesmo contrato de estado. */
  action?: AskExpertAction;
  initialState?: AskExpertState;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const { response, error } = state;

  return (
    <Card className="border-primary/30">
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2">
          <CardTitle>{title}</CardTitle>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-severity-alta/40 bg-severity-alta/10 p-2.5 text-xs text-severity-alta">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
          <p>
            <strong>Ambiente de desenvolvimento/teste.</strong> Esta resposta é gerada por um provider
            determinístico (fake) — não é IA real. Nenhum LLM foi conectado nesta fase; nada aqui deve ser
            tratado como análise inteligente de fato.
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="scope" value={scope} />
          {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {scope === "EVENT" ? "Faça uma pergunta sobre este evento" : "Faça uma pergunta sobre este projeto"}
            <Textarea
              name="question"
              required
              rows={2}
              placeholder="Ex.: Qual a melhor estratégia para negociar este aditivo?"
            />
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Consultando…" : "Consultar"}
          </Button>
        </form>

        {response ? (
          <div className="flex flex-col gap-4 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={confrontationSeverityToAlertSeverity[response.severity]} />
              <span className="text-xs text-muted-foreground">
                Confiança: {Math.round(response.confidence * 100)}%
              </span>
            </div>

            <Section title="Interpretação (sugestão, não fato)">
              <p className="text-sm">{response.interpretacao}</p>
            </Section>

            <Section title="Fatos documentados">
              <BulletList items={response.fatosDocumentados} />
            </Section>

            {response.contextoInternoDeclarado.length > 0 && (
              <Section title="Contexto interno declarado (não confirmado documentalmente)">
                <ul className="flex flex-col gap-2">
                  {response.contextoInternoDeclarado.map((item) => (
                    <li key={item.noteId} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {item.category} · {item.author}
                      </p>
                      <p>{item.text}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {response.baseContratual.length > 0 && (
              <Section title="Base contratual">
                <ul className="flex flex-col gap-1 text-sm">
                  {response.baseContratual.map((basis, i) => (
                    <li key={i}>
                      {basis.clauseNumber ? `Cláusula ${basis.clauseNumber} — ` : ""}
                      {basis.clauseTitle ?? "Referência contratual"}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Base legal">
              {response.baseLegal.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Base legal oficial não disponível nesta fase (nenhum corpus normativo versionado no projeto).
                </p>
              ) : (
                <BulletList items={response.baseLegal.map((c) => `${c.source.referencia}: ${c.relationToAnalysis}`)} />
              )}
            </Section>

            {response.praticasNegociais.length > 0 && (
              <Section title="Práticas negociais / classificações">
                <ul className="flex flex-col gap-1 text-sm">
                  {response.praticasNegociais.map((item, i) => (
                    <li key={i}>
                      <span className="mr-1 rounded border px-1 text-xs">
                        {REQUIREMENT_KIND_LABELS[item.kind] ?? item.kind}
                      </span>
                      {item.statement}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Riscos">
              <BulletList items={response.riscos} />
            </Section>

            <Section title="Recomendações">
              <BulletList items={response.recomendacoes} />
            </Section>

            {response.acoesSugeridas.length > 0 && (
              <Section title="Ações sugeridas">
                <BulletList items={response.acoesSugeridas} />
              </Section>
            )}

            <Section title="Informações faltantes">
              <BulletList items={response.informacoesFaltantes} />
            </Section>

            {response.rascunhoSugerido && (
              <Section title={`Rascunho sugerido — ${response.rascunhoSugerido.status}`}>
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  {response.rascunhoSugerido.subject && (
                    <p className="font-medium">{response.rascunhoSugerido.subject}</p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap">{response.rascunhoSugerido.body}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Rascunho pendente de revisão humana — nada foi enviado.
                </p>
              </Section>
            )}

            <p className="text-xs font-medium text-muted-foreground">Revisão humana obrigatória.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
