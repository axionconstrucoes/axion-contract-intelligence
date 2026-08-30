// Deliberadamente SEM "server-only" (mesmo padrão do resto do
// pacote) — sem segredo/config aqui dentro, só parsing de um buffer já
// recebido; testável por script Node standalone com um .xlsx real.

import ExcelJS from "exceljs";
import { isSingleFechamentoWorkbook, parseFechamentoCellValue } from "@/lib/additionals/proposal-drive-lookup/extract-fechamento-estimate";

// Bloco 7 — mesma regra de estimativa do lookup do Drive
// (isSingleFechamentoWorkbook/parseFechamentoCellValue,
// proposal-drive-lookup/extract-fechamento-estimate.ts), aplicada a um
// arquivo REALMENTE enviado por upload manual (nunca ao Drive, nunca a
// uma fixture) — nunca duplica a regra de "exatamente uma aba
// FECHAMENTO -> B12 é a estimativa", só troca a FONTE do arquivo
// (Storage local, não Google Sheets API).

export interface ManualCostFileEstimateResult {
  costFileSheetNames: string[];
  salePrice: number | null;
  isEstimate: boolean;
  warning: string | null;
}

export async function readFechamentoEstimateFromBuffer(buffer: ArrayBuffer): Promise<ManualCostFileEstimateResult> {
  const workbook = new ExcelJS.Workbook();
  // Buffer.from(...) aqui é estruturalmente compatível em runtime (é o
  // mesmo tipo aceito por workbook.xlsx.load em toda a base — ver
  // scripts/document-extractors.mjs) — só o shape dos @types/node
  // diverge do @types de exceljs; cast pontual, nunca `any` mais amplo.
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);

  const sheetNames: string[] = [];
  workbook.eachSheet((worksheet) => {
    sheetNames.push(worksheet.name);
  });

  if (!isSingleFechamentoWorkbook(sheetNames)) {
    return {
      costFileSheetNames: sheetNames,
      salePrice: null,
      isEstimate: false,
      warning:
        sheetNames.length === 0
          ? "A planilha enviada não tem nenhuma aba legível."
          : `A planilha enviada tem ${sheetNames.length} aba(s) (${sheetNames.join(", ")}) — nenhuma lógica canônica de preço de venda foi encontrada para esse caso; nenhum valor foi inventado.`,
    };
  }

  const sheet = workbook.getWorksheet(sheetNames[0]);
  const rawValue = sheet?.getCell("B12").value ?? null;
  const salePrice = parseFechamentoCellValue(
    typeof rawValue === "number" || typeof rawValue === "string" ? rawValue : rawValue !== null ? String(rawValue) : null
  );

  if (salePrice === null) {
    return {
      costFileSheetNames: sheetNames,
      salePrice: null,
      isEstimate: false,
      warning: 'Célula B12 da aba "FECHAMENTO" não contém um valor numérico reconhecível.',
    };
  }

  return { costFileSheetNames: sheetNames, salePrice, isEstimate: true, warning: null };
}
