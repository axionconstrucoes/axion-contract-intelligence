// Testes do cálculo de cobertura de leitura
// (apps/web/lib/documents/extraction/extraction-coverage.ts).
// Uso: node scripts/test-extraction-coverage.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { computeExtractionCoverage, formatPageList } = await import(
  "../apps/web/lib/documents/extraction/extraction-coverage.ts"
);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    console.log(`     ${error instanceof Error ? error.message : error}`);
  }
}

function assertEqual(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`esperado ${e}, obtido ${a}`);
}

const seg = (page, file, local, method, extra = "") => ({
  page_number: page,
  locator: `${file} · pág. local ${local} · pág. global ${page} · ${method}${extra}`,
});

// Documento sintético em 2 partes, 5 páginas.
const segments = [
  seg(1, "P1.pdf", 1, "TEXTO_NATIVO"),
  seg(1, "P1.pdf", 1, "TEXTO_NATIVO, parte 2"),
  seg(2, "P1.pdf", 2, "TEXTO_NATIVO", " · REVISAO_VISUAL: FIGURA_EMBUTIDA,TABELA_OU_DESENHO_VETORIAL"),
  seg(3, "P2.pdf", 1, "TEXTO_NATIVO"),
  seg(3, "P2.pdf", 1, "OCR por (confianca 91%)"),
  seg(4, "P2.pdf", 2, "TEXTO_NATIVO", " · REVISAO_VISUAL: OCR_BAIXA_CONFIANCA,TABELA_DIGITALIZADA"),
  seg(4, "P2.pdf", 2, "OCR por (confianca 48%)", " · REVISAO_VISUAL: OCR_BAIXA_CONFIANCA,TABELA_DIGITALIZADA"),
  seg(4, "P2.pdf", 2, "PENDENTE: OCR_BAIXA_CONFIANCA", " · REVISAO_VISUAL: OCR_BAIXA_CONFIANCA,TABELA_DIGITALIZADA"),
  seg(5, "P2.pdf", 3, "TEXTO_NATIVO", " · REVISAO_VISUAL: FIGURA_EMBUTIDA"),
];

const coverage = computeExtractionCoverage(segments, 5);

check("páginas lidas/total e pendentes", () => {
  assertEqual([coverage.readPages, coverage.totalPages, coverage.pendingPages.map((p) => p.globalPage)], [4, 5, [4]]);
  assertEqual(coverage.complete, false);
});
check("OCR aceito exclui página pendente (baixa confiança)", () => {
  assertEqual([coverage.ocrPages, coverage.ocrAcceptedPages], [2, 1]);
});
check("arquivo de origem e página local preservados por página global", () => {
  const page4 = coverage.pendingPages[0];
  assertEqual([page4.fileName, page4.localPage, page4.globalPage, page4.pendingStatus], ["P2.pdf", 2, 4, "OCR_BAIXA_CONFIANCA"]);
});
check("revisão visual: categorias sobrepostas contadas uma vez por página", () => {
  assertEqual(coverage.visualReview.uniquePages.map((p) => p.globalPage), [2, 4, 5]);
  assertEqual(coverage.visualReview.occurrences, 5);
  assertEqual(coverage.visualReview.overlaps.map((o) => o.page), [2, 4]);
});
check("página sem nenhum segmento conta como não lida", () => {
  const partial = computeExtractionCoverage(segments.filter((s) => s.page_number !== 5), 5);
  assertEqual([partial.readPages, partial.pagesWithoutSegments, partial.complete], [3, [5], false]);
});
check("extração antiga (sem locator de cobertura) devolve null — nunca 'integral'", () => {
  assertEqual(computeExtractionCoverage([{ page_number: 1, locator: "PDF página 1" }], 1), null);
});
check("documento todo lido = completo", () => {
  const full = computeExtractionCoverage([seg(1, "A.pdf", 1, "TEXTO_NATIVO"), seg(2, "A.pdf", 2, "OCR por (confianca 95%)")], 2);
  assertEqual([full.readPages, full.complete], [2, true]);
});
check("formatPageList agrupa intervalos", () => {
  assertEqual(formatPageList([5, 1, 2, 3, 9, 10]), "1–3, 5, 9–10");
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
