// Bloco 7 — "UPLOAD MANUAL" de planilha de custo (Google Drive
// desabilitado no go-live). Testes REAIS: gera um .xlsx de verdade em
// memória (com exceljs, a mesma lib usada pelo extrator — nunca um
// mock do formato binário), lê de volta com a função real, e confirma
// que a MESMA regra de estimativa do lookup do Drive (FECHAMENTO/B12)
// é reaproveitada sem duplicação.
//
// Uso:
//   node scripts/test-manual-proposal-upload.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import ExcelJS from "exceljs";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

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
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("PROPOSTA DE ADICIONAL — UPLOAD MANUAL da planilha de custo (Bloco 7)");
console.log("======================================");
console.log("");

const { validateProposalCostFile } = await import(
  "../apps/web/lib/additionals/manual-proposal-upload/validate-proposal-cost-file.ts"
);
const { readFechamentoEstimateFromBuffer } = await import(
  "../apps/web/lib/additionals/manual-proposal-upload/read-fechamento-estimate-from-buffer.ts"
);

async function buildRealWorkbookBuffer(sheetNames, b12Value) {
  const workbook = new ExcelJS.Workbook();
  for (const name of sheetNames) {
    const sheet = workbook.addWorksheet(name);
    if (name.toUpperCase() === "FECHAMENTO" && b12Value !== undefined) {
      sheet.getCell("B12").value = b12Value;
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

check("validateProposalCostFile: aceita .xlsx com MIME correto", () => {
  const result = validateProposalCostFile(
    "planilha.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert(result.valid === true, `esperado válido, obtido erro: ${result.error}`);
});

check("validateProposalCostFile: RECUSA extensão fora do allowlist (ex.: .exe), mesmo com MIME forjado", () => {
  const result = validateProposalCostFile("planilha.exe", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert(result.valid === false, "arquivo .exe nunca deveria ser aceito como planilha de custo");
});

check("validateProposalCostFile: RECUSA MIME que não bate com a extensão (extensão certa, MIME forjado)", () => {
  const result = validateProposalCostFile("planilha.xlsx", "application/octet-stream");
  assert(result.valid === false, "MIME genérico/forjado nunca deveria ser aceito");
});

await check("readFechamentoEstimateFromBuffer: .xlsx REAL com exatamente 1 aba FECHAMENTO -> B12 é a estimativa (mesma regra do lookup do Drive)", async () => {
  const buffer = await buildRealWorkbookBuffer(["FECHAMENTO"], 123456.78);
  const result = await readFechamentoEstimateFromBuffer(buffer);
  assert(result.isEstimate === true, `esperava isEstimate=true, obtido: ${JSON.stringify(result)}`);
  assert(Math.abs(result.salePrice - 123456.78) < 0.01, `esperava ~123456.78, obtido ${result.salePrice}`);
});

await check("readFechamentoEstimateFromBuffer: .xlsx REAL com 2 abas -> NUNCA resolvido (nenhum palpite, mesma regra do Drive)", async () => {
  const buffer = await buildRealWorkbookBuffer(["FECHAMENTO", "Detalhe"], 999);
  const result = await readFechamentoEstimateFromBuffer(buffer);
  assert(result.isEstimate === false, "com 2 abas, nunca deveria resolver um preço");
  assert(result.salePrice === null);
  assert(result.warning !== null, "deveria explicar por que não resolveu");
});

await check("readFechamentoEstimateFromBuffer: .xlsx REAL sem aba FECHAMENTO -> NUNCA resolvido", async () => {
  const buffer = await buildRealWorkbookBuffer(["Planilha1"], undefined);
  const result = await readFechamentoEstimateFromBuffer(buffer);
  assert(result.isEstimate === false);
  assert(result.salePrice === null);
});

check("read-fechamento-estimate-from-buffer.ts REAPROVEITA isSingleFechamentoWorkbook/parseFechamentoCellValue do lookup do Drive — nunca uma segunda implementação da regra", () => {
  const source = readSource("apps/web/lib/additionals/manual-proposal-upload/read-fechamento-estimate-from-buffer.ts");
  assert(source.includes('from "@/lib/additionals/proposal-drive-lookup/extract-fechamento-estimate"'), "deveria importar as funções puras já existentes, nunca reescrevê-las");
  assert(!/sheetNames\[0\]\.trim\(\)\.toUpperCase\(\) === ["']FECHAMENTO["']/.test(source), "não deveria reimplementar a checagem de nome de aba localmente");
});

check("read-fechamento-estimate-from-buffer.ts NUNCA consulta o Drive real nem importa a fixture do Drive", () => {
  const source = readSource("apps/web/lib/additionals/manual-proposal-upload/read-fechamento-estimate-from-buffer.ts");
  assert(!/googleapis|proposal-drive-lookup\/fixture-client|proposal-drive-lookup\/get-proposal-drive-lookup-client/.test(source));
});

check("createAdditionalProposalAction: valor extraído do arquivo real SEMPRE prevalece sobre um valor digitado à mão (mesmo princípio já usado no ramo DRIVE)", () => {
  const source = readSource("apps/web/app/[projectId]/adicionais/actions.ts");
  const manualBlock = source.slice(source.indexOf("Origem MANUAL com planilha"));
  assert(manualBlock.includes("proposedValue = estimate.salePrice"), "o preço extraído do arquivo deveria sobrescrever proposedValue");
});

check("createAdditionalProposalAction: extensão/MIME são validados no SERVIDOR antes de ler o arquivo (nunca confia só no navegador)", () => {
  const source = readSource("apps/web/app/[projectId]/adicionais/actions.ts");
  const manualBlock = source.slice(source.indexOf("Origem MANUAL com planilha"));
  const validateIndex = manualBlock.indexOf("validateProposalCostFile(");
  const readIndex = manualBlock.indexOf("readFechamentoEstimateFromBuffer(");
  assert(validateIndex !== -1 && readIndex !== -1 && validateIndex < readIndex, "a validação precisa acontecer ANTES de ler o conteúdo do arquivo");
});

check("formulário: campo de upload da planilha só aparece na origem MANUAL (nunca em DRIVE/EXISTING)", () => {
  const source = readSource("apps/web/components/additionals/additional-proposal-create-form.tsx");
  assert(source.includes('sourceType === "MANUAL"') && source.includes('name="costFile"'));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
if (failed > 0) process.exitCode = 1;
