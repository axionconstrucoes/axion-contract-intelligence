import type { Metadata } from "next";
import Link from "next/link";

import {
  ClauseCandidateReviewForm,
  ClauseDraftBadge,
  ClearClauseDraft,
} from "@/components/clauses/clause-candidate-review-form";
import { CoverageNotice } from "@/components/documents/coverage-notice";
import { PageHeader } from "@/components/layout/page-header";
import {
  getClauseReviewDetail,
  getClauseReviewList,
  type ClauseCandidateStatus,
  type ClauseReviewListItem,
} from "@/lib/clause-review-list";
import { getVersionCoverageSummaries, type VersionCoverageSummary } from "@/lib/documents/extraction/version-coverage-summary";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Análise de Cláusulas" };

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<ClauseCandidateStatus, string> = {
  PENDING_REVIEW: "Pendente",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
};

const STATUS_CLASSES: Record<ClauseCandidateStatus, string> = {
  PENDING_REVIEW: "border-slate-300 text-slate-700",
  APPROVED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  REJECTED: "border-red-300 bg-red-50 text-red-800",
};

const CONFIDENCE_EXPLANATION =
  "Confiança da detecção: quão seguro o detector está de que o trecho é o início de uma cláusula com esta numeração. " +
  "Não representa avaliação de risco jurídico, relevância ou conformidade da cláusula.";

type SearchParams = {
  q?: string;
  parte?: string;
  status?: string;
  conferir?: string;
  pagina?: string;
  item?: string;
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function pagesLabel(item: ClauseReviewListItem): string {
  if (!item.startPage) return "—";
  return item.endPage && item.endPage !== item.startPage ? `p. ${item.startPage}–${item.endPage}` : `p. ${item.startPage}`;
}

// Precisa de conferência: sinalização do detector ou página pendente /
// de revisão visual dentro do intervalo de páginas do candidato.
function checkReasons(item: ClauseReviewListItem, coverage: VersionCoverageSummary | undefined): string[] {
  const reasons = [...item.flags];
  if (coverage && item.startPage) {
    const start = item.startPage;
    const end = item.endPage ?? start;
    const inRange = (page: number) => page >= start && page <= end;
    const pending = coverage.pendingPages.filter(inRange);
    const visual = coverage.visualReviewPages.filter(inRange);
    if (pending.length) reasons.push(`Página pendente de leitura: ${pending.join(", ")}`);
    if (visual.length) reasons.push(`Página com revisão visual: ${visual.join(", ")}`);
  }
  return reasons;
}

export default async function ClauseReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);

  const { items, totals } = await getClauseReviewList(projectId);
  const coverageByVersion = await getVersionCoverageSummaries(items.map((item) => item.documentVersionId));

  // ---------- filtros (estado na URL) ----------
  const q = (query.q ?? "").slice(0, 120);
  const parte = query.parte ?? "";
  const status = (["PENDING_REVIEW", "APPROVED", "REJECTED", "TODOS"].includes(query.status ?? "")
    ? query.status
    : "PENDING_REVIEW") as ClauseCandidateStatus | "TODOS";
  const conferir = query.conferir === "1";
  const terms = fold(q).split(/\s+/).filter(Boolean);

  const withReasons = items.map((item) => ({ item, reasons: checkReasons(item, coverageByVersion.get(item.documentVersionId)) }));
  const filtered = withReasons.filter(({ item, reasons }) => {
    if (status !== "TODOS" && item.status !== status) return false;
    if (parte === "SEM" ? item.section !== null : parte && item.section !== parte) return false;
    if (conferir && reasons.length === 0) return false;
    if (terms.length && !terms.every((term) => item.searchText.includes(term))) return false;
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(query.pagina ?? "1", 10);
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), pageCount);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sections = [...new Set(items.map((item) => item.section).filter(Boolean))].sort() as string[];

  const basePath = `/${projectId}/revisao-clausulas`;
  const hrefWith = (changes: Partial<Record<keyof SearchParams, string | null>>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: q || undefined,
      parte: parte || undefined,
      status: query.status,
      conferir: query.conferir,
      pagina: page > 1 ? String(page) : undefined,
      item: query.item,
    };
    for (const [key, value] of Object.entries(changes)) merged[key] = value ?? undefined;
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const search = next.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  const detail = query.item ? await getClauseReviewDetail(projectId, query.item) : null;
  const detailReasons = detail ? checkReasons(detail, coverageByVersion.get(detail.documentVersionId)) : [];
  const returnTo = hrefWith({});

  const total = totals.PENDING_REVIEW + totals.APPROVED + totals.REJECTED;
  const versionsWithNotice = [...new Map(items.map((item) => [item.documentVersionId, item])).values()]
    .map((item) => ({ item, summary: coverageByVersion.get(item.documentVersionId) }))
    .filter((entry) => entry.summary && (entry.summary.partial || entry.summary.visualReviewPages.length > 0));

  const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Revisão de Cláusulas"
          description="Valide os candidatos identificados automaticamente antes que sejam incorporados à base contratual."
        />
        <Link
          href={`/${projectId}/documentos`}
          className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          Documentos
        </Link>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <strong>Regra de governança:</strong> a detecção automática apenas sugere cláusulas. A criação da cláusula
        contratual definitiva exige aprovação humana, registrada na auditoria. Nenhum candidato é aprovado
        automaticamente, e a lista não equivale à análise integral do contrato.
      </div>

      {versionsWithNotice.map(({ item, summary }) => (
        <div key={item.documentVersionId} className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            {item.documentTitle} · Versão {item.versionLabel}
          </p>
          <CoverageNotice summary={summary!} projectId={projectId} context="clausulas" />
        </div>
      ))}

      {/* ---------- totais ---------- */}
      <section aria-label="Totais" className="flex flex-col gap-1">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {(
            [
              ["Pendentes", totals.PENDING_REVIEW, "PENDING_REVIEW"],
              ["Aprovados", totals.APPROVED, "APPROVED"],
              ["Rejeitados", totals.REJECTED, "REJECTED"],
              ["Total detectado", total, "TODOS"],
            ] as const
          ).map(([label, value, statusKey]) => (
            <Link
              key={label}
              href={hrefWith({ status: statusKey, pagina: null, item: null })}
              className={cn("rounded-md border p-2 hover:bg-muted", status === statusKey ? "border-primary" : "")}
            >
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
            </Link>
          ))}
        </dl>
        {totals.APPROVED + totals.REJECTED > 0 ? (
          <p className="text-xs text-muted-foreground">
            A detecção registrou {total} candidatos; {totals.APPROVED + totals.REJECTED} já foram decididos por revisão
            humana ({totals.APPROVED} aprovados, {totals.REJECTED} rejeitados) — por isso a fila de pendentes tem{" "}
            {totals.PENDING_REVIEW}. As decisões ficam registradas na auditoria.
          </p>
        ) : null}
      </section>

      {/* ---------- busca e filtros (GET) ---------- */}
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">
          Buscar (número, título ou texto)
          <input
            name="q"
            defaultValue={q}
            placeholder="Ex.: 6.4, cronograma, garantia"
            className="h-9 rounded-md border bg-background px-3 text-sm font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Parte
          <select name="parte" defaultValue={parte} className={selectClass}>
            <option value="">Todas</option>
            {sections.map((section) => (
              <option key={section} value={section}>
                Parte {section}
              </option>
            ))}
            {items.some((item) => item.section === null) ? <option value="SEM">Sem parte</option> : null}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Status
          <select name="status" defaultValue={status} className={selectClass}>
            <option value="PENDING_REVIEW">Pendentes</option>
            <option value="APPROVED">Aprovados</option>
            <option value="REJECTED">Rejeitados</option>
            <option value="TODOS">Todos</option>
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-xs font-medium">
          <input type="checkbox" name="conferir" value="1" defaultChecked={conferir} />
          Só os que exigem conferência
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Filtrar
        </button>
        <Link href={basePath} className="h-9 rounded-md border px-3 text-sm leading-9 hover:bg-muted">
          Limpar
        </Link>
      </form>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---------- lista compacta ---------- */}
        <section aria-label="Candidatos" className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {filtered.length} candidato(s) · página {page} de {pageCount} · ordem do documento (6.2 antes de 6.10)
          </p>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {total === 0
                ? "Nenhum candidato detectado. Ausência de candidatos não significa ausência de cláusulas ou de riscos: o detector pode não ter reconhecido o formato do documento ou a leitura pode estar incompleta. Confira o documento original."
                : "Nenhum candidato com estes filtros."}
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {pageItems.map(({ item, reasons }) => {
                const selected = item.id === query.item;
                return (
                  <li key={item.id}>
                    <Link
                      href={hrefWith({ item: item.id })}
                      scroll={false}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-sm hover:bg-muted",
                        selected ? "bg-primary/5 ring-1 ring-inset ring-primary" : ""
                      )}
                    >
                      <span className="break-words font-mono text-xs">{item.number}</span>
                      <span className="min-w-0">
                        <span className="block truncate" title={item.title}>
                          {item.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {item.section ? `Parte ${item.section} · ` : ""}
                          {pagesLabel(item)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <ClauseDraftBadge candidateId={item.id} />
                        {reasons.length > 0 ? (
                          <span
                            title={reasons.join("\n")}
                            className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-900"
                          >
                            conferir
                          </span>
                        ) : null}
                        <span className={cn("rounded border px-1.5 text-[10px] font-medium", STATUS_CLASSES[item.status])}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {pageCount > 1 ? (
            <nav aria-label="Paginação" className="flex items-center justify-between gap-2 text-sm">
              {page > 1 ? (
                <Link href={hrefWith({ pagina: String(page - 1), item: null })} className="rounded-md border px-3 py-1 hover:bg-muted">
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted-foreground">
                Página {page} de {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={hrefWith({ pagina: String(page + 1), item: null })} className="rounded-md border px-3 py-1 hover:bg-muted">
                  Próxima →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>

        {/* ---------- detalhe do candidato selecionado ---------- */}
        <section aria-label="Candidato selecionado" className="rounded-lg border lg:sticky lg:top-4">
          {!detail ? (
            <div className="p-6 text-sm text-muted-foreground">
              {query.item
                ? "Candidato não encontrado neste projeto (pode pertencer a um documento na lixeira)."
                : "Selecione um candidato na lista para ver a evidência e revisar."}
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {detail.documentTitle} · Versão {detail.versionLabel}
                    {detail.section ? ` · Parte ${detail.section}` : ""} · {pagesLabel(detail)}
                  </p>
                  <h2 className="mt-1 text-base font-semibold">
                    <span className="font-mono">{detail.number}</span> {detail.title}
                  </h2>
                  {detail.hierarchy ? <p className="mt-1 text-xs text-muted-foreground">{detail.hierarchy}</p> : null}
                </div>
                <span className={cn("rounded border px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[detail.status])}>
                  {STATUS_LABELS[detail.status]}
                </span>
              </div>

              <div className="rounded-md border p-2 text-xs">
                <p className="font-medium">
                  Confiança da detecção: {Math.round(detail.confidence * 100)}%{" "}
                  <span className="font-normal text-muted-foreground">
                    ({detail.detector} v{detail.detectorVersion})
                  </span>
                </p>
                <p className="mt-0.5 text-muted-foreground">{CONFIDENCE_EXPLANATION}</p>
              </div>

              {detailReasons.length > 0 ? (
                <ul className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
                  <li className="font-medium">Exige conferência com o original:</li>
                  {detailReasons.map((reason) => (
                    <li key={reason}>• {reason}</li>
                  ))}
                </ul>
              ) : null}

              {/* evidência */}
              <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Evidência de origem</p>
                  {detail.startPage ? (
                    <Link
                      href={`/${projectId}/documentos/versoes/${detail.documentVersionId}?paginaGlobal=${detail.startPage}#original`}
                      className="text-xs font-medium underline underline-offset-2"
                    >
                      Abrir página original (p. {detail.startPage})
                    </Link>
                  ) : null}
                </div>
                <p className="break-words text-xs text-muted-foreground">
                  {detail.sourceLocator ?? detail.locator ?? "Localizador não informado"}
                </p>
                {detail.sourceText ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">Ver segmento extraído (página completa)</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs leading-5">
                      {detail.sourceText}
                    </pre>
                  </details>
                ) : (
                  <p className="text-xs text-muted-foreground">Segmento original não disponível.</p>
                )}
              </div>

              {detail.status === "PENDING_REVIEW" ? (
                <ClauseCandidateReviewForm
                  key={detail.id}
                  projectId={projectId}
                  candidateId={detail.id}
                  initial={{ clauseNumber: detail.number, clauseTitle: detail.proposedTitle, clauseText: detail.proposedBody }}
                  returnTo={returnTo}
                />
              ) : (
                <div className="rounded-md border p-3 text-sm">
                  <ClearClauseDraft candidateId={detail.id} />
                  <p className="font-medium">
                    {detail.status === "APPROVED" ? "Aprovado por revisão humana" : "Rejeitado por revisão humana"}
                    {detail.reviewedAt ? ` em ${new Date(detail.reviewedAt).toLocaleString("pt-BR")}` : ""}
                  </p>
                  {detail.reviewNote ? <p className="mt-1 text-xs">Observação: {detail.reviewNote}</p> : null}
                  {detail.clauseId ? <p className="mt-1 text-xs text-muted-foreground">Cláusula criada: {detail.clauseId}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">Decisão registrada na auditoria; esta tela não a altera.</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
