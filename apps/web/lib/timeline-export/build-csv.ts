// Índice estruturado em CSV — mesma lista de colunas do XLSX
// (build-xlsx.ts), sem dependência externa.

import type { TimelineExportRow } from "./types";

export const EXPORT_ROW_COLUMNS: Array<{ key: keyof TimelineExportRow; header: string }> = [
  { key: "sequence", header: "sequence" },
  { key: "eventDate", header: "eventDate" },
  { key: "eventType", header: "eventType" },
  { key: "title", header: "title" },
  { key: "summary", header: "summary" },
  { key: "sourceType", header: "sourceType" },
  { key: "sourceName", header: "sourceName" },
  { key: "sender", header: "sender" },
  { key: "recipients", header: "recipients" },
  { key: "participants", header: "participants" },
  { key: "contractReference", header: "contractReference" },
  { key: "clauseReference", header: "clauseReference" },
  { key: "scopeImpact", header: "scopeImpact" },
  { key: "priceImpact", header: "priceImpact" },
  { key: "scheduleImpact", header: "scheduleImpact" },
  { key: "evidenceCount", header: "evidenceCount" },
  { key: "sourceReference", header: "sourceReference" },
  { key: "eventId", header: "eventId" },
  { key: "documentOrEmailId", header: "documentId/emailId" },
  { key: "originalFilename", header: "originalFilename" },
  { key: "sourceLanguage", header: "sourceLanguage" },
  { key: "notes", header: "notes" },
  { key: "reviewStatus", header: "reviewStatus" },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildExportCsv(rows: TimelineExportRow[]): string {
  const header = EXPORT_ROW_COLUMNS.map((c) => csvCell(c.header)).join(",");
  const lines = rows.map((row) => EXPORT_ROW_COLUMNS.map((c) => csvCell(row[c.key])).join(","));
  return [header, ...lines].join("\r\n");
}
