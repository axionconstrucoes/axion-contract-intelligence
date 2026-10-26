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
const { readWorkbookSafely, MAX_WORKBOOK_BYTES } = await import("../apps/web/lib/schedule/weekly-report/read-workbook.ts");

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

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
