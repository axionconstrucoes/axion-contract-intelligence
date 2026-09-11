// Teste do ARTEFATO DE BUILD — a única verificação capaz de enxergar o
// empacotamento de produção.
//
// Três falhas seguidas no Preview passaram por testes verdes em Node
// puro, porque Node puro não tem bundler: o ambiente do teste concordava
// com a suposição do código em vez de reproduzir a Vercel.
//
//   1ª falha: coluna storage_path inexistente   (stub espelhava o erro)
//   2ª falha: DOMMatrix                          (@napi-rs/canvas hoisteado)
//   3ª falha: "Setting up fake worker failed"    (Turbopack empacotou o pdfjs)
//
// Esta suíte examina o que `npm run build` REALMENTE produziu:
// .next/server/chunks/ssr e os .nft.json (a lista de arquivos que a
// Vercel copia para a função).
//
// Uso (exige `npm run build` antes):
//   node scripts/test-pdf-build-artifact.mjs

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import nodePath from "node:path";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = nodePath.join(repoRoot, "apps/web/.next");
const ssrChunksDir = nodePath.join(nextDir, "server/chunks/ssr");

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

function listarArquivos(dir, filtro) {
  const encontrados = [];
  if (!existsSync(dir)) return encontrados;

  (function varrer(atual) {
    for (const entrada of readdirSync(atual)) {
      const completo = nodePath.join(atual, entrada);
      if (statSync(completo).isDirectory()) varrer(completo);
      else if (filtro(entrada, completo)) encontrados.push(completo);
    }
  })(dir);

  return encontrados;
}

console.log("");
console.log("======================================");
console.log("ARTEFATO DE BUILD — pdfjs no runtime");
console.log("======================================");
console.log("");

check("PRE-REQUISITO: o build existe (rode `npm run build` antes)", () => {
  assert(existsSync(nextDir), `.next não encontrado em ${nextDir}`);
  assert(existsSync(ssrChunksDir), `chunks SSR não encontrados em ${ssrChunksDir}`);
});

// --- 1. pdfjs não pode estar EMPACOTADO em chunk SSR -----------------

check("1. pdfjs-dist não está empacotado em chunk SSR do Turbopack", () => {
  const candidatos = readdirSync(ssrChunksDir).filter(
    (nome) => nome.includes("pdfjs-dist") && nome.endsWith(".js")
  );

  for (const nome of candidatos) {
    const completo = nodePath.join(ssrChunksDir, nome);
    const conteudo = readFileSync(completo, "utf8");
    const tamanho = statSync(completo).size;

    // Um chunk de externalização é um stub de algumas centenas de bytes.
    // O pdf.mjs empacotado passa de 1 MB e carrega marcadores próprios.
    const marcadores = ["SCALE_MATRIX", "Setting up fake worker", "GlobalWorkerOptions"];
    const encontrados = marcadores.filter((marcador) => conteudo.includes(marcador));

    assert(
      encontrados.length === 0,
      `chunk "${nome}" contém o código do pdfjs (marcadores: ${encontrados.join(", ")}) — ` +
        "serverExternalPackages não está em efeito"
    );
    assert(
      tamanho < 50_000,
      `chunk "${nome}" tem ${tamanho} bytes — grande demais para um stub de externalização`
    );
    assert(
      nome.startsWith("[externals]"),
      `chunk "${nome}" deveria ser um stub [externals] quando o pacote é externo`
    );
  }

  assert(candidatos.length > 0, "nenhuma referência a pdfjs no build — a rota jurídica não foi compilada?");
});

// --- 2 e 3. Worker e fontes precisam ir para a função ----------------

const nftFiles = listarArquivos(nodePath.join(nextDir, "server"), (nome) => nome.endsWith(".nft.json"));

check("2. os .nft.json incluem pdf.worker.mjs (o worker vai para a função)", () => {
  assert(nftFiles.length > 0, "nenhum .nft.json encontrado");

  const comWorker = nftFiles.filter((arquivo) => {
    const dados = JSON.parse(readFileSync(arquivo, "utf8"));
    return (dados.files ?? []).some((f) => f.includes("pdf.worker.mjs"));
  });

  assert(
    comWorker.length > 0,
    `nenhum dos ${nftFiles.length} .nft.json inclui pdf.worker.mjs — ` +
      "o import dinâmico do worker vai falhar em runtime com 'Cannot find module'"
  );
});

check("3. os .nft.json incluem standard_fonts", () => {
  const comFontes = nftFiles.filter((arquivo) => {
    const dados = JSON.parse(readFileSync(arquivo, "utf8"));
    return (dados.files ?? []).some((f) => f.includes("standard_fonts"));
  });

  assert(
    comFontes.length > 0,
    `nenhum dos ${nftFiles.length} .nft.json inclui standard_fonts — ` +
      "PDFs sem fonte embutida vão degradar"
  );
});

// --- 4 a 7. Resolução em runtime ------------------------------------

const { resolvePdfAssets, PdfAssetsUnavailableError } = await import(
  "../apps/web/lib/documents/extraction/pdf-assets"
);
const { resolveStandardFontDataUrl, loadPdfjs } = await import(
  "../apps/web/lib/documents/extraction/pdf-runtime"
);

check("4. workerSrc é uma URL file://", () => {
  const assets = resolvePdfAssets();
  assert(typeof assets.workerSrc === "string", `workerSrc é ${typeof assets.workerSrc}`);
  assert(assets.workerSrc.startsWith("file://"), `workerSrc não é URL de arquivo: ${assets.workerSrc}`);
  // Um caminho absoluto cru seria ambíguo para o import dinâmico do Node.
  assert(!/^[A-Za-z]:\\/.test(assets.workerSrc), "workerSrc não pode ser caminho absoluto do Windows");
});

check("5. fileURLToPath(workerSrc) aponta para arquivo existente", () => {
  const assets = resolvePdfAssets();
  const caminho = fileURLToPath(assets.workerSrc);

  assert(existsSync(caminho), `worker não existe em: ${caminho}`);
  assert(statSync(caminho).size > 100_000, "o worker do pdfjs deveria ter mais de 100 KB");
  assert(caminho === assets.workerPath, "workerPath e workerSrc precisam apontar para o mesmo arquivo");
  assert(pathToFileURL(caminho).href === assets.workerSrc, "a conversão precisa ser reversível");
});

check("6. resolveStandardFontDataUrl retorna string terminada em /", () => {
  const url = resolveStandardFontDataUrl();
  assert(typeof url === "string", `retornou ${typeof url} — sintoma de require.resolve reescrito pelo bundler`);
  assert(url.endsWith("/"), `sem barra final: ${url}`);
  assert(!url.includes("\\"), "o pdfjs recusa barra invertida na URL da factory");
});

check("7. o diretório de fontes existe e tem as fontes base-14", () => {
  const url = resolveStandardFontDataUrl();
  const dir = url.slice(0, -1);

  assert(existsSync(dir), `diretório de fontes não existe: ${dir}`);

  // O pdfjs cobre as base-14 com 10 Foxit (.pfb) + 4 Liberation (.ttf).
  const arquivos = readdirSync(dir);
  const pfb = arquivos.filter((nome) => nome.endsWith(".pfb"));
  const ttf = arquivos.filter((nome) => nome.endsWith(".ttf"));

  assert(pfb.length >= 10, `esperado ao menos 10 fontes .pfb, encontrado ${pfb.length}`);
  assert(ttf.length >= 4, `esperado ao menos 4 fontes .ttf, encontrado ${ttf.length}`);
  // Helvetica sem embutir cai na Foxit Sans — a que o caso real usa.
  assert(arquivos.includes("FoxitFixed.pfb"), "a fonte âncora da resolução precisa existir");
});

// --- 8. Nenhum require.resolve sujeito ao bundler --------------------

check("8. nenhum require.resolve sujeito ao bundler permanece neste caminho", () => {
  const alvos = [
    "apps/web/lib/documents/extraction/pdf-assets.ts",
    "apps/web/lib/documents/extraction/pdf-runtime.ts",
    "apps/web/lib/documents/extraction/extract-document-text.ts",
  ];

  for (const relativo of alvos) {
    const fonte = readFileSync(nodePath.join(repoRoot, relativo), "utf8");
    const linhasDeCodigo = fonte
      .split("\n")
      .filter((linha) => !linha.trimStart().startsWith("//") && !linha.trimStart().startsWith("*"));
    const codigo = linhasDeCodigo.join("\n");

    assert(
      !/import\s*\{[^}]*createRequire[^}]*\}\s*from\s*["']node:module["']/.test(codigo),
      `${relativo} importa createRequire de node:module — o bundler reescreve; use process.getBuiltinModule`
    );
  }

  const assets = readFileSync(
    nodePath.join(repoRoot, "apps/web/lib/documents/extraction/pdf-assets.ts"),
    "utf8"
  );
  assert(
    assets.includes('process.getBuiltinModule("module")'),
    "pdf-assets precisa resolver via process.getBuiltinModule (opaco ao bundler)"
  );
});

check("8b. next.config declara pdfjs-dist como pacote externo do servidor", () => {
  const config = readFileSync(nodePath.join(repoRoot, "apps/web/next.config.ts"), "utf8");
  assert(/serverExternalPackages:\s*\[[^\]]*"pdfjs-dist"/.test(config), "faltou serverExternalPackages");
  assert(config.includes("pdf.worker.mjs"), "o worker precisa estar em outputFileTracingIncludes");
  assert(config.includes("standard_fonts"), "as fontes precisam estar em outputFileTracingIncludes");
});

// --- 9. Nada de pdfjs no bundle do NAVEGADOR -------------------------

check("9. pdfjs não entra no bundle do navegador", () => {
  const estaticos = nodePath.join(nextDir, "static");
  const jsCliente = listarArquivos(estaticos, (nome) => nome.endsWith(".js"));

  assert(jsCliente.length > 0, "nenhum JS de cliente encontrado no build");

  for (const arquivo of jsCliente) {
    const conteudo = readFileSync(arquivo, "utf8");
    for (const marcador of ["Setting up fake worker", "SCALE_MATRIX", "@napi-rs/canvas"]) {
      assert(
        !conteudo.includes(marcador),
        `"${marcador}" apareceu no bundle do navegador: ${nodePath.relative(nextDir, arquivo)}`
      );
    }
  }
});

// --- 10. DOCX e TXT continuam funcionando ----------------------------

const { extractDocumentText } = await import("../apps/web/lib/documents/extraction/extract-document-text");

await checkAsync("10. DOCX continua funcionando", async () => {
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
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CLAUSULA 10.1 VIGENCIA</w:t></w:r></w:p></w:body></w:document>'
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });

  const r = await extractDocumentText({
    buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "minuta.docx",
  });
  assert(r.extractor === "mammoth" && r.text.includes("VIGENCIA"), r.text);
});

await checkAsync("10b. TXT continua funcionando", async () => {
  const buf = Buffer.from("CLAUSULA 10.2 RESCISAO ANTECIPADA", "utf8");
  const r = await extractDocumentText({
    buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    mimeType: "text/plain",
    fileName: "notas.txt",
  });
  assert(r.extractor === "plain-text" && r.text.includes("RESCISAO"), r.text);
});

// --- Falha explícita quando os assets somem --------------------------

check("FAIL-CLOSED: assets ausentes produzem erro técnico claro, não análise parcial", () => {
  assert(typeof PdfAssetsUnavailableError === "function", "o erro tipado precisa existir");
  const erro = new PdfAssetsUnavailableError("worker ausente");
  assert(erro.name === "PdfAssetsUnavailableError");
  assert(erro.detail === "worker ausente");

  const fonte = readFileSync(
    nodePath.join(repoRoot, "apps/web/lib/documents/extraction/pdf-assets.ts"),
    "utf8"
  );
  // Resolução que devolve número (bundler) tem de ser detectada e lançar.
  assert(
    /typeof workerPath !== "string"/.test(fonte) && /typeof fontAnchorPath !== "string"/.test(fonte),
    "o caso 'require.resolve devolveu id numérico' precisa ser detectado explicitamente"
  );
});

await checkAsync("WORKER: loadPdfjs configura GlobalWorkerOptions.workerSrc com a URL de arquivo", async () => {
  const pdfjs = await loadPdfjs();
  const assets = resolvePdfAssets();

  assert(
    pdfjs.GlobalWorkerOptions.workerSrc === assets.workerSrc,
    `workerSrc configurado: ${pdfjs.GlobalWorkerOptions.workerSrc}`
  );
  assert(existsSync(fileURLToPath(pdfjs.GlobalWorkerOptions.workerSrc)), "workerSrc precisa existir em disco");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
