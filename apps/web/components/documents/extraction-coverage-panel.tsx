import Link from "next/link";
import {
  formatPageList,
  PENDING_STATUS_LABELS,
  VISUAL_REVIEW_LABELS,
  type ExtractionCoverage,
  type PageCoverage,
} from "@/lib/documents/extraction/extraction-coverage";

// Painel de cobertura de leitura da extração mais recente. Regra: nunca
// apresentar o documento como integralmente lido/analisado enquanto
// houver página pendente — nem quando a cobertura não foi registrada.

function PageLink({ page, hrefForPage }: { page: PageCoverage; hrefForPage: (page: PageCoverage) => string | null }) {
  const href = hrefForPage(page);
  const label = `p. ${page.globalPage}`;
  const title = `${page.fileName}, página local ${page.localPage} (página global ${page.globalPage})`;
  return href ? (
    <Link href={href} title={title} className="underline underline-offset-2 hover:text-foreground">
      {label}
    </Link>
  ) : (
    <span title={title}>{label}</span>
  );
}

export function ExtractionCoveragePanel({
  coverage,
  coverageMessage,
  hrefForPage,
}: {
  coverage: ExtractionCoverage | null;
  coverageMessage: string | null;
  hrefForPage: (page: PageCoverage) => string | null;
}) {
  if (!coverage) {
    return (
      <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-semibold">Cobertura de leitura não registrada</p>
        <p className="mt-1">
          Esta extração é anterior ao controle de cobertura por página (OCR). Não a considere uma leitura integral do
          documento{coverageMessage ? ` — ${coverageMessage}` : ""}.
        </p>
      </div>
    );
  }

  const percent = coverage.totalPages > 0 ? Math.floor((coverage.readPages / coverage.totalPages) * 100) : 0;
  const review = coverage.visualReview;

  return (
    <div className="flex flex-col gap-3">
      {coverage.complete ? (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p className="font-semibold">
            Leitura integral do texto: {coverage.readPages}/{coverage.totalPages} páginas
          </p>
          {review.uniquePages.length > 0 ? (
            <p className="mt-1">
              {review.uniquePages.length} página(s) ainda exigem revisão visual (desenhos, tabelas ou figuras) — o texto
              lido não garante a interpretação desses elementos.
            </p>
          ) : null}
        </div>
      ) : (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">
          <p className="font-semibold">
            Cobertura parcial: {coverage.readPages}/{coverage.totalPages} páginas lidas ({percent}%) ·{" "}
            {coverage.pendingPages.length + coverage.pagesWithoutSegments.length} página(s) pendente(s)
          </p>
          <p className="mt-1">
            Este documento <strong>não foi integralmente lido nem analisado</strong>. Análises, buscas e cláusulas
            baseadas nesta extração não incluem o conteúdo das páginas pendentes — consulte a página original.
          </p>
        </div>
      )}

      <dl className="grid gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Páginas lidas</dt>
          <dd className="text-base font-semibold">
            {coverage.readPages}/{coverage.totalPages}
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Lidas por OCR (confiança ≥ 70%)</dt>
          <dd className="text-base font-semibold">{coverage.ocrAcceptedPages}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Pendentes</dt>
          <dd className="text-base font-semibold">{coverage.pendingPages.length + coverage.pagesWithoutSegments.length}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Revisão visual (páginas únicas)</dt>
          <dd className="text-base font-semibold">{review.uniquePages.length}</dd>
        </div>
      </dl>

      {coverage.pendingPages.length > 0 || coverage.pagesWithoutSegments.length > 0 ? (
        <details className="rounded-md border p-2 text-sm" open>
          <summary className="cursor-pointer font-medium">
            Páginas pendentes ({coverage.pendingPages.length + coverage.pagesWithoutSegments.length}) — abrir original
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            {Object.entries(
              coverage.pendingPages.reduce<Record<string, PageCoverage[]>>((groups, page) => {
                const key = page.pendingStatus ?? "PENDENTE";
                (groups[key] ??= []).push(page);
                return groups;
              }, {})
            ).map(([status, pages]) => (
              <li key={status}>
                <span className="font-medium text-foreground">{PENDING_STATUS_LABELS[status] ?? status}</span> (
                {pages.length}):{" "}
                {pages.map((page, index) => (
                  <span key={page.globalPage}>
                    {index > 0 ? ", " : ""}
                    <PageLink page={page} hrefForPage={hrefForPage} />
                  </span>
                ))}
              </li>
            ))}
            {coverage.pagesWithoutSegments.length > 0 ? (
              <li>
                <span className="font-medium text-foreground">Sem texto extraído</span> (
                {coverage.pagesWithoutSegments.length}): {formatPageList(coverage.pagesWithoutSegments)}
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}

      {review.uniquePages.length > 0 ? (
        <details className="rounded-md border p-2 text-sm">
          <summary className="cursor-pointer font-medium">
            Revisão visual: {review.uniquePages.length} páginas únicas ({review.occurrences} ocorrências em categorias)
          </summary>
          <div className="mt-2 flex flex-col gap-2 text-xs text-muted-foreground">
            <ul className="flex flex-col gap-1">
              {review.byCategory.map(({ category, pages }) => (
                <li key={category}>
                  <span className="font-medium text-foreground">{VISUAL_REVIEW_LABELS[category] ?? category}</span> (
                  {pages.length}): {formatPageList(pages)}
                </li>
              ))}
            </ul>
            {review.overlaps.length > 0 ? (
              <p>
                As categorias se sobrepõem: {review.overlaps.length} página(s) aparecem em mais de uma categoria (
                {review.overlaps
                  .map(
                    (overlap) =>
                      `p. ${overlap.page}: ${overlap.categories.map((category) => VISUAL_REVIEW_LABELS[category] ?? category).join(" + ")}`
                  )
                  .join("; ")}
                ). Por isso a soma das categorias ({review.occurrences}) é maior que o total de páginas únicas (
                {review.uniquePages.length}).
              </p>
            ) : null}
            <p>
              Páginas:{" "}
              {review.uniquePages.map((page, index) => (
                <span key={page.globalPage}>
                  {index > 0 ? ", " : ""}
                  <PageLink page={page} hrefForPage={hrefForPage} />
                </span>
              ))}
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
