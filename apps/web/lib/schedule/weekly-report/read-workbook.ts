// Leitura SEGURA da planilha do relatório semanal (server-side).
//
// Garantias:
//   - valida extensão, MIME, ASSINATURA REAL (bytes) e tamanho antes de abrir;
//   - XLS legado (OLE, D0CF11E0) NÃO é aberto como XLSX: vira
//     LEGACY_FORMAT_REVIEW_REQUIRED (arquivo preservado e listado);
//   - macros (xl/vbaProject.bin), links externos (xl/externalLinks),
//     conexões (xl/connections.xml, queryTables) são DETECTADOS pela lista
//     de entradas do pacote e IGNORADOS — nunca executados/seguidos;
//   - exceljs lê só o XML armazenado: fórmulas entram como texto (evidência)
//     e o valor usado é o resultado cached; sem cached => null ("não
//     disponível"), nunca recalculado/inventado;
//   - hyperlinks viram só o texto; erros (#REF!, #N/A) viram null.

import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { SheetCell, SheetGrid, WorkbookSafetyReport, WorkbookSheetIndexEntry } from "./types";

export const MAX_WORKBOOK_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 120;

const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

export function detectSpreadsheetFormat(buffer: Buffer): WorkbookSafetyReport["detectedFormat"] {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return "XLSX";
  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return "XLS_LEGACY";
  return "UNKNOWN";
}

export function validateWorkbookFile(input: { buffer: Buffer; fileName: string; mimeType: string }): Omit<WorkbookSafetyReport, "macrosDetected" | "externalLinksDetected" | "dataConnectionsDetected" | "formulasWithoutCachedValue" | "formulasPreserved"> {
  const lower = input.fileName.toLowerCase();
  const detectedFormat = detectSpreadsheetFormat(input.buffer);
  const extensionValid = /\.(xlsx|xlsm|xls)$/.test(lower);
  const mimeValid = XLSX_MIME_TYPES.has(input.mimeType.toLowerCase());
  const sizeValid = input.buffer.length > 0 && input.buffer.length <= MAX_WORKBOOK_BYTES;
  const notes: string[] = [];
  const signatureValid =
    (detectedFormat === "XLSX" && /\.(xlsx|xlsm)$/.test(lower)) || (detectedFormat === "XLS_LEGACY" && lower.endsWith(".xls"));
  if (!signatureValid) notes.push(`Assinatura real (${detectedFormat}) não corresponde à extensão do arquivo.`);
  if (!mimeValid) notes.push(`MIME declarado (${input.mimeType}) fora da lista aceita para planilhas.`);
  if (!sizeValid) notes.push(`Tamanho ${input.buffer.length} bytes fora do limite.`);
  return { detectedFormat, signatureValid, extensionValid, mimeValid, sizeValid, notes };
}

async function inspectPackage(buffer: Buffer): Promise<Pick<WorkbookSafetyReport, "macrosDetected" | "externalLinksDetected" | "dataConnectionsDetected">> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  return {
    macrosDetected: names.some((name) => /^xl\/vbaProject\.bin$/i.test(name)),
    externalLinksDetected: names.filter((name) => /^xl\/externalLinks\//i.test(name) && /\.xml$/i.test(name) && !/_rels/i.test(name)).length,
    dataConnectionsDetected: names.filter((name) => /^xl\/connections\.xml$/i.test(name) || /^xl\/queryTables\//i.test(name) || /^customXml\/.*connection/i.test(name)).length,
  };
}

function toCell(cell: ExcelJS.Cell, counters: { formulas: number; missing: number }): SheetCell {
  const raw = cell.value;
  const address = cell.address;
  if (raw === null || raw === undefined) return { address, value: null, formula: null, cachedValueMissing: false };
  if (raw instanceof Date) return { address, value: raw, formula: null, cachedValueMissing: false };
  if (typeof raw === "object") {
    if ("formula" in raw || "sharedFormula" in raw) {
      counters.formulas += 1;
      const formula = ("formula" in raw ? raw.formula : null) ?? ("sharedFormula" in raw ? `shared:${raw.sharedFormula}` : null);
      const result = (raw as { result?: unknown }).result;
      if (result === undefined || result === null || (typeof result === "object" && result !== null && "error" in (result as object))) {
        counters.missing += 1;
        return { address, value: null, formula: formula ?? null, cachedValueMissing: true };
      }
      if (result instanceof Date) return { address, value: result, formula: formula ?? null, cachedValueMissing: false };
      if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
        return { address, value: result, formula: formula ?? null, cachedValueMissing: false };
      }
      counters.missing += 1;
      return { address, value: null, formula: formula ?? null, cachedValueMissing: true };
    }
    if ("richText" in raw) return { address, value: raw.richText.map((part) => part.text).join(""), formula: null, cachedValueMissing: false };
    if ("hyperlink" in raw) return { address, value: typeof raw.text === "string" ? raw.text : String(raw.text ?? ""), formula: null, cachedValueMissing: false };
    if ("error" in raw) return { address, value: null, formula: null, cachedValueMissing: false };
    return { address, value: String(raw), formula: null, cachedValueMissing: false };
  }
  return { address, value: raw as string | number | boolean, formula: null, cachedValueMissing: false };
}

export interface ReadWorkbookResult {
  safety: WorkbookSafetyReport;
  sheetIndex: WorkbookSheetIndexEntry[];
  grids: SheetGrid[];
}

/**
 * Lê o arquivo com valores armazenados. Lança para formato inválido; para
 * XLS legado devolve safety.detectedFormat = XLS_LEGACY e nenhum grid.
 */
export async function readWorkbookSafely(input: { buffer: Buffer; fileName: string; mimeType: string }): Promise<ReadWorkbookResult> {
  const base = validateWorkbookFile(input);
  const empty: WorkbookSafetyReport = { ...base, macrosDetected: false, externalLinksDetected: 0, dataConnectionsDetected: 0, formulasWithoutCachedValue: 0, formulasPreserved: 0 };

  if (base.detectedFormat === "XLS_LEGACY") {
    return { safety: { ...empty, notes: [...empty.notes, "XLS legado (OLE): leitor atual não suporta; revisão segura necessária."] }, sheetIndex: [], grids: [] };
  }
  if (base.detectedFormat !== "XLSX" || !base.sizeValid) {
    return { safety: { ...empty, notes: [...empty.notes, "Arquivo não é um pacote XLSX válido."] }, sheetIndex: [], grids: [] };
  }

  const pkg = await inspectPackage(input.buffer);

  // ExcelJS.Workbook().xlsx.load() materializa a pasta inteira em memória.
  // Arquivos pequenos em disco podem expandir para vários GB quando têm
  // dimensões/estilos extensos. No worker do GitHub isso já provocou OOM
  // (>6 GB). O WorkbookReader faz leitura streaming: mantemos no máximo
  // MAX_ROWS × MAX_COLUMNS por aba, mas drenamos o restante sem armazenar.
  const tempPath = join(tmpdir(), `acc-weekly-${randomUUID()}.xlsx`);
  await writeFile(tempPath, input.buffer);

  const counters = { formulas: 0, missing: 0 };
  const grids: SheetGrid[] = [];
  const sheetIndex: WorkbookSheetIndexEntry[] = [];

  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(tempPath, {
      entries: "emit",
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "cache",
      worksheets: "emit",
    });

    let position = 0;
    for await (const sheet of workbook) {
      const rows: SheetCell[][] = [];
      let observedRows = 0;
      let observedColumns = 0;

      for await (const row of sheet) {
        observedRows = Math.max(observedRows, row.number);
        observedColumns = Math.max(observedColumns, row.cellCount);

        if (row.number > MAX_ROWS) continue;

        const columnCount = Math.min(Math.max(row.cellCount, 1), MAX_COLUMNS);
        const cells: SheetCell[] = [];
        for (let column = 1; column <= columnCount; column += 1) {
          cells.push(toCell(row.getCell(column), counters));
        }
        rows.push(cells);
      }

      const sheetMeta = sheet as unknown as { state?: string; name?: string };
      const hidden = sheetMeta.state !== undefined && sheetMeta.state !== "visible";
      const name = sheetMeta.name ?? `Planilha ${position + 1}`;

      grids.push({ name, index: position, rows, hidden });
      sheetIndex.push({
        index: position,
        name,
        hidden,
        rowCount: observedRows,
      });
      position += 1;
    }
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }

  const notes = [...base.notes];
  if (pkg.macrosDetected) notes.push("Macro (vbaProject.bin) presente no pacote — ignorada, nunca executada.");
  if (pkg.externalLinksDetected > 0) notes.push(`${pkg.externalLinksDetected} link(s) externo(s) no pacote — nunca seguidos.`);
  if (pkg.dataConnectionsDetected > 0) notes.push(`${pkg.dataConnectionsDetected} conexão(ões) de dados no pacote — nunca atualizadas.`);
  if (counters.missing > 0) notes.push(`${counters.missing} fórmula(s) sem valor armazenado — marcadas como não disponíveis.`);

  return {
    safety: { ...empty, ...pkg, formulasWithoutCachedValue: counters.missing, formulasPreserved: counters.formulas, notes },
    sheetIndex,
    grids,
  };
}
