// Extração de texto de um documento jurídico (PDF/DOCX/TXT) — versão
// TypeScript, executada NO SERVIDOR (Server Action / Server Component).
//
// Porta a mesma lógica já validada em scripts/document-extractors.mjs
// (pdfjs-dist para PDF, mammoth para DOCX), sem duplicar comportamento:
// mesmos extratores, mesma normalização, mesmo limite de segmento. O
// script offline continua existindo e é quem persiste extrações em
// document_extractions/document_text_segments; ESTE módulo nunca escreve
// nada — ele extrai em memória para uma finalidade imediata (liberar a
// consulta jurídica e montar o contexto do Expert).
//
// Nenhum dado do navegador chega aqui: quem chama já validou usuário,
// permissão, workspace e o vínculo documento→projeto.

// NAO usa `import "server-only"`: este modulo esta no grafo de imports de
// ai/context/build-project-context.ts, que por sua vez e carregado pelos
// scripts Node do repositorio (scripts/test-*.mjs, analise offline). O
// pacote server-only quebraria todos eles. A garantia de servidor vem do
// uso: quem chama e Server Action/Server Component, e nada aqui le
// variavel de ambiente nem secret.

import { loadPdfjs, resolveStandardFontDataUrl } from "./pdf-runtime";

// Formato: reexportado do modulo PURO (sem node:*), que o caminho de
// upload no navegador tambem usa. Ver document-format.ts.
import {
  resolveExtractionFormat,
  unsupportedFormatDetail,
  type SupportedExtractionFormat,
} from "./document-format";
export { resolveExtractionFormat, resolveStandardFontDataUrl, unsupportedFormatDetail };
export type { SupportedExtractionFormat };

const MAX_SEGMENT_CHARS = 5000;


export interface ExtractedDocumentText {
  /** Identificador do extrator usado — mesma convenção do script offline. */
  extractor: "pdfjs-dist" | "mammoth" | "plain-text" | "exceljs";
  extractorVersion: string;
  format: SupportedExtractionFormat;
  pageCount: number | null;
  text: string;
  characterCount: number;
}

/**
 * Formato não suportado NUNCA vira texto vazio silencioso: quem chama
 * precisa distinguir "documento sem conteúdo extraível" de "não sabemos
 * ler este formato". Ver UnsupportedDocumentFormatError.
 */
export class UnsupportedDocumentFormatError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "UnsupportedDocumentFormatError";
    this.detail = detail;
  }
}

export class EmptyDocumentTextError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "EmptyDocumentTextError";
    this.detail = detail;
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(buffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  // loadPdfjs instala DOMMatrix/Path2D ANTES do import e memoiza o
  // carregamento — ver pdf-runtime.ts para a medição de quais operações
  // o pdfjs realmente usa na extração de texto.
  const pdfjs = await loadPdfjs();

  const standardFontDataUrl = resolveStandardFontDataUrl();

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Nenhuma fonte do SISTEMA é carregada (nada depende do que está
    // instalado na máquina); as base-14 vêm do próprio pdfjs-dist.
    useSystemFonts: false,
    // Sempre presente: resolvePdfAssets lanca se as fontes faltarem.
    standardFontDataUrl,
  }).promise;

  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => (typeof item === "object" && item !== null && "str" in item ? String(item.str) : ""))
      .join(" ");
    pages.push(normalizeText(pageText));
  }

  return { text: normalizeText(pages.filter(Boolean).join("\n\n")), pageCount: pdf.numPages };
}

async function extractDocx(buffer: ArrayBuffer): Promise<{ text: string }> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return { text: normalizeText(result.value) };
}

/**
 * Extrai o texto de um documento já baixado do Storage. Somente leitura:
 * nunca escreve em banco, nunca envia nada para fora.
 */
export async function extractDocumentText(input: {
  buffer: ArrayBuffer;
  mimeType: string | null;
  fileName: string;
}): Promise<ExtractedDocumentText> {
  const format = resolveExtractionFormat(input.mimeType, input.fileName);

  if (format === null) {
    // Motivo vem de document-format.ts — mesma mensagem que o navegador
    // já mostraria antes do upload, inclusive o caso específico do .mpp.
    throw new UnsupportedDocumentFormatError(unsupportedFormatDetail(input.mimeType, input.fileName));
  }

  let text: string;
  let pageCount: number | null = null;
  let extractor: ExtractedDocumentText["extractor"];

  if (format === "PDF") {
    const result = await extractPdf(input.buffer);
    text = result.text;
    pageCount = result.pageCount;
    extractor = "pdfjs-dist";
  } else if (format === "DOCX") {
    text = (await extractDocx(input.buffer)).text;
    extractor = "mammoth";
  } else if (format === "XLSX") {
    // Import dinâmico pelo mesmo motivo do mammoth: exceljs só é
    // carregado quando alguém de fato envia uma planilha.
    const { extractXlsxText } = await import("./extract-xlsx-text");
    text = (await extractXlsxText(input.buffer)).text;
    extractor = "exceljs";
  } else {
    text = normalizeText(Buffer.from(input.buffer).toString("utf8"));
    extractor = "plain-text";
  }

  if (!text) {
    throw new EmptyDocumentTextError(
      format === "XLSX"
        ? `Nenhum conteúdo pôde ser lido de "${input.fileName}". A planilha parece estar vazia.`
        : `Nenhum texto pôde ser extraído de "${input.fileName}". O arquivo pode ser um PDF digitalizado sem OCR.`
    );
  }

  return {
    extractor,
    extractorVersion: "1",
    format,
    pageCount,
    text,
    characterCount: text.length,
  };
}

/**
 * Corta o texto a um orçamento de caracteres, SEMPRE de forma declarada
 * (ver ContextContractualDocument.truncated) — nunca um corte silencioso
 * que faria o Expert opinar sobre metade de um contrato achando que viu
 * o todo.
 */
export function truncateForContext(
  text: string,
  budget: number
): { text: string; truncated: boolean; omittedCharacters: number } {
  if (text.length <= budget) {
    return { text, truncated: false, omittedCharacters: 0 };
  }

  const kept = text.slice(0, budget);
  return { text: kept, truncated: true, omittedCharacters: text.length - budget };
}

export { MAX_SEGMENT_CHARS };
