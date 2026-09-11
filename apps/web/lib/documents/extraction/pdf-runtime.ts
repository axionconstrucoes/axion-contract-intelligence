// Runtime do pdfjs-dist em Node/Vercel.
//
// O build "legacy" do pdfjs assume `DOMMatrix` e `Path2D` globais. Em
// Node ele tenta polyfillá-los a partir de `@napi-rs/canvas`, que é uma
// `optionalDependency` — presente no `node_modules` local (por isso os
// testes passavam) e AUSENTE no bundle da função da Vercel, porque o
// @vercel/nft não rastreia o `createRequire` dinâmico dentro do
// try/catch do próprio pdfjs. Sem o pacote, `pdf.mjs:16713`
// (`const SCALE_MATRIX = new DOMMatrix()`, escopo de módulo) derruba a
// AVALIAÇÃO do módulo com `ReferenceError: DOMMatrix is not defined`.
//
// ── O que realmente é usado (medido, não suposto) ──────────────────────
// Instrumentei `DOMMatrix`/`Path2D` com Proxy e registrei todo acesso:
//
//   import do módulo ....... DOMMatrix.constructor(0 args) — e só
//   getDocument ............ nenhum
//   getPage ................ nenhum
//   getTextContent ......... nenhum
//
// Verificado com texto posicionado por `Tm`, rotação de 45° (`Tm` com
// seno/cosseno), página com `/Rotate 90` e `cm` com escala — em todos, o
// `transform` de cada item de texto saiu correto. O pdfjs calcula
// transformação de texto com `Util.transform` sobre arrays simples.
//
// Mesmo assim, o polyfill abaixo é uma implementação 2D COMPLETA, não um
// `class DOMMatrix {}`. Uma classe vazia permitiria o import e produziria
// resultado silenciosamente errado no dia em que algum caminho passasse a
// usá-la — e "hoje ninguém usa" é exatamente o tipo de premissa que não
// deve sustentar um pipeline de documento jurídico.
//
// ── Fronteira declarada: Path2D ────────────────────────────────────────
// `Path2D` só existe para rasterização, e a extração de texto não
// rasteriza nada (medido acima: nenhum acesso). O stub aqui NÃO finge
// funcionar: cada método lança. Se algum caminho de renderização for
// alcançado um dia, ele falha alto e aparece no log — em vez de devolver
// um recorte errado em silêncio.

import { createRequire } from "node:module";
import path from "node:path";

const LOG_PREFIX = "[extract-document-text]";

/** Erro de fronteira: renderização não é suportada neste runtime. */
export class PdfRenderingNotSupportedError extends Error {
  constructor(operation: string) {
    super(
      `Operação de renderização não suportada na extração de texto: ${operation}. ` +
        "Este runtime lê texto de PDF; não rasteriza páginas."
    );
    this.name = "PdfRenderingNotSupportedError";
  }
}

interface Matrix2DLike {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function isMatrixLike(value: unknown): value is Matrix2DLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["a", "b", "c", "d", "e", "f"].every((key) => typeof candidate[key] === "number");
}

/**
 * Implementação 2D de DOMMatrix, fiel à semântica da especificação para
 * tudo o que uma matriz 2D faz. Convenção de coluna:
 *
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 *
 * `multiplySelf(other)` pós-multiplica (`this = this × other`), como no
 * DOM: `other` é aplicada ANTES de `this` sobre um ponto.
 *
 * Matriz 3D genuína NÃO é suportada — e isso lança, em vez de projetar em
 * 2D silenciosamente. O pdfjs só constrói matrizes 2D (arrays de 6).
 */
export class DomMatrix2DPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: unknown) {
    if (init === undefined || init === null) return;

    if (typeof init === "string") {
      // O pdfjs nunca constrói a partir de string. Lançar é melhor que
      // devolver identidade e produzir coordenada errada.
      throw new PdfRenderingNotSupportedError("DOMMatrix a partir de string CSS");
    }

    if (Array.isArray(init) || ArrayBuffer.isView(init)) {
      const values = Array.from(init as ArrayLike<number>, Number);

      if (values.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = values;
        return;
      }

      if (values.length === 16) {
        const tridimensional =
          values[2] !== 0 || values[3] !== 0 || values[6] !== 0 || values[7] !== 0 ||
          values[8] !== 0 || values[9] !== 0 || values[10] !== 1 || values[11] !== 0 ||
          values[14] !== 0 || values[15] !== 1;

        if (tridimensional) {
          throw new PdfRenderingNotSupportedError("DOMMatrix 3D");
        }

        // m11, m12, m21, m22, m41, m42 → a, b, c, d, e, f
        [this.a, this.b, this.c, this.d, this.e, this.f] = [
          values[0], values[1], values[4], values[5], values[12], values[13],
        ];
        return;
      }

      throw new TypeError(`DOMMatrix: sequência com ${values.length} elementos (esperado 6 ou 16).`);
    }

    if (isMatrixLike(init)) {
      ({ a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f } = init);
      return;
    }

    throw new TypeError("DOMMatrix: inicializador não reconhecido.");
  }

  // --- Aliases m11..m44 exigidos pela especificação -------------------
  get m11() { return this.a; }
  set m11(v: number) { this.a = v; }
  get m12() { return this.b; }
  set m12(v: number) { this.b = v; }
  get m21() { return this.c; }
  set m21(v: number) { this.c = v; }
  get m22() { return this.d; }
  set m22(v: number) { this.d = v; }
  get m41() { return this.e; }
  set m41(v: number) { this.e = v; }
  get m42() { return this.f; }
  set m42(v: number) { this.f = v; }
  get m13() { return 0; }
  get m14() { return 0; }
  get m23() { return 0; }
  get m24() { return 0; }
  get m31() { return 0; }
  get m32() { return 0; }
  get m33() { return 1; }
  get m34() { return 0; }
  get m43() { return 0; }
  get m44() { return 1; }

  get is2D() { return true; }

  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  private clone(): DomMatrix2DPolyfill {
    return new DomMatrix2DPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  private setFrom(m: Matrix2DLike): this {
    this.a = m.a; this.b = m.b; this.c = m.c; this.d = m.d; this.e = m.e; this.f = m.f;
    return this;
  }

  /** this = left × right, na convenção de coluna. */
  private static compose(left: Matrix2DLike, right: Matrix2DLike): Matrix2DLike {
    return {
      a: left.a * right.a + left.c * right.b,
      b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d,
      d: left.b * right.c + left.d * right.d,
      e: left.a * right.e + left.c * right.f + left.e,
      f: left.b * right.e + left.d * right.f + left.f,
    };
  }

  multiply(other: unknown): DomMatrix2DPolyfill {
    return this.clone().multiplySelf(other);
  }

  multiplySelf(other: unknown): this {
    const right = other instanceof DomMatrix2DPolyfill ? other : new DomMatrix2DPolyfill(other);
    return this.setFrom(DomMatrix2DPolyfill.compose(this, right));
  }

  preMultiplySelf(other: unknown): this {
    const left = other instanceof DomMatrix2DPolyfill ? other : new DomMatrix2DPolyfill(other);
    return this.setFrom(DomMatrix2DPolyfill.compose(left, this));
  }

  translate(tx = 0, ty = 0): DomMatrix2DPolyfill {
    return this.clone().translateSelf(tx, ty);
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
  }

  // `sz` existe na assinatura da spec (escala em Z) e e ignorado de
  // proposito: esta implementacao e 2D e declara isso.
  scale(sx = 1, sy?: number, sz = 1, ox = 0, oy = 0): DomMatrix2DPolyfill {
    return this.clone().scaleSelf(sx, sy, sz, ox, oy);
  }

  scaleSelf(sx = 1, sy?: number, sz = 1, ox = 0, oy = 0): this {
    void sz;
    const scaleY = sy === undefined ? sx : sy;
    if (ox !== 0 || oy !== 0) this.translateSelf(ox, oy);
    this.multiplySelf({ a: sx, b: 0, c: 0, d: scaleY, e: 0, f: 0 });
    if (ox !== 0 || oy !== 0) this.translateSelf(-ox, -oy);
    return this;
  }

  scaleNonUniform(sx = 1, sy = 1): DomMatrix2DPolyfill {
    return this.scale(sx, sy);
  }

  rotate(deg = 0): DomMatrix2DPolyfill {
    return this.clone().rotateSelf(deg);
  }

  rotateSelf(deg = 0): this {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return this.multiplySelf({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }

  skewX(deg = 0): DomMatrix2DPolyfill {
    return this.clone().skewXSelf(deg);
  }

  skewXSelf(deg = 0): this {
    return this.multiplySelf({ a: 1, b: 0, c: Math.tan((deg * Math.PI) / 180), d: 1, e: 0, f: 0 });
  }

  skewY(deg = 0): DomMatrix2DPolyfill {
    return this.clone().skewYSelf(deg);
  }

  skewYSelf(deg = 0): this {
    return this.multiplySelf({ a: 1, b: Math.tan((deg * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 });
  }

  flipX(): DomMatrix2DPolyfill {
    return this.multiply({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  }

  flipY(): DomMatrix2DPolyfill {
    return this.multiply({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 });
  }

  inverse(): DomMatrix2DPolyfill {
    return this.clone().invertSelf();
  }

  /** Não inversível vira NaN em todos os componentes, como manda a spec. */
  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;

    if (det === 0 || !Number.isFinite(det)) {
      this.a = this.b = this.c = this.d = this.e = this.f = Number.NaN;
      return this;
    }

    const { a, b, c, d, e, f } = this;
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }

  transformPoint(point: { x?: number; y?: number; z?: number; w?: number } = {}) {
    const x = point.x ?? 0;
    const y = point.y ?? 0;
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: 0,
      w: point.w ?? 1,
    };
  }

  toFloat32Array(): Float32Array {
    return Float32Array.from(this.to16());
  }

  toFloat64Array(): Float64Array {
    return Float64Array.from(this.to16());
  }

  private to16(): number[] {
    return [this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1];
  }

  toString(): string {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }

  static fromMatrix(init?: unknown): DomMatrix2DPolyfill {
    return new DomMatrix2DPolyfill(init);
  }

  static fromFloat32Array(array: Float32Array): DomMatrix2DPolyfill {
    return new DomMatrix2DPolyfill(array);
  }

  static fromFloat64Array(array: Float64Array): DomMatrix2DPolyfill {
    return new DomMatrix2DPolyfill(array);
  }
}

/**
 * Path2D existe só para rasterização — que este runtime não faz. Todo
 * método lança: falha alta é preferível a um recorte silenciosamente
 * errado num documento contratual. Ver a fronteira declarada no topo.
 */
export class Path2DUnsupported {
  addPath(): never { throw new PdfRenderingNotSupportedError("Path2D.addPath"); }
  closePath(): never { throw new PdfRenderingNotSupportedError("Path2D.closePath"); }
  moveTo(): never { throw new PdfRenderingNotSupportedError("Path2D.moveTo"); }
  lineTo(): never { throw new PdfRenderingNotSupportedError("Path2D.lineTo"); }
  bezierCurveTo(): never { throw new PdfRenderingNotSupportedError("Path2D.bezierCurveTo"); }
  quadraticCurveTo(): never { throw new PdfRenderingNotSupportedError("Path2D.quadraticCurveTo"); }
  arc(): never { throw new PdfRenderingNotSupportedError("Path2D.arc"); }
  arcTo(): never { throw new PdfRenderingNotSupportedError("Path2D.arcTo"); }
  ellipse(): never { throw new PdfRenderingNotSupportedError("Path2D.ellipse"); }
  rect(): never { throw new PdfRenderingNotSupportedError("Path2D.rect"); }
}

export interface PdfGlobalsInstallResult {
  domMatrix: "nativo" | "polyfill";
  path2D: "nativo" | "polyfill";
}

let installResult: PdfGlobalsInstallResult | null = null;

/**
 * Instala os globais ANTES de qualquer import do pdfjs.
 *
 * Idempotente e não destrutivo: uma implementação nativa (ou já
 * instalada por outro componente) NUNCA é substituída — só preenchemos o
 * que está ausente. Como a função é síncrona e o resultado é memoizado,
 * duas requisições concorrentes não disputam o global: a primeira
 * instala, a segunda encontra pronto.
 */
export function installPdfGlobals(): PdfGlobalsInstallResult {
  if (installResult) return installResult;

  const globals = globalThis as Record<string, unknown>;

  const domMatrix = globals.DOMMatrix === undefined ? "polyfill" : "nativo";
  if (domMatrix === "polyfill") globals.DOMMatrix = DomMatrix2DPolyfill;

  const path2D = globals.Path2D === undefined ? "polyfill" : "nativo";
  if (path2D === "polyfill") globals.Path2D = Path2DUnsupported;

  installResult = { domMatrix, path2D };
  return installResult;
}

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * Carrega o pdfjs uma única vez por processo, com os globais já
 * instalados. A promessa é memoizada: requisições concorrentes
 * compartilham o mesmo carregamento, em vez de correrem para instalar
 * global e avaliar o módulo ao mesmo tempo.
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  if (pdfjsPromise) return pdfjsPromise;

  const result = installPdfGlobals();
  if (result.domMatrix === "polyfill") {
    console.info(`${LOG_PREFIX} DOMMatrix/Path2D via polyfill interno (sem @napi-rs/canvas).`);
  }

  pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch((error) => {
    // Falha no carregamento não pode envenenar o cache: a próxima
    // requisição tenta de novo.
    pdfjsPromise = null;
    throw error;
  });

  return pdfjsPromise;
}

let cachedStandardFontDataUrl: string | null | undefined;

/**
 * Diretório das fontes padrão (base-14) do pdfjs, necessário quando o PDF
 * não embute a fonte — caso comum em minuta gerada por Word/Google Docs.
 *
 * Resolução ESTÁTICA do pacote: o especificador é literal, então o
 * @vercel/nft rastreia. Os .pfb são lidos em runtime pelo próprio pdfjs,
 * por isso a inclusão dos arquivos é declarada em next.config.ts.
 */
export function resolveStandardFontDataUrl(): string | null {
  if (cachedStandardFontDataUrl !== undefined) return cachedStandardFontDataUrl;

  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve("pdfjs-dist/package.json");
    const fontsDir = path.join(path.dirname(packageJson), "standard_fonts");

    // O pdfjs valida a URL da factory e exige barra final "/", nunca
    // path.sep (no Windows a barra invertida é recusada).
    cachedStandardFontDataUrl = `${fontsDir.split(path.sep).join("/")}/`;
    return cachedStandardFontDataUrl;
  } catch (error) {
    console.warn(
      `${LOG_PREFIX} standard_fonts do pdfjs não encontrado — PDFs sem fonte embutida podem degradar:`,
      error instanceof Error ? error.message : String(error)
    );
    cachedStandardFontDataUrl = null;
    return null;
  }
}

/** Só para teste: zera a memoização entre cenários. */
export function __resetPdfRuntimeForTests(): void {
  installResult = null;
  pdfjsPromise = null;
  cachedStandardFontDataUrl = undefined;
}
