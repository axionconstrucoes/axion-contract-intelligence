import Link from "next/link";

import {
  getClauseReviewCandidates,
} from "@/lib/clause-review";

import {
  reviewClauseCandidateAction,
} from "./actions";

type PageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

function formatConfidence(
  value: number
) {
  return `${Math.round(value * 100)}%`;
}

export default async function ClauseReviewPage({
  params,
}: PageProps) {
  const {
    projectId,
  } = await params;

  const candidates =
    await getClauseReviewCandidates(
      projectId
    );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Revisão de Cláusulas
            </h1>

            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Valide os candidatos identificados automaticamente
              antes que sejam incorporados à base contratual.
            </p>
          </div>

          <Link
            href={`/${projectId}/documentos`}
            className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            Documentos
          </Link>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <strong>
            Regra de governança:
          </strong>{" "}
          a detecção automática apenas sugere cláusulas.
          A criação da cláusula contratual definitiva exige
          aprovação humana.
        </div>
      </header>

      {candidates.length === 0 ? (
        <section className="rounded-xl border border-dashed p-8">
          <h2 className="font-semibold">
            Nenhuma cláusula aguardando revisão
          </h2>

          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Quando uma versão documental for processada e o
            detector estrutural identificar cláusulas, os
            candidatos aparecerão aqui como PENDING_REVIEW.
          </p>

          <p className="mt-3 text-sm text-muted-foreground">
            Se o projeto ainda não possui documentos, o confronto
            contratual permanece pendente até que uma base
            documental esteja disponível.
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-5">
          <div className="text-sm text-muted-foreground">
            {candidates.length} candidato
            {candidates.length === 1
              ? ""
              : "s"}{" "}
            aguardando revisão.
          </div>

          {candidates.map(
            (candidate) => (
              <article
                key={candidate.id}
                className="overflow-hidden rounded-xl border bg-card"
              >
                <div className="border-b bg-muted/20 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {
                          candidate.documentKind
                        }
                      </div>

                      <h2 className="mt-1 text-lg font-semibold">
                        {
                          candidate.documentTitle
                        }
                      </h2>

                      <div className="mt-1 text-sm text-muted-foreground">
                        Versão{" "}
                        {
                          candidate.versionLabel
                        }

                        {candidate.originalFileName
                          ? ` • ${candidate.originalFileName}`
                          : ""}
                      </div>
                    </div>

                    <div className="rounded-full border px-3 py-1 text-sm font-medium">
                      Confiança{" "}
                      {formatConfidence(
                        candidate.confidence
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Detector:{" "}
                      {candidate.detector} v
                      {
                        candidate.detectorVersion
                      }
                    </span>

                    {candidate.pageNumber ? (
                      <span>
                        Página{" "}
                        {
                          candidate.pageNumber
                        }
                      </span>
                    ) : null}

                    {candidate.locator ? (
                      <span>
                        {
                          candidate.locator
                        }
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
                  <div>
                    <h3 className="mb-4 font-medium">
                      Revisar e aprovar
                    </h3>

                    <form
                      action={
                        reviewClauseCandidateAction
                      }
                      className="flex flex-col gap-4"
                    >
                      <input
                        type="hidden"
                        name="projectId"
                        value={projectId}
                      />

                      <input
                        type="hidden"
                        name="candidateId"
                        value={
                          candidate.id
                        }
                      />

                      <input
                        type="hidden"
                        name="reviewAction"
                        value="APPROVE"
                      />

                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Número da cláusula

                        <input
                          name="clauseNumber"
                          defaultValue={
                            candidate.proposedClauseNumber
                          }
                          required
                          className="h-10 rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>

                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Título

                        <input
                          name="clauseTitle"
                          defaultValue={
                            candidate.proposedTitle
                          }
                          required
                          className="h-10 rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>

                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Texto contratual

                        <textarea
                          name="clauseText"
                          defaultValue={
                            candidate.proposedText
                          }
                          required
                          rows={10}
                          className="min-h-56 resize-y rounded-md border bg-background p-3 text-sm font-normal leading-6 outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>

                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Observação da revisão
                        <span className="text-xs font-normal text-muted-foreground">
                          Opcional para aprovação.
                        </span>

                        <textarea
                          name="reviewNote"
                          rows={2}
                          className="resize-y rounded-md border bg-background p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Ex.: numeração ajustada conforme documento original."
                        />
                      </label>

                      <button
                        type="submit"
                        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        Aprovar cláusula
                      </button>
                    </form>
                  </div>

                  <aside className="flex flex-col gap-5">
                    <section className="rounded-lg border p-4">
                      <h3 className="font-medium">
                        Evidência de origem
                      </h3>

                      <dl className="mt-3 grid gap-2 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Página
                          </dt>

                          <dd>
                            {
                              candidate.sourcePageNumber ??
                              candidate.pageNumber ??
                              "Não informada"
                            }
                          </dd>
                        </div>

                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Localizador
                          </dt>

                          <dd className="break-words">
                            {
                              candidate.sourceLocator ??
                              candidate.locator ??
                              "Não informado"
                            }
                          </dd>
                        </div>
                      </dl>

                      {candidate.sourceText ? (
                        <details className="mt-4">
                          <summary className="cursor-pointer text-sm font-medium">
                            Ver segmento original
                          </summary>

                          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">
                            {
                              candidate.sourceText
                            }
                          </pre>
                        </details>
                      ) : (
                        <p className="mt-4 text-xs text-muted-foreground">
                          Segmento original não disponível.
                        </p>
                      )}
                    </section>

                    <section className="rounded-lg border border-destructive/30 p-4">
                      <h3 className="font-medium">
                        Rejeitar candidato
                      </h3>

                      <p className="mt-1 text-xs text-muted-foreground">
                        A rejeição exige justificativa e ficará
                        registrada no Audit Log.
                      </p>

                      <form
                        action={
                          reviewClauseCandidateAction
                        }
                        className="mt-4 flex flex-col gap-3"
                      >
                        <input
                          type="hidden"
                          name="projectId"
                          value={projectId}
                        />

                        <input
                          type="hidden"
                          name="candidateId"
                          value={
                            candidate.id
                          }
                        />

                        <input
                          type="hidden"
                          name="reviewAction"
                          value="REJECT"
                        />

                        <textarea
                          name="reviewNote"
                          required
                          rows={4}
                          placeholder="Informe por que este trecho não deve ser tratado como cláusula."
                          className="resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />

                        <button
                          type="submit"
                          className="inline-flex h-10 items-center justify-center rounded-md border border-destructive/40 px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                        >
                          Rejeitar candidato
                        </button>
                      </form>
                    </section>
                  </aside>
                </div>
              </article>
            )
          )}
        </section>
      )}
    </main>
  );
}
