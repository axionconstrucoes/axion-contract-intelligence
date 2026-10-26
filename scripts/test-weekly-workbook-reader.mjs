// readWorkbookSafely com planilhas SINTÉTICAS (geradas aqui pelo exceljs; nenhum dado real):
// minúscula (caminho em memória), média e acima do limite em memória (streaming), fórmula sem valor
// em cache, linhas limitadas e proteção contra arquivo inválido. Rápido (< ~10 s).
//
// Uso: node scripts/test-weekly-workbook-reader.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { readWorkbookSafely, MAX_WORKBOOK_BYTES, verifyActualUncompressedSize } = await import("../apps/web/lib/schedule/weekly-report/read-workbook.ts");

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function build({ sheets, rows, cols = 3, formula = false }) {
  const wb = new ExcelJS.Workbook();
  for (let s = 0; s < sheets; s += 1) {
    const ws = wb.addWorksheet(`Aba ${s + 1}`);
    for (let r = 1; r <= rows; r += 1) {
      const row = [];
      for (let c = 1; c <= cols; c += 1) row.push(c % 3 === 0 ? `texto ${r}-${c}` : r * c);
      ws.addRow(row);
    }
    if (formula && s === 0) ws.getCell("A1").value = { formula: "SUM(B2:B3)" }; // sem resultado em cache
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const read = (buffer) => readWorkbookSafely({ buffer, fileName: "sintetica.xlsx", mimeType: MIME });
const totalRows = (r) => r.grids.reduce((n, g) => n + g.rows.length, 0);

console.log("\n======================================");
console.log("LEITOR DE XLSX DO RELATÓRIO SEMANAL — PLANILHAS SINTÉTICAS");
console.log("======================================\n");

await check("minúscula (3 abas x 50 linhas, ~12 KB): lida em memória; o streaming do exceljs falha neste tamanho no Node 24", async () => {
  const result = await read(await build({ sheets: 3, rows: 50 }));
  assert.equal(result.grids.length, 3);
  assert.equal(totalRows(result), 150);
  assert.equal(result.safety.detectedFormat, "XLSX");
});

await check("média abaixo do limite em memória (~1 MB descompactado): todas as abas e valores corretos", async () => {
  const result = await read(await build({ sheets: 4, rows: 700, cols: 12 }));
  assert.equal(result.grids.length, 4);
  assert.equal(totalRows(result), 2800);
  const cell = result.grids[0].rows[1].find((c) => c.address === "A2");
  assert.equal(cell.value, 2);
});

await check("acima do limite em memória (> 2 MB descompactado): segue em streaming e lê todas as abas", async () => {
  const result = await read(await build({ sheets: 5, rows: 1500, cols: 30 }));
  assert.equal(result.grids.length, 5);
  assert.equal(totalRows(result), 5 * 1500);
});

await check("limite de linhas por aba (2000) preservado nos dois caminhos", async () => {
  const big = await read(await build({ sheets: 1, rows: 2600, cols: 30 }));
  assert.ok(big.grids[0].rows.length <= 2000, `linhas lidas: ${big.grids[0].rows.length}`);
});

await check("fórmula sem valor em cache continua preservada como evidência (nunca recalculada)", async () => {
  const result = await read(await build({ sheets: 2, rows: 5, formula: true }));
  assert.equal(result.safety.formulasPreserved, 1);
  assert.equal(result.safety.formulasWithoutCachedValue, 1);
});

await check("arquivo inválido/gigante é recusado sem leitura (assinatura e tamanho)", async () => {
  const notZip = await read(Buffer.from("isto nao e uma planilha"));
  assert.equal(notZip.grids.length, 0);
  assert.ok(notZip.safety.notes.length > 0);
  assert.ok(MAX_WORKBOOK_BYTES >= 50 * 1024 * 1024);
});

// Pacote SINTÉTICO com ~60 MB reais em poucos KB no disco. `lie` reescreve, no diretório central do ZIP, o
// tamanho descompactado DECLARADO (controlado por quem envia o arquivo).
async function buildExpanding(realBytes, lie = null) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Aba" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  const head = Buffer.from('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData><!--');
  zip.file("xl/worksheets/sheet1.xml", Buffer.concat([head, Buffer.alloc(realBytes, 0x20), Buffer.from("--></worksheet>")]), { compression: "DEFLATE", compressionOptions: { level: 9 } });
  const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
  if (lie !== null) {
    for (let i = 0; i < buffer.length - 46; i += 1) {
      if (buffer.readUInt32LE(i) === 0x02014b50) buffer.writeUInt32LE(Math.min(buffer.readUInt32LE(i + 24), lie), i + 24);
    }
  }
  return buffer;
}

await check("GUARDA: cabeçalho do ZIP falsificado (declara ~1 KB, conteúdo real ~60 MB) é recusado SEM carregar em memória", async () => {
  const bomb = await buildExpanding(60 * 1024 * 1024, 1000);
  assert.ok(bomb.length < 200 * 1024, `no disco: ${bomb.length} bytes`);
  const before = process.memoryUsage().heapUsed;
  const result = await read(bomb);
  const grown = (process.memoryUsage().heapUsed - before) / 1048576;
  assert.equal(result.grids.length, 0);
  assert.ok(result.safety.notes.some((n) => /preservada sem leitura automática/.test(n) && /inconsistente/.test(n)), result.safety.notes.join(" | "));
  assert.ok(grown < 40, `heap cresceu ${grown.toFixed(0)} MB (esperado quase nada)`);
});

await check("GUARDA: pacote com cabeçalho HONESTO acima do limite total é recusado pelo limite declarado/real; abaixo dele continua legível", async () => {
  const honest = await buildExpanding(8 * 1024 * 1024); // 8 MB reais, declarados corretamente
  const small = await verifyActualUncompressedSize(honest, { totalBytes: 4 * 1024 * 1024, xmlEntryBytes: 128 * 1024 * 1024 });
  assert.equal(small.ok, false);
  assert.match(small.reason, /excede/);
  const ok = await verifyActualUncompressedSize(honest);
  assert.equal(ok.ok, true);
  assert.ok(ok.totalBytes > 8 * 1024 * 1024);
  const xml = await verifyActualUncompressedSize(honest, { totalBytes: 256 * 1024 * 1024, xmlEntryBytes: 1024 * 1024 });
  assert.equal(xml.ok, false);
  assert.match(xml.reason, /XML real excessiva/);
});

await check("GUARDA: planilhas normais não mudam — tamanho real conferido e leitura idêntica (minúscula e streaming)", async () => {
  for (const spec of [{ sheets: 3, rows: 50 }, { sheets: 5, rows: 1500, cols: 30 }]) {
    const buffer = await build(spec);
    const check = await verifyActualUncompressedSize(buffer);
    assert.equal(check.ok, true);
    const result = await read(buffer);
    assert.equal(result.grids.length, spec.sheets);
    assert.equal(totalRows(result), spec.sheets * spec.rows);
  }
});

await check("GUARDA: arquivo corrompido (ZIP truncado) continua lançando erro de formato inválido (contrato inalterado) e a verificação real o trata como inconsistente", async () => {
  const buffer = await build({ sheets: 2, rows: 100 });
  const truncated = buffer.subarray(0, Math.floor(buffer.length / 2));
  await assert.rejects(read(truncated), /end of central directory|Corrupted/i);
  const verified = await verifyActualUncompressedSize(truncated);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /inconsistente/);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
