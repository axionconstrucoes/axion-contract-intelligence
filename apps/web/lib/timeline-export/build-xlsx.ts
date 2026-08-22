// Índice estruturado em XLSX (seção 4), usando exceljs — já dependência
// do monorepo (antes só usada em scripts/document-extractors.mjs para
// leitura; aqui é geração).

import ExcelJS from "exceljs";
import { EXPORT_ROW_COLUMNS } from "./build-csv";
import type { TimelineExportRow } from "./types";

export async function buildExportXlsx(rows: TimelineExportRow[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AXION Acompanhamento de Contratos (ACC)";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Timeline");

  sheet.columns = EXPORT_ROW_COLUMNS.map((c) => ({ header: c.header, key: c.key as string, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
