// ============================================================
// COBERTURA DE LEITURA DE UMA EXTRAÇÃO (puro, sem I/O)
//
// O schema atual não tem colunas de cobertura: o worker
// (scripts/process-document-version.mjs + scripts/lib/pdf-ocr.mjs)
// registra tudo no locator de cada segmento:
//   "<arquivo> · pág. local L · pág. global G · <MÉTODO>[ · REVISAO_VISUAL: A,B]"
// com MÉTODO = TEXTO_NATIVO | OCR por (confianca N%) | PENDENTE: <status>.
// Este módulo reconstrói a cobertura por página a partir disso. Extração
// sem esse formato (anterior ao controle de cobertura) devolve null —
// a tela deve dizer "cobertura não registrada", nunca "integral".
// ============================================================

export type CoverageSegment = {
  page_number: number | null;
  locator: string | null;
};

export type PageCoverage = {
  globalPage: number;
  fileName: string;
  localPage: number;
  methods: Array<"TEXTO_NATIVO" | "OCR" | "PENDENTE">;
  ocrConfidence: number | null;
  pendingStatus: string | null;
  visualReview: string[];
};

export type ExtractionCoverage = {
  totalPages: number;
  readPages: number;
  pendingPages: PageCoverage[];
  pagesWithoutSegments: number[];
  visualReview: {
    uniquePages: PageCoverage[];
    byCategory: Array<{ category: string; pages: number[] }>;
    occurrences: number;
    // Páginas presentes em mais de uma categoria — explica por que a
    // soma das categorias é maior que o total de páginas únicas.
    overlaps: Array<{ page: number; categories: string[] }>;
  };
  ocrPages: number;
  // OCR aceito (confiança suficiente) — exclui páginas pendentes.
  ocrAcceptedPages: number;
  complete: boolean;
};

const LOCATOR =
  /^(.+?) · pág\. local (\d+) · pág\. global (\d+) · (TEXTO_NATIVO|OCR|PENDENTE)(?: \w+ \(confianca (\d+)%\))?(?:: (\w+))?/;
const REVIEW = /REVISAO_VISUAL: ([\w,]+)/;

export const VISUAL_REVIEW_LABELS: Record<string, string> = {
  TABELA_OU_DESENHO_VETORIAL: "Tabela ou desenho vetorial",
  FIGURA_EMBUTIDA: "Figura embutida",
  TABELA_DIGITALIZADA: "Tabela digitalizada (OCR não preserva a estrutura)",
  OCR_BAIXA_CONFIANCA: "OCR com baixa confiança",
  CONTEUDO_GRAFICO_SEM_TEXTO: "Conteúdo gráfico sem texto",
};

export const PENDING_STATUS_LABELS: Record<string, string> = {
  OCR_BAIXA_CONFIANCA: "OCR com confiança abaixo de 70%",
  GRAFICO_SEM_TEXTO: "Conteúdo gráfico sem texto legível",
  FALHA_OCR: "Falha no OCR",
};

export function computeExtractionCoverage(
  segments: CoverageSegment[],
  pageCount: number | null
): ExtractionCoverage | null {
  const pages = new Map<number, PageCoverage>();

  for (const segment of segments) {
    const match = segment.locator?.match(LOCATOR);
    if (!match) continue;
    const globalPage = Number(match[3]);
    const page =
      pages.get(globalPage) ??
      ({
        globalPage,
        fileName: match[1],
        localPage: Number(match[2]),
        methods: [],
        ocrConfidence: null,
        pendingStatus: null,
        visualReview: [],
      } satisfies PageCoverage);

    const method = match[4] as PageCoverage["methods"][number];
    if (!page.methods.includes(method)) page.methods.push(method);
    if (method === "OCR" && match[5]) page.ocrConfidence = Number(match[5]);
    if (method === "PENDENTE") page.pendingStatus = match[6] ?? "PENDENTE";

    const review = segment.locator?.match(REVIEW)?.[1];
    if (review) {
      for (const reason of review.split(",")) {
        if (!page.visualReview.includes(reason)) page.visualReview.push(reason);
      }
    }
    pages.set(globalPage, page);
  }

  if (pages.size === 0) return null;

  const totalPages = pageCount ?? Math.max(...pages.keys());
  const ordered = [...pages.values()].sort((a, b) => a.globalPage - b.globalPage);
  const pagesWithoutSegments: number[] = [];
  for (let page = 1; page <= totalPages; page += 1) {
    if (!pages.has(page)) pagesWithoutSegments.push(page);
  }

  const pendingPages = ordered.filter((page) => page.pendingStatus);
  const reviewPages = ordered.filter((page) => page.visualReview.length > 0);

  const categories = new Map<string, number[]>();
  for (const page of reviewPages) {
    for (const reason of page.visualReview) {
      const list = categories.get(reason) ?? [];
      list.push(page.globalPage);
      categories.set(reason, list);
    }
  }

  // Página sem segmento algum também é conteúdo não lido.
  const unread = pendingPages.length + pagesWithoutSegments.length;

  return {
    totalPages,
    readPages: totalPages - unread,
    pendingPages,
    pagesWithoutSegments,
    visualReview: {
      uniquePages: reviewPages,
      byCategory: [...categories].map(([category, list]) => ({ category, pages: list })),
      occurrences: reviewPages.reduce((sum, page) => sum + page.visualReview.length, 0),
      overlaps: reviewPages
        .filter((page) => page.visualReview.length > 1)
        .map((page) => ({ page: page.globalPage, categories: page.visualReview })),
    },
    ocrPages: ordered.filter((page) => page.methods.includes("OCR")).length,
    ocrAcceptedPages: ordered.filter((page) => page.methods.includes("OCR") && !page.pendingStatus).length,
    complete: unread === 0,
  };
}

export function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  let start: number | null = null;
  let end: number | null = null;
  for (const page of sorted) {
    if (start === null || end === null) {
      start = end = page;
    } else if (page === end + 1) {
      end = page;
    } else {
      out.push(start === end ? `${start}` : `${start}–${end}`);
      start = end = page;
    }
  }
  if (start !== null && end !== null) out.push(start === end ? `${start}` : `${start}–${end}`);
  return out.join(", ");
}
