// ============================================================
// OCR LOCAL DE PÁGINAS PDF SEM TEXTO ÚTIL
//
// Confidencialidade: tudo roda no próprio processo (pdfjs-dist +
// @napi-rs/canvas para renderizar, tesseract.js/WebAssembly para OCR,
// modelo português de @tesseract.js-data/por instalado via npm). Nenhum
// byte do documento sai da máquina/runner que já processa o arquivo;
// nenhum serviço externo, nenhum custo por página.
//
// Regras (por página, considerando TODOS os arquivos da versão juntos —
// ex.: contrato em "Parte 1 de 2" + "Parte 2 de 2"):
//   1. Texto útil = texto nativo sem linhas repetidas em muitas páginas
//      (carimbo Docusign, protocolo de registro, rodapé), com dígitos
//      normalizados para que "Página 3 de 157" conte como repetição.
//   2. Página com menos de MIN_USEFUL_CHARS de texto útil é RENDERIZADA
//      (sempre — independentemente de haver imagem: conteúdo vetorial
//      ou texto convertido em curvas também precisa ser lido) e passa
//      por OCR em português.
//   3. O OCR nunca substitui o texto nativo: só as linhas que ainda não
//      existem no texto nativo (nem são carimbo/rodapé) são acrescentadas.
//   4. Cada página recebe um status de cobertura; páginas não lidas são
//      PENDENTES e nunca contam como leitura integral.
//   5. Desenhos/tabelas/imagens relevantes são sinalizados para revisão
//      visual — OCR não garante a interpretação desses elementos.
// ============================================================

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker, OEM } from "tesseract.js";

const require = createRequire(import.meta.url);

export const OCR_ENGINE = "tesseract.js";
export const OCR_ENGINE_VERSION = "7.0.0";
export const OCR_LANGUAGE = "por";
export const OCR_MODEL = "4.0.0_best_int";

export const MIN_USEFUL_CHARS = 200;
const RENDER_DPI = 300;
const MIN_OCR_CONFIDENCE = 70;
const MIN_ADDED_CHARS = 20;
const BLANK_INK_RATIO = 0.005;
const LARGE_IMAGE_PIXELS = 200_000;
const VECTOR_PATHS_FOR_REVIEW = 100;
const DUPLICATE_SIMILARITY = 0.8;

export const PAGE_STATUS = {
  NATIVE: "TEXTO_NATIVO",
  OCR: "OCR",
  OCR_LOW_CONFIDENCE: "OCR_BAIXA_CONFIANCA",
  NO_ADDITIONAL_CONTENT: "SEM_CONTEUDO_ADICIONAL",
  BLANK: "PAGINA_EM_BRANCO",
  GRAPHIC_WITHOUT_TEXT: "GRAFICO_SEM_TEXTO",
  OCR_FAILED: "FALHA_OCR",
};

// Status que significam conteúdo NÃO lido (ou lido sem confiabilidade).
export const PENDING_STATUSES = new Set([
  PAGE_STATUS.OCR_LOW_CONFIDENCE,
  PAGE_STATUS.GRAPHIC_WITHOUT_TEXT,
  PAGE_STATUS.OCR_FAILED,
]);

function normalizeLine(line) {
  return line
    .normalize("NFC")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

// Chave só com letras/dígitos — base da comparação aproximada (o OCR troca
// "I" por "|", "–" por "-", etc.).
function letterKey(line) {
  return normalizeLine(line).replace(/[^\p{L}#]/gu, "");
}

function bigrams(key) {
  const out = new Map();
  for (let index = 0; index < key.length - 1; index += 1) {
    const gram = key.slice(index, index + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

// Similaridade de Dice por bigramas (0–1).
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

// Esqueleto ASCII: remove acentos e qualquer letra fora de a–z — torna
// comparáveis o texto nativo com codificação de fonte quebrada
// ("DocumentaÁ„o TÈcnica") e o OCR da mesma linha ("Documentação Técnica").
function asciiSkeleton(key) {
  return key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z#]/g, "");
}

function isNearDuplicate(key, existingKeys) {
  if (!key) return true;
  const skeleton = asciiSkeleton(key);
  for (const existing of existingKeys) {
    if (!existing) continue;
    if (key.length >= 8 && existing.includes(key)) return true;
    if (similarity(key, existing) >= DUPLICATE_SIMILARITY) return true;
    if (skeleton.length >= 8 && similarity(skeleton, asciiSkeleton(existing)) >= 0.75) return true;
  }
  return false;
}

function compact(text) {
  return text.replace(/\s+/g, "");
}

// Texto nativo da página em linhas (pdfjs marca fim de linha com hasEOL).
async function readNativeLines(page) {
  const content = await page.getTextContent();
  const lines = [];
  let current = "";
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    current += item.str;
    if (item.hasEOL) {
      lines.push(current);
      current = "";
    } else {
      current += " ";
    }
  }
  if (current.trim()) lines.push(current);
  return lines.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// Inventário gráfico: imagens (com dimensão em pixels) e operações de
// caminho vetorial — base da sinalização de revisão visual.
async function readGraphics(page) {
  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  const images = [];
  let vectorPaths = 0;
  for (let index = 0; index < ops.fnArray.length; index += 1) {
    const fn = ops.fnArray[index];
    const args = ops.argsArray[index];
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintInlineImageXObject) {
      const width = Number(args?.[1] ?? args?.[0]?.width ?? 0);
      const height = Number(args?.[2] ?? args?.[0]?.height ?? 0);
      images.push({ width, height, signature: `${width}x${height}` });
    } else if (fn === OPS.paintImageMaskXObject) {
      images.push({ width: 0, height: 0, signature: "mask" });
    } else if (fn === OPS.constructPath) {
      vectorPaths += 1;
    }
  }
  return { images, vectorPaths };
}

function ranges(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const out = [];
  let start = null;
  let end = null;
  for (const n of sorted) {
    if (start === null) {
      start = end = n;
    } else if (n === end + 1) {
      end = n;
    } else {
      out.push(start === end ? `${start}` : `${start}–${end}`);
      start = end = n;
    }
  }
  if (start !== null) out.push(start === end ? `${start}` : `${start}–${end}`);
  return out.join(", ");
}

export { ranges as formatPageRanges };

async function renderPage(page) {
  const viewport = page.getViewport({ scale: RENDER_DPI / 72 });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  // Proporção de "tinta" (pixels escuros) — distingue página em branco
  // de página com desenho/texto que o OCR não conseguiu ler.
  const { data } = context.getImageData(0, 0, width, height);
  let dark = 0;
  let sampled = 0;
  for (let offset = 0; offset < data.length; offset += 4 * 7) {
    const luminance = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    if (luminance < 160) dark += 1;
    sampled += 1;
  }

  return { png: canvas.toBuffer("image/png"), inkRatio: sampled ? dark / sampled : 0, width, height };
}

function looksLikeTable(text) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const numericLines = lines.filter((line) => (line.match(/\d+[.,]?\d*/g) ?? []).length >= 3).length;
  const digits = (text.match(/\d/g) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return numericLines / lines.length >= 0.3 || (letters > 0 && digits / (digits + letters) >= 0.25);
}

async function createOcrWorker() {
  // Caminho de diretório local (não URL): em Node o tesseract.js lê o
  // modelo do disco — nunca baixa nada da internet.
  const langPath = join(dirname(require.resolve("@tesseract.js-data/por/package.json")), OCR_MODEL);
  const worker = await createWorker(OCR_LANGUAGE, OEM.LSTM_ONLY, {
    langPath,
    gzip: true,
    cacheMethod: "none",
  });
  return worker;
}

/**
 * Analisa todas as páginas dos PDFs de uma versão documental e aplica OCR
 * onde não há texto útil.
 *
 * @param {Array<{ fileId: string|null, fileName: string, buffer: Buffer, pageOffset: number }>} files
 * @param {{ log?: (message: string) => void, concurrency?: number }} [options]
 * @returns {Promise<{ pages: Array<object>, summary: object }>}
 */
export async function analyzePdfPagesWithOcr(files, options = {}) {
  const log = options.log ?? (() => {});
  const concurrency = Math.max(1, options.concurrency ?? 2);

  // ---------- 1. inventário de todas as páginas ----------
  const loaded = [];
  const pages = [];
  for (const file of files) {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(file.buffer),
      useSystemFonts: true,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    loaded.push({ file, pdf, loadingTask });
    for (let localPage = 1; localPage <= pdf.numPages; localPage += 1) {
      const page = await pdf.getPage(localPage);
      const [nativeLines, graphics] = await Promise.all([readNativeLines(page), readGraphics(page)]);
      pages.push({
        fileId: file.fileId,
        fileName: file.fileName,
        localPage,
        globalPage: file.pageOffset + localPage,
        nativeLines,
        graphics,
      });
      page.cleanup();
    }
  }

  // ---------- 2. carimbos/rodapés repetidos ----------
  const repeatThreshold = Math.max(5, Math.ceil(pages.length * 0.2));
  const lineFrequency = new Map();
  const imageFrequency = new Map();
  for (const page of pages) {
    for (const key of new Set(page.nativeLines.map(normalizeLine).filter(Boolean))) {
      lineFrequency.set(key, (lineFrequency.get(key) ?? 0) + 1);
    }
    for (const signature of new Set(page.graphics.images.map((image) => image.signature))) {
      imageFrequency.set(signature, (imageFrequency.get(signature) ?? 0) + 1);
    }
  }
  const boilerplate = new Set([...lineFrequency].filter(([, count]) => count >= repeatThreshold).map(([key]) => key));
  const isBoilerplate = (line) => {
    const key = normalizeLine(line);
    if (!key) return true;
    if (boilerplate.has(key)) return true;
    // Linha nativa que contém um carimbo repetido + pouco texto extra.
    for (const stamp of boilerplate) {
      if (stamp.length >= 15 && key.includes(stamp) && key.length - stamp.length < 15) return true;
    }
    return false;
  };

  const boilerplateKeys = [...boilerplate].map((key) => key.replace(/[^\p{L}#]/gu, ""));

  for (const page of pages) {
    const usefulLines = page.nativeLines.filter((line) => !isBoilerplate(line));
    page.usefulNativeChars = compact(usefulLines.join(" ")).length;
    page.needsOcr = page.usefulNativeChars < MIN_USEFUL_CHARS;
    page.nativeKeys = page.nativeLines.map(letterKey).filter(Boolean);
    page.visualReview = [];
    // Páginas com texto nativo: figura grande (não repetida, ex.: não é o
    // logo do cabeçalho) ou muitos caminhos vetoriais (tabela/desenho).
    // Em páginas digitalizadas a "imagem" é a própria página e os vetores
    // costumam ser texto em curvas — ali quem decide é o resultado do OCR.
    if (!page.needsOcr) {
      const relevantImages = page.graphics.images.filter(
        (image) => image.width * image.height >= LARGE_IMAGE_PIXELS && (imageFrequency.get(image.signature) ?? 0) < repeatThreshold
      );
      if (relevantImages.length > 0) page.visualReview.push("FIGURA_EMBUTIDA");
      if (page.graphics.vectorPaths >= VECTOR_PATHS_FOR_REVIEW) page.visualReview.push("TABELA_OU_DESENHO_VETORIAL");
    }
    page.status = PAGE_STATUS.NATIVE;
    page.ocr = null;
  }

  // ---------- 3. renderização + OCR das páginas sem texto útil ----------
  // ocrPageFilter: só para testes/amostragem — o worker nunca o passa.
  const queue = pages.filter((page) => page.needsOcr && (!options.ocrPageFilter || options.ocrPageFilter(page)));
  log(`OCR: ${queue.length} de ${pages.length} páginas sem texto útil (limiar ${MIN_USEFUL_CHARS} caracteres; carimbos/rodapés repetidos desconsiderados).`);

  const pdfByFile = new Map(loaded.map(({ file, pdf }) => [file, pdf]));
  const fileByName = new Map(files.map((file) => [`${file.fileId}|${file.fileName}`, file]));
  const workers = await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, () => createOcrWorker()));

  let done = 0;
  async function runQueue(worker) {
    for (;;) {
      const page = queue.shift();
      if (!page) return;
      try {
        const pdf = pdfByFile.get(fileByName.get(`${page.fileId}|${page.fileName}`));
        const pdfPage = await pdf.getPage(page.localPage);
        const rendered = await renderPage(pdfPage);
        pdfPage.cleanup();

        const { data } = await worker.recognize(rendered.png);
        const ocrText = String(data.text ?? "");
        const confidence = Math.round(Number(data.confidence ?? 0));

        // Só acrescenta o que não existe no texto nativo nem é carimbo.
        const addedLines = [];
        const seen = [...page.nativeKeys];
        for (const rawLine of ocrText.split(/\n/)) {
          const line = rawLine.replace(/\s+/g, " ").trim();
          const key = letterKey(line);
          if (key.replace(/#/g, "").length < 2) continue;
          if (isBoilerplate(line) || /docusign\s*envelope/i.test(line)) continue;
          if (isNearDuplicate(key, seen) || isNearDuplicate(key, boilerplateKeys)) continue;
          seen.push(key);
          addedLines.push(line);
        }
        const addedText = addedLines.join("\n");
        const addedChars = compact(addedText).length;

        page.ocr = { confidence, addedText, addedChars, inkRatio: Number(rendered.inkRatio.toFixed(4)) };

        if (addedChars >= MIN_ADDED_CHARS) {
          page.status = confidence >= MIN_OCR_CONFIDENCE ? PAGE_STATUS.OCR : PAGE_STATUS.OCR_LOW_CONFIDENCE;
          if (page.status === PAGE_STATUS.OCR_LOW_CONFIDENCE) page.visualReview.push("OCR_BAIXA_CONFIANCA");
          if (looksLikeTable(addedText) && !page.visualReview.includes("TABELA_DIGITALIZADA")) {
            page.visualReview.push("TABELA_DIGITALIZADA");
          }
        } else if (rendered.inkRatio < BLANK_INK_RATIO) {
          page.status = page.usefulNativeChars > 0 ? PAGE_STATUS.NO_ADDITIONAL_CONTENT : PAGE_STATUS.BLANK;
        } else if (page.usefulNativeChars > 0 && page.graphics.images.length === 0 && page.graphics.vectorPaths < VECTOR_PATHS_FOR_REVIEW) {
          // Capa/divisória: o pouco texto nativo já é todo o conteúdo.
          page.status = PAGE_STATUS.NO_ADDITIONAL_CONTENT;
        } else {
          page.status = PAGE_STATUS.GRAPHIC_WITHOUT_TEXT;
          if (!page.visualReview.includes("CONTEUDO_GRAFICO_SEM_TEXTO")) page.visualReview.push("CONTEUDO_GRAFICO_SEM_TEXTO");
        }
      } catch (error) {
        page.status = PAGE_STATUS.OCR_FAILED;
        page.ocr = { error: error instanceof Error ? error.message : String(error) };
      }
      done += 1;
      if (done % 10 === 0) log(`OCR: ${done} páginas processadas…`);
    }
  }

  try {
    await Promise.all(workers.map((worker) => runQueue(worker)));
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
    await Promise.all(loaded.map(({ loadingTask }) => loadingTask.destroy().catch(() => {})));
  }

  // ---------- 4. resumo de cobertura ----------
  const byStatus = (status) => pages.filter((page) => page.status === status).map((page) => page.globalPage);
  const pending = pages.filter((page) => PENDING_STATUSES.has(page.status));
  const visual = pages.filter((page) => page.visualReview.length > 0);
  const summary = {
    totalPages: pages.length,
    nativePages: byStatus(PAGE_STATUS.NATIVE).length,
    ocrPages: byStatus(PAGE_STATUS.OCR),
    noAdditionalContentPages: byStatus(PAGE_STATUS.NO_ADDITIONAL_CONTENT),
    blankPages: byStatus(PAGE_STATUS.BLANK),
    pendingPages: pending.map((page) => ({ globalPage: page.globalPage, status: page.status, fileName: page.fileName, localPage: page.localPage })),
    visualReviewPages: visual.map((page) => ({ globalPage: page.globalPage, reasons: page.visualReview })),
    boilerplateLines: boilerplate.size,
    complete: pending.length === 0,
    engine: `${OCR_ENGINE} ${OCR_ENGINE_VERSION} (${OCR_LANGUAGE} ${OCR_MODEL}, ${RENDER_DPI} dpi)`,
  };

  return { pages, summary };
}
