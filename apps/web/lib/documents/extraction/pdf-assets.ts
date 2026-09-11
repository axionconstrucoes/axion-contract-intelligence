/**
 * Localização dos assets do pdfjs que são lidos EM RUNTIME, nunca
 * importados estaticamente: o worker e as fontes base-14.
 *
 * Duas armadilhas de bundler, ambas já observadas em produção:
 *
 *   1. `createRequire(import.meta.url)` dentro de código que o Turbopack
 *      empacota vira uma função reescrita, e `require.resolve` devolve um
 *      ID NUMÉRICO de módulo — daí o erro real
 *      "The path argument must be of type string. Received type number".
 *      `process.getBuiltinModule("module")` é opaco ao bundler; é o mesmo
 *      truque que o próprio pdfjs usa (pdf.mjs, bloco `if (isNodeJS)`).
 *
 *   2. o especificador tem de ser LITERAL para o @vercel/nft rastrear. Por
 *      isso resolvemos arquivos concretos (`.../pdf.worker.mjs`, uma fonte
 *      `.pfb`) em vez de montar caminhos com concatenação — o que, de
 *      quebra, já confirma a existência: `require.resolve` lança quando o
 *      arquivo não está lá, sem precisar de `existsSync` sobre caminho
 *      dinâmico (que faz o nft rastrear o projeto inteiro).
 *
 * `serverExternalPackages: ["pdfjs-dist"]` (ver next.config.ts) é o que
 * garante que o pacote continue em node_modules em runtime.
 */

/** Uma fonte real do diretório standard_fonts, usada como âncora. */
const FONT_ANCHOR = "pdfjs-dist/standard_fonts/FoxitFixed.pfb";
const WORKER_SPECIFIER = "pdfjs-dist/legacy/build/pdf.worker.mjs";

export class PdfAssetsUnavailableError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "PdfAssetsUnavailableError";
    this.detail = detail;
  }
}

export interface PdfAssets {
  /** URL `file://` do worker — o import dinâmico do Node exige URL inequívoca. */
  workerSrc: string;
  /** Caminho absoluto do worker, para diagnóstico e teste. */
  workerPath: string;
  /** Diretório das fontes, com barra final "/" (o pdfjs concatena o nome). */
  standardFontDataUrl: string;
}

let cached: PdfAssets | null = null;

function bundlerProofRequire() {
  // Opaco ao bundler: nem Turbopack nem webpack reescrevem isto.
  return process.getBuiltinModule("module").createRequire(import.meta.url);
}

/**
 * Resolve worker e fontes, confirmando que os dois existem. Lança
 * `PdfAssetsUnavailableError` quando algo falta — nunca devolve um
 * caminho parcial nem segue com análise degradada em silêncio.
 *
 * Idempotente e memoizado: a primeira chamada resolve, as seguintes
 * reaproveitam. Como é síncrono, duas requisições concorrentes não
 * disputam nada.
 */
export function resolvePdfAssets(): PdfAssets {
  if (cached) return cached;

  const require = bundlerProofRequire();
  const { pathToFileURL } = process.getBuiltinModule("url");
  const nodePath = process.getBuiltinModule("path");

  let workerPath: string;
  try {
    workerPath = require.resolve(WORKER_SPECIFIER);
  } catch (error) {
    throw new PdfAssetsUnavailableError(
      `Worker do pdfjs não encontrado ("${WORKER_SPECIFIER}"). ` +
        "Confira serverExternalPackages e outputFileTracingIncludes em next.config.ts. " +
        `Detalhe: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof workerPath !== "string") {
    // Exatamente o sintoma do bundler reescrevendo require.resolve.
    throw new PdfAssetsUnavailableError(
      `Worker do pdfjs resolvido como ${typeof workerPath}, não como caminho — ` +
        "o pacote foi empacotado pelo bundler. Verifique serverExternalPackages."
    );
  }

  let fontAnchorPath: string;
  try {
    fontAnchorPath = require.resolve(FONT_ANCHOR);
  } catch (error) {
    throw new PdfAssetsUnavailableError(
      `Fontes padrão do pdfjs não encontradas ("${FONT_ANCHOR}"). ` +
        "Confira outputFileTracingIncludes em next.config.ts. " +
        `Detalhe: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof fontAnchorPath !== "string") {
    throw new PdfAssetsUnavailableError(
      `Fontes do pdfjs resolvidas como ${typeof fontAnchorPath}, não como caminho — ` +
        "o pacote foi empacotado pelo bundler. Verifique serverExternalPackages."
    );
  }

  const fontsDir = nodePath.dirname(fontAnchorPath);

  cached = {
    workerPath,
    // URL file:// inequívoca: o import dinâmico do Node não aceita
    // caminho absoluto do Windows de forma confiável, e no Linux um
    // caminho cru vira especificador relativo.
    workerSrc: pathToFileURL(workerPath).href,
    // Barra final "/" sempre — o pdfjs valida a URL da factory e concatena
    // o nome do arquivo. Nunca path.sep (a barra invertida é recusada).
    standardFontDataUrl: `${fontsDir.split(nodePath.sep).join("/")}/`,
  };

  return cached;
}

/** Só para teste: zera a memoização entre cenários. */
export function __resetPdfAssetsForTests(): void {
  cached = null;
}
