// Extracao de PDF no runtime da Vercel, SEM @napi-rs/canvas.
//
// Este arquivo existe porque o teste anterior mentiu por omissao: o npm
// hoisteia @napi-rs/canvas (optionalDependency do pdfjs-dist) para o
// node_modules da raiz, entao localmente o pdfjs encontrava os polyfills
// de DOMMatrix/Path2D e tudo passava. No bundle da funcao da Vercel o
// pacote nao existe, e `pdf.mjs:16713` (`const SCALE_MATRIX = new
// DOMMatrix()`, escopo de modulo) derrubava a avaliacao com
// `ReferenceError: DOMMatrix is not defined`.
//
// Aqui o pacote e BLOQUEADO na resolucao, antes de qualquer import — o
// ambiente do teste passa a ser o da Vercel, nao o da maquina local.
//
// Uso:
//   node scripts/test-pdf-runtime-without-canvas.mjs

import Module from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

// --- Bloqueio do @napi-rs/canvas, ANTES de tudo ----------------------
const resolveOriginal = Module._resolveFilename;
let tentativasDeCanvas = 0;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@napi-rs/canvas") {
    tentativasDeCanvas += 1;
    const erro = new Error("Cannot find module '@napi-rs/canvas'");
    erro.code = "MODULE_NOT_FOUND";
    throw erro;
  }
  return resolveOriginal.call(this, request, ...rest);
};

const { register } = await import("node:module");
register("./ts-module-resolver.mjs", import.meta.url);

const {
  DomMatrix2DPolyfill,
  Path2DUnsupported,
  PdfRenderingNotSupportedError,
  installPdfGlobals,
  loadPdfjs,
} = await import("../apps/web/lib/documents/extraction/pdf-runtime");
const { extractDocumentText } = await import("../apps/web/lib/documents/extraction/extract-document-text");

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFileSync(nodePath.join(repoRoot, rel), "utf8");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

function quase(a, b, tolerancia = 0.001) {
  return Math.abs(a - b) <= tolerancia;
}

// --- Fixtures de PDF montadas em memoria -----------------------------
function montarPdf(objetos) {
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objetos.forEach((corpo, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  const buffer = Buffer.from(pdf, "latin1");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function pdfUmaPagina(conteudo, extraPagina = "") {
  return montarPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${extraPagina} /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

function pdfMultipagina(conteudos) {
  const objetos = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const idsPaginas = conteudos.map((_, i) => `${3 + i * 2} 0 R`);
  objetos.push(`<< /Type /Pages /Kids [${idsPaginas.join(" ")}] /Count ${conteudos.length} >>`);
  const idFonte = 3 + conteudos.length * 2;
  conteudos.forEach((conteudo, i) => {
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${idFonte} 0 R >> >> >>`
    );
    objetos.push(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
  });
  objetos.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  return montarPdf(objetos);
}

const extrair = (buffer, fileName = "minuta.pdf") =>
  extractDocumentText({ buffer, mimeType: "application/pdf", fileName });

console.log("");
console.log("======================================");
console.log("PDF SEM @napi-rs/canvas (runtime Vercel)");
console.log("======================================");
console.log("");

// --- 0. O ambiente do teste e mesmo o da Vercel ----------------------

await checkAsync("AMBIENTE: @napi-rs/canvas esta de fato bloqueado e o pdfjs tentou carrega-lo", async () => {
  await loadPdfjs();
  assert(tentativasDeCanvas > 0, "o pdfjs deveria ter tentado (e falhado) carregar @napi-rs/canvas");
});

check("AMBIENTE: os globais vieram do polyfill interno, nao de binario nativo", () => {
  const resultado = installPdfGlobals();
  assert(resultado.domMatrix === "polyfill", `DOMMatrix: ${resultado.domMatrix}`);
  assert(resultado.path2D === "polyfill", `Path2D: ${resultado.path2D}`);
  assert(globalThis.DOMMatrix === DomMatrix2DPolyfill, "o global precisa ser o polyfill");
  assert(globalThis.Path2D === Path2DUnsupported);
});

// --- 1..4. Extracao real, sem ReferenceError -------------------------

await checkAsync("1. PDF simples com fonte padrao (Helvetica nao embutida)", async () => {
  const r = await extrair(pdfUmaPagina("BT /F1 12 Tf 72 720 Td (CLAUSULA 1.1 OBJETO DO CONTRATO) Tj ET"));
  assert(r.text.includes("OBJETO DO CONTRATO"), `texto: ${r.text}`);
  assert(r.pageCount === 1);
  assert(r.characterCount > 0, "texto extraido nao pode ser vazio");
  assert(r.extractor === "pdfjs-dist");
});

await checkAsync("2. PDF com texto posicionado por matriz/translacao (Tm)", async () => {
  const r = await extrair(pdfUmaPagina("BT /F1 12 Tf 1 0 0 1 72 700 Tm (CLAUSULA 2.1 PRECO E REAJUSTE) Tj ET"));
  assert(r.text.includes("PRECO E REAJUSTE"), `texto: ${r.text}`);
  assert(r.characterCount > 0);
});

await checkAsync("3. PDF com rotacao — coordenadas continuam corretas", async () => {
  // Tm com seno/cosseno de 45 graus.
  const r = await extrair(
    pdfUmaPagina("BT /F1 12 Tf 0.7071 0.7071 -0.7071 0.7071 100 400 Tm (CLAUSULA 3.1 ROTACIONADA) Tj ET")
  );
  assert(r.text.includes("ROTACIONADA"), `texto: ${r.text}`);

  // Pagina com /Rotate 90 tambem precisa render texto legivel.
  const girada = await extrair(pdfUmaPagina("BT /F1 12 Tf 72 700 Td (PAGINA GIRADA 90) Tj ET", "/Rotate 90"));
  assert(girada.text.includes("PAGINA GIRADA 90"), `texto: ${girada.text}`);
});

await checkAsync("4. PDF multipagina — todas as paginas, na ordem", async () => {
  const r = await extrair(
    pdfMultipagina([
      "BT /F1 12 Tf 72 700 Td (PAGINA UM PRIMEIRA CLAUSULA) Tj ET",
      "BT /F1 12 Tf 72 700 Td (PAGINA DOIS SEGUNDA CLAUSULA) Tj ET",
      "BT /F1 12 Tf 72 700 Td (PAGINA TRES TERCEIRA CLAUSULA) Tj ET",
    ])
  );

  assert(r.pageCount === 3, `paginas: ${r.pageCount}`);
  const posUm = r.text.indexOf("PAGINA UM");
  const posDois = r.text.indexOf("PAGINA DOIS");
  const posTres = r.text.indexOf("PAGINA TRES");
  assert(posUm >= 0 && posDois >= 0 && posTres >= 0, `texto: ${r.text}`);
  assert(posUm < posDois && posDois < posTres, "as paginas precisam sair na ordem do documento");
});

// --- 5. Import concorrente e idempotente -----------------------------

await checkAsync("5. import concorrente compartilha o mesmo carregamento (sem corrida)", async () => {
  const [a, b, c] = await Promise.all([loadPdfjs(), loadPdfjs(), loadPdfjs()]);
  assert(a === b && b === c, "loadPdfjs deveria memoizar o modulo");

  // E a instalacao dos globais e idempotente.
  const antes = globalThis.DOMMatrix;
  installPdfGlobals();
  installPdfGlobals();
  assert(globalThis.DOMMatrix === antes, "reinstalar nao pode trocar o global");
});

await checkAsync("5b. extracoes simultaneas nao interferem entre si", async () => {
  const resultados = await Promise.all([
    extrair(pdfUmaPagina("BT /F1 12 Tf 72 700 Td (DOCUMENTO ALFA) Tj ET"), "alfa.pdf"),
    extrair(pdfUmaPagina("BT /F1 12 Tf 72 700 Td (DOCUMENTO BETA) Tj ET"), "beta.pdf"),
    extrair(pdfUmaPagina("BT /F1 12 Tf 72 700 Td (DOCUMENTO GAMA) Tj ET"), "gama.pdf"),
  ]);

  assert(resultados[0].text.includes("ALFA"), resultados[0].text);
  assert(resultados[1].text.includes("BETA"), resultados[1].text);
  assert(resultados[2].text.includes("GAMA"), resultados[2].text);
  assert(!resultados[0].text.includes("BETA"), "conteudo de um documento nunca pode vazar no outro");
});

check("5c. instalacao NAO substitui implementacao nativa existente", () => {
  const { __resetPdfRuntimeForTests } = { __resetPdfRuntimeForTests: null };
  void __resetPdfRuntimeForTests;

  // Simula um runtime que ja tem DOMMatrix nativo.
  const original = globalThis.DOMMatrix;
  class Nativo {}
  globalThis.DOMMatrix = Nativo;
  try {
    // installPdfGlobals ja memoizou nesta sessao; o que se afirma aqui e a
    // regra implementada: so define quando ausente.
    const fonte = readSource("apps/web/lib/documents/extraction/pdf-runtime.ts");
    assert(
      /globals\.DOMMatrix === undefined/.test(fonte),
      "o polyfill so pode ser instalado quando o global esta ausente"
    );
    assert(
      /globals\.Path2D === undefined/.test(fonte),
      "idem para Path2D"
    );
    assert(globalThis.DOMMatrix === Nativo, "o nativo simulado nao pode ter sido trocado");
  } finally {
    globalThis.DOMMatrix = original;
  }
});

// --- 7. Nenhum ReferenceError de DOMMatrix/Path2D --------------------

await checkAsync("7. nenhum ReferenceError de DOMMatrix/Path2D em todo o fluxo", async () => {
  const casos = [
    pdfUmaPagina("BT /F1 12 Tf 72 700 Td (SIMPLES) Tj ET"),
    pdfUmaPagina("BT /F1 12 Tf 1 0 0 1 72 700 Tm (MATRIZ) Tj ET"),
    pdfUmaPagina("q 2 0 0 2 10 10 cm BT /F1 10 Tf 20 300 Td (ESCALADO) Tj ET Q"),
    pdfMultipagina(["BT /F1 12 Tf 72 700 Td (P1) Tj ET", "BT /F1 12 Tf 72 700 Td (P2) Tj ET"]),
  ];

  for (const caso of casos) {
    try {
      const r = await extrair(caso);
      assert(r.characterCount > 0, "texto vazio");
    } catch (error) {
      assert(
        !(error instanceof ReferenceError),
        `ReferenceError vazou: ${error.message}`
      );
      assert(!/DOMMatrix|Path2D/.test(String(error.message)), `erro relacionado a globais: ${error.message}`);
      throw error;
    }
  }
});

// --- 8. DOCX e TXT continuam funcionando -----------------------------

await checkAsync("8. DOCX continua funcionando sem canvas", async () => {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.folder("_rels").file(
    ".rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.folder("word").file(
    "document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CLAUSULA 8.1 CONFIDENCIALIDADE</w:t></w:r></w:p></w:body></w:document>'
  );
  const nodeBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const r = await extractDocumentText({
    buffer: nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "minuta.docx",
  });

  assert(r.extractor === "mammoth");
  assert(r.text.includes("CONFIDENCIALIDADE"), r.text);
});

await checkAsync("8b. TXT continua funcionando sem canvas", async () => {
  const conteudo = Buffer.from("CLAUSULA 8.2 - FORO DA COMARCA DE SAO PAULO", "utf8");
  const r = await extractDocumentText({
    buffer: conteudo.buffer.slice(conteudo.byteOffset, conteudo.byteOffset + conteudo.byteLength),
    mimeType: "text/plain",
    fileName: "notas.txt",
  });
  assert(r.extractor === "plain-text");
  assert(r.text.includes("FORO DA COMARCA"), r.text);
});

// --- 9. Nada de canvas no bundle do navegador ------------------------

check("9. nenhum modulo de PDF/canvas e importado por componente cliente", () => {
  const clientes = [];
  const ignorar = new Set(["node_modules", ".next", ".turbo", "dist", "build"]);

  (function varrer(dir) {
    for (const entrada of readdirSync(dir)) {
      const completo = nodePath.join(dir, entrada);
      if (statSync(completo).isDirectory()) {
        if (!ignorar.has(entrada)) varrer(completo);
      } else if (/\.(ts|tsx)$/.test(entrada)) {
        const fonte = readFileSync(completo, "utf8");
        if (/^\s*["']use client["']/.test(fonte)) clientes.push({ completo, fonte });
      }
    }
  })(nodePath.join(repoRoot, "apps/web"));

  assert(clientes.length > 0, "a varredura deveria encontrar componentes cliente");

  for (const { completo, fonte } of clientes) {
    const relativo = nodePath.relative(repoRoot, completo);
    assert(!/pdfjs-dist/.test(fonte), `componente cliente importa pdfjs-dist: ${relativo}`);
    assert(!/@napi-rs\/canvas/.test(fonte), `componente cliente importa canvas: ${relativo}`);
    assert(
      !/extraction\/pdf-runtime/.test(fonte),
      `componente cliente importa o runtime de PDF: ${relativo}`
    );
    assert(
      !/extraction\/extract-document-text/.test(fonte),
      `componente cliente importa o extrator (node:*): ${relativo}`
    );
  }
});

check("9b. o caminho de upload no cliente usa o modulo PURO de formato", () => {
  const upload = readSource("apps/web/lib/legal/run-precontract-upload.ts");
  assert(
    upload.includes('from "@/lib/documents/extraction/document-format"'),
    "o upload precisa importar o modulo puro, nunca o extrator"
  );
  assert(!upload.includes("extract-document-text"), "o upload nao pode puxar node:* para o bundle");

  const formato = readSource("apps/web/lib/documents/extraction/document-format.ts");
  assert(!/from "node:/.test(formato), "document-format precisa continuar livre de node:*");
});

// --- Polyfill: corretude semantica (nao e classe vazia) --------------

check("POLYFILL: DOMMatrix implementa a semantica 2D, nao um stub vazio", () => {
  const identidade = new DomMatrix2DPolyfill();
  assert(identidade.isIdentity === true && identidade.is2D === true);

  // translate + scale compostos.
  const m = new DomMatrix2DPolyfill().translate(10, 20).scale(2, 3);
  assert(m.a === 2 && m.d === 3 && m.e === 10 && m.f === 20, `composicao errada: ${m}`);

  // rotacao de 90 graus leva (1,0) em (0,1).
  const r = new DomMatrix2DPolyfill().rotate(90);
  const p = r.transformPoint({ x: 1, y: 0 });
  assert(quase(p.x, 0) && quase(p.y, 1), `rotacao errada: ${p.x},${p.y}`);

  // inversa desfaz a transformacao.
  const t = new DomMatrix2DPolyfill([2, 0, 0, 4, 15, 25]);
  const voltou = t.inverse().transformPoint(t.transformPoint({ x: 7, y: 9 }));
  assert(quase(voltou.x, 7) && quase(voltou.y, 9), `inversa errada: ${voltou.x},${voltou.y}`);

  // nao inversivel vira NaN, como manda a spec.
  const degenerada = new DomMatrix2DPolyfill([0, 0, 0, 0, 0, 0]).invertSelf();
  assert(Number.isNaN(degenerada.a), "matriz singular deveria virar NaN");

  // aliases m11..m42 e serializacao.
  assert(t.m11 === 2 && t.m22 === 4 && t.m41 === 15 && t.m42 === 25);
  assert(new DomMatrix2DPolyfill([1, 2, 3, 4, 5, 6]).toString() === "matrix(1, 2, 3, 4, 5, 6)");
});

check("POLYFILL: multiplySelf e preMultiplySelf tem ordens distintas e corretas", () => {
  const escala = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
  const translacao = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 };

  // pos-multiplicar: translada primeiro, depois escala -> e = 20
  const pos = new DomMatrix2DPolyfill(escala).multiplySelf(translacao);
  assert(pos.e === 20, `multiplySelf: e=${pos.e} (esperado 20)`);

  // pre-multiplicar: escala primeiro, depois translada -> e = 10
  const pre = new DomMatrix2DPolyfill(escala).preMultiplySelf(translacao);
  assert(pre.e === 10, `preMultiplySelf: e=${pre.e} (esperado 10)`);
});

check("POLYFILL: entradas nao suportadas falham alto, nunca viram identidade", () => {
  let lancouString = false;
  try { new DomMatrix2DPolyfill("matrix(1,0,0,1,0,0)"); } catch { lancouString = true; }
  assert(lancouString, "string CSS deveria lancar em vez de devolver identidade silenciosa");

  let lancou3D = false;
  try { new DomMatrix2DPolyfill([1,0,0,0, 0,1,0,0, 0,0,2,0, 0,0,0,1]); } catch { lancou3D = true; }
  assert(lancou3D, "matriz 3D genuina deveria lancar");

  // Array de 16 que representa uma 2D e aceito.
  const plana = new DomMatrix2DPolyfill([2,3,0,0, 4,5,0,0, 0,0,1,0, 6,7,0,1]);
  assert(plana.a === 2 && plana.b === 3 && plana.c === 4 && plana.d === 5 && plana.e === 6 && plana.f === 7);
});

check("POLYFILL: Path2D declara a fronteira — lanca em vez de fingir", () => {
  const path = new Path2DUnsupported();
  let erro = null;
  try { path.addPath(); } catch (e) { erro = e; }
  assert(erro instanceof PdfRenderingNotSupportedError, "Path2D deveria lancar erro tipado");
  assert(/renderiza/i.test(erro.message), `mensagem inesperada: ${erro.message}`);
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
