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

import { createRequire } from "node:module";
import path from "node:path";

// Formato: reexportado do modulo PURO (sem node:*), que o caminho de
// upload no navegador tambem usa. Ver document-format.ts.
import { resolveExtractionFormat, type SupportedExtractionFormat } from "./document-format";
export { resolveExtractionFormat };
export type { SupportedExtractionFormat };

const MAX_SEGMENT_CHARS = 5000;


export interface ExtractedDocumentText {
  /** Identificador do extrator usado — mesma convenção do script offline. */
  extractor: "pdfjs-dist" | "mammoth" | "plain-text";
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

/**
 * Diretorio das fontes padrao (Type1 base-14) que o pdfjs precisa quando
 * o PDF NAO embute a fonte — caso comum em minuta gerada por Word/Google
 * Docs com Helvetica/Times. Sem isto o pdfjs emite
 * "Ensure that the `standardFontDataUrl` API parameter is provided" e a
 * extracao pode degradar em PDFs de fonte incomum.
 *
 * Resolvido em RUNTIME a partir de process.cwd() — nunca um caminho
 * absoluto da maquina de quem escreveu o codigo. Sao testadas as duas
 * posicoes possiveis no monorepo (node_modules da app e da raiz), porque
 * o npm workspaces hoista a dependencia para a raiz.
 *
 * Os arquivos entram no bundle da Vercel por outputFileTracingIncludes
 * (ver apps/web/next.config.ts): o @vercel/nft nao consegue rastrear um
 * caminho montado dinamicamente, entao a inclusao e declarada la.
 */
let cachedStandardFontDataUrl: string | null | undefined;

export function resolveStandardFontDataUrl(): string | null {
  if (cachedStandardFontDataUrl !== undefined) return cachedStandardFontDataUrl;

  try {
    // Resolucao ESTATICA do pacote: o especificador e literal, entao o
    // @vercel/nft consegue rastrear e inclui pdfjs-dist no bundle. A
    // tentativa anterior usava existsSync sobre caminhos montados em
    // runtime, o que disparava "Dynamic filesystem access causes tracing
    // of the whole project" — tracing do repositorio inteiro no bundle.
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve("pdfjs-dist/package.json");
    const fontsDir = path.join(path.dirname(packageJson), "standard_fonts");

    // O pdfjs valida a URL da factory e exige barra final "/", nunca
    // path.sep (no Windows a barra invertida e recusada).
    cachedStandardFontDataUrl = `${fontsDir.split(path.sep).join("/")}/`;
    return cachedStandardFontDataUrl;
  } catch (error) {
    console.warn(
      "[extract-document-text] standard_fonts do pdfjs nao encontrado — PDFs sem fonte embutida podem degradar:",
      error instanceof Error ? error.message : String(error)
    );
    cachedStandardFontDataUrl = null;
    return null;
  }
}

async function extractPdf(buffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  // Build "legacy": é o que funciona em Node (sem DOM/worker de browser).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const standardFontDataUrl = resolveStandardFontDataUrl();

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Nenhuma fonte do SISTEMA é carregada (nada depende do que está
    // instalado na máquina); as base-14 vêm do próprio pdfjs-dist.
    useSystemFonts: false,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
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
    throw new UnsupportedDocumentFormatError(
      `Formato não suportado para análise jurídica: "${input.fileName}". Envie PDF, DOCX ou TXT.`
    );
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
  } else {
    text = normalizeText(Buffer.from(input.buffer).toString("utf8"));
    extractor = "plain-text";
  }

  if (!text) {
    throw new EmptyDocumentTextError(
      `Nenhum texto pôde ser extraído de "${input.fileName}". O arquivo pode ser um PDF digitalizado sem OCR.`
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
