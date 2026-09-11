"use client";

import { useActionState } from "react";
import { AlertTriangle, FlaskConical, HelpCircle } from "lucide-react";
import { SeverityBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { confrontationSeverityToAlertSeverity } from "@/lib/labels";
import { askCommercialDirectorAction } from "@/lib/ai/expert-query-action";
import { MISSING_QUERY_CONTEXT_MESSAGE } from "@/lib/ai/expert-query-request";
import { initialAskCommercialDirectorState, type AskCommercialDirectorState } from "@/lib/ai/expert-query-state";
import { normalizeProviderMeta } from "@/lib/ai/provider-ui-metadata";
import type { ExpertQueryResponse, ExpertQueryScope, VerifiedLegalClauseComparison } from "@/lib/ai/query/types";
import type { ContextDocumentCoverage } from "@/lib/ai/context/types";

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

const GROUNDING_STATUS_LABELS: Record<string, string> = {
  SUPPORTED: "Fato documentado",
  INFERENCE: "Interpretação da IA",
  UNSUPPORTED: "Informação não comprovada",
  HUMAN_INPUT_REQUIRED: "Depende de definição humana",
};

const GROUNDING_STATUS_STYLES: Record<string, string> = {
  SUPPORTED: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  INFERENCE: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  UNSUPPORTED: "border-destructive/30 bg-destructive/5 text-destructive",
  HUMAN_INPUT_REQUIRED: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

interface GroundingClaimLike {
  text: string;
  reasoningNote: string;
}

/**
 * Resumo do guardrail de grounding (apps/web/lib/ai/grounding/) —
 * mostrado apenas quando `grounding.performed` (só ocorre para
 * respostas do provider Anthropic com um rascunho checado). Nunca um
 * redesign geral do painel — só esta seção adicional.
 */
function GroundingSummary({
  grounding,
}: {
  grounding: {
    valid: boolean;
    correctionApplied: boolean;
    draftSuppressed: boolean;
    supported: GroundingClaimLike[];
    inferred: GroundingClaimLike[];
    unsupported: GroundingClaimLike[];
    missingSupport: GroundingClaimLike[];
    warnings: string[];
  };
}) {
  const groups: Array<{ status: keyof typeof GROUNDING_STATUS_LABELS; claims: GroundingClaimLike[] }> = [
    { status: "UNSUPPORTED", claims: grounding.unsupported },
    { status: "HUMAN_INPUT_REQUIRED", claims: grounding.missingSupport },
    { status: "INFERENCE", claims: grounding.inferred },
    { status: "SUPPORTED", claims: grounding.supported },
  ];

  return (
    <Section title="Checagem de fidelidade (grounding) do rascunho">
      {grounding.draftSuppressed && (
        <p className="text-sm text-destructive">
          O rascunho original foi removido: continha afirmação sem suporte no contexto que não pôde ser corrigida
          automaticamente com segurança.
        </p>
      )}
      {grounding.correctionApplied && (
        <p className="text-sm text-severity-alta">
          Trecho(s) do rascunho foram substituídos por{" "}
          <span className="font-mono text-xs">[CONFIRMAR INTERNAMENTE…]</span> — exigem confirmação humana antes do
          envio.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {groups
          .filter((group) => group.claims.length > 0)
          .map((group) => (
            <div key={group.status} className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {GROUNDING_STATUS_LABELS[group.status]} ({group.claims.length})
              </span>
              <ul className="flex flex-col gap-1">
                {group.claims.map((claim, i) => (
                  <li key={i} className={`rounded-md border p-2 text-xs ${GROUNDING_STATUS_STYLES[group.status]}`}>
                    <p>{claim.text}</p>
                    <p className="mt-0.5 opacity-80">{claim.reasoningNote}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </Section>
  );
}

/**
 * Aviso de conteúdo parcial. A fonte é SEMPRE o metadado calculado no
 * servidor (ContextDocumentCoverage) — nunca a resposta do modelo. O
 * Anthropic não tem como saber que houve corte: ele recebe o texto já
 * truncado. Depender de ele mencionar seria depender de quem não sabe.
 */
function PartialContentNotice({ coverage }: { coverage: ContextDocumentCoverage }) {
  if (!coverage.truncated) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-severity-alta/40 bg-severity-alta/10 p-3 text-sm text-severity-alta">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          Análise realizada com conteúdo parcial: parte dos documentos excedeu o limite de contexto. Confirme as
          cláusulas diretamente nos arquivos originais.
        </p>
        <p className="text-xs">
          Documentos incluídos: {coverage.includedCount} de {coverage.availableCount}
          {coverage.omittedCount > 0 ? ` · Documentos omitidos: ${coverage.omittedCount}` : ""}
          {coverage.unreadableCount > 0 ? ` · Não legíveis: ${coverage.unreadableCount}` : ""}
          {" · "}
          Caracteres omitidos: {coverage.omittedCharacters.toLocaleString("pt-BR")}
        </p>
      </div>
    </div>
  );
}

const CLAUSE_ACTION_LABELS: Record<VerifiedLegalClauseComparison["action"], string> = {
  MODIFY: "Modificar",
  REMOVE: "Excluir",
  ADD: "Adicionar",
};

function ClauseRationaleTooltip({ comparison, index }: { comparison: VerifiedLegalClauseComparison; index: number }) {
  const tooltipId = `clause-rationale-${index}`;
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-describedby={tooltipId}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="size-3.5" />
        Por que alterar?
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="invisible absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-md border bg-popover p-3 text-left text-xs text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <strong className="block text-sm">Fundamento da sugestão</strong>
        <span className="mt-1 block">{comparison.rationale}</span>
        <strong className="mt-2 block">Risco que a mudança busca reduzir</strong>
        <span className="mt-1 block">{comparison.mitigatedRisk}</span>
        {comparison.legalBasis ? (
          <>
            <strong className="mt-2 block">Base jurídica disponível no contexto</strong>
            <span className="mt-1 block">{comparison.legalBasis}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function LegalClauseComparison({ comparisons }: { comparisons: VerifiedLegalClauseComparison[] }) {
  return (
    <Section title="Comparação das cláusulas e sugestões">
      {comparisons.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Nenhuma alteração de cláusula foi recomendada para a pergunta atual.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {comparisons.map((comparison, index) => (
            <article
              key={`${comparison.documentVersionId}-${index}`}
              className="overflow-visible rounded-lg border"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {comparison.clauseNumber ? `Cláusula ${comparison.clauseNumber}` : "Nova cláusula"}
                    {comparison.clauseTitle ? ` — ${comparison.clauseTitle}` : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {comparison.documentTitle}
                    {comparison.versionLabel ? ` · versão ${comparison.versionLabel}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={confrontationSeverityToAlertSeverity[comparison.severity]} />
                  <span className="rounded-full border bg-background px-2 py-1 text-xs font-medium">
                    {CLAUSE_ACTION_LABELS[comparison.action]}
                  </span>
                  <ClauseRationaleTooltip comparison={comparison} index={index} />
                </div>
              </header>

              <div className="grid lg:grid-cols-2">
                <section className="min-w-0 border-b p-4 lg:border-b-0 lg:border-r">
                  <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cláusula do contrato
                  </h5>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {comparison.originalText ?? "Nova cláusula — não existe redação correspondente no contrato."}
                  </p>
                </section>
                <section className="min-w-0 bg-primary/[0.03] p-4">
                  <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
                    Sugestão do Consultor Jurídico
                  </h5>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {comparison.action === "REMOVE"
                      ? "Excluir integralmente a cláusula indicada."
                      : comparison.proposedText}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Confiança: {Math.round(comparison.confidence * 100)}% · revisão humana obrigatória
                  </p>
                </section>
              </div>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}

function ExpertResponseDetails({ response, showClauseComparison }: { response: ExpertQueryResponse; showClauseComparison: boolean }) {
  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={confrontationSeverityToAlertSeverity[response.severity]} />
        <span className="text-xs text-muted-foreground">Confiança: {Math.round(response.confidence * 100)}%</span>
      </div>

      {showClauseComparison && response.analiseClausulas ? (
        <LegalClauseComparison comparisons={response.analiseClausulas} />
      ) : null}

      <Section title="Interpretação (sugestão, não fato)"><p className="text-sm">{response.interpretacao}</p></Section>
      <Section title="Fatos documentados"><BulletList items={response.fatosDocumentados} /></Section>

      {response.contextoInternoDeclarado.length > 0 && (
        <Section title="Contexto interno declarado (não confirmado documentalmente)">
          <ul className="flex flex-col gap-2">
            {response.contextoInternoDeclarado.map((item) => (
              <li key={item.noteId} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm">
                <p className="text-xs text-muted-foreground">{item.category} · {item.author}</p><p>{item.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {response.baseContratual.length > 0 && (
        <Section title="Base contratual"><ul className="flex flex-col gap-1 text-sm">
          {response.baseContratual.map((basis, i) => <li key={i}>{basis.clauseNumber ? `Cláusula ${basis.clauseNumber} — ` : ""}{basis.clauseTitle ?? "Referência contratual"}</li>)}
        </ul></Section>
      )}

      <Section title="Base legal">
        {response.baseLegal.length === 0 ? <p className="text-sm text-muted-foreground">Base legal oficial não disponível nesta fase (nenhum corpus normativo versionado no projeto).</p> : <BulletList items={response.baseLegal.map((c) => `${c.source.referencia}: ${c.relationToAnalysis}`)} />}
      </Section>

      {response.praticasNegociais.length > 0 && (
        <Section title="Práticas negociais / classificações"><ul className="flex flex-col gap-1 text-sm">
          {response.praticasNegociais.map((item, i) => <li key={i}><span className="mr-1 rounded border px-1 text-xs">{REQUIREMENT_KIND_LABELS[item.kind] ?? item.kind}</span>{item.statement}</li>)}
        </ul></Section>
      )}

      <Section title="Riscos"><BulletList items={response.riscos} /></Section>
      <Section title="Recomendações"><BulletList items={response.recomendacoes} /></Section>
      {response.acoesSugeridas.length > 0 && <Section title="Ações sugeridas"><BulletList items={response.acoesSugeridas} /></Section>}
      <Section title="Informações faltantes"><BulletList items={response.informacoesFaltantes} /></Section>

      {response.rascunhoSugerido && (
        <Section title={`Rascunho sugerido — ${response.rascunhoSugerido.status}`}>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            {response.rascunhoSugerido.subject && <p className="font-medium">{response.rascunhoSugerido.subject}</p>}
            <p className="mt-1 whitespace-pre-wrap">{response.rascunhoSugerido.body}</p>
          </div>
          <p className="text-xs text-muted-foreground">Rascunho pendente de revisão humana — nada foi enviado.</p>
        </Section>
      )}
      {response.grounding?.performed && <GroundingSummary grounding={response.grounding} />}
      <p className="text-xs font-medium text-muted-foreground">Revisão humana obrigatória.</p>
    </div>
  );
}

export function ExpertQueryPanel({
  projectId,
  eventId,
  scope,
  title = "Diretor Comercial IA",
  action = askCommercialDirectorAction,
  initialState = initialAskCommercialDirectorState,
  disabledReason = null,
  presentation = "default",
}: {
  projectId: string;
  eventId?: string;
  scope: ExpertQueryScope;
  /** Nome exibido do Expert — permite reaproveitar este painel para qualquer Expert Query já implementado. */
  title?: string;
  /** Server Action deste Expert (ver askCommercialDirectorAction/askEsgDirectorAction) — mesmo contrato de estado. */
  action?: AskExpertAction;
  initialState?: AskExpertState;
  /**
   * Quando preenchido, a consulta fica bloqueada E o motivo é exibido —
   * nunca um botão desabilitado sem explicação. Usado pela análise
   * jurídica pré-contratual, que só libera "Consultar" depois que o
   * conteúdo do documento está disponível.
   */
  disabledReason?: string | null;
  /** Comparacao juridica ocupa a largura das duas colunas no fluxo pre-contratual. */
  presentation?: "default" | "legal-clause-comparison";
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const { response, error } = state;
  // Ao iniciar outra consulta, a resposta anterior sai imediatamente da
  // tela. `useActionState` mantem apenas o resultado mais recente e nao ha
  // lista/historico persistido.
  const displayedResponse = pending ? null : response;
  // Contexto da consulta conferido também no cliente: sem escopo
  // reconhecido não há pergunta a enviar, e a UI nunca renderiza um
  // valor cru (nem "undefined") — a mesma mensagem do servidor
  // (MISSING_QUERY_CONTEXT_MESSAGE) é reaproveitada, nunca duplicada.
  // A validação que vale continua sendo a do servidor: este bloco só
  // evita uma ida e volta inútil.
  const hasValidScope = scope === "PROJECT" || scope === "EVENT";
  const hasQueryContext = hasValidScope && Boolean(projectId) && (scope !== "EVENT" || Boolean(eventId));
  // Normaliza null E undefined em um único ponto (normalizeProviderMeta)
  // — nenhum acesso a `meta.*` acontece antes desta linha, e nunca via
  // non-null assertion. Ver expert-query-action.ts
  // (AskCommercialDirectorState.meta) para o motivo do tipo tolerar
  // `undefined` além de `null`.
  const meta = normalizeProviderMeta(state.meta);

  return (
    <>
    <Card className="min-w-0 border-primary/30">
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2">
          <CardTitle>{title}</CardTitle>
        </div>
        {meta === null ? (
          <div className="flex items-start gap-2 rounded-md border p-2.5 text-xs text-muted-foreground">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            <p>O provider será exibido aqui após a primeira consulta.</p>
          </div>
        ) : meta.isRealProvider ? (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs text-muted-foreground">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            <p>
              <strong>Provider: {meta.providerLabel}</strong>
              {meta.model ? <> · Modelo: {meta.model}</> : null}. Resposta gerada por IA. Toda sugestão exige
              revisão humana antes de qualquer ação.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-severity-alta/40 bg-severity-alta/10 p-2.5 text-xs text-severity-alta">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            <p>
              <strong>Provider: {meta.providerLabel}.</strong> Esta resposta é gerada por um provider
              determinístico (fake) — não é IA real. Nada aqui deve ser tratado como análise inteligente de fato.
            </p>
          </div>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!hasQueryContext ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {MISSING_QUERY_CONTEXT_MESSAGE}
          </p>
        ) : (
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
              title="Descreva o contexto e a pergunta. O especialista usará os documentos e dados disponíveis neste projeto; a resposta exige revisão humana."
            />
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {disabledReason ? (
            <p className="rounded-md border bg-muted/40 p-2.5 text-sm text-muted-foreground">{disabledReason}</p>
          ) : null}

          <Button type="submit" disabled={pending || Boolean(disabledReason)} className="self-start">
            {pending ? "Consultando…" : "Consultar"}
          </Button>
        </form>
        )}

        {state.coverage ? <PartialContentNotice coverage={state.coverage} /> : null}

        {displayedResponse && presentation === "default" ? <ExpertResponseDetails response={displayedResponse} showClauseComparison={false} /> : null}
      </CardContent>
    </Card>
    {displayedResponse && presentation === "legal-clause-comparison" ? (
      <Card className="border-primary/30 lg:col-span-2">
        <CardHeader><CardTitle>Análise comparativa do Consultor Jurídico</CardTitle></CardHeader>
        <CardContent><ExpertResponseDetails response={displayedResponse} showClauseComparison /></CardContent>
      </Card>
    ) : null}
    </>
  );
}
