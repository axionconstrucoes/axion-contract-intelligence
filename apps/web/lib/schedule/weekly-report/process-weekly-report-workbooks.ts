// Orquestrador (I/O via porta WeeklyReportWorkbookStore) do processamento
// das planilhas do relatório semanal. Idempotente: UNIQUE por anexo; a
// reexecução relê o arquivo (mesmo SHA-256) e atualiza, preservando
// mapeamentos/validações humanas. XLS legado ou arquivo inválido nunca é
// aberto como XLSX: vira LEGACY_FORMAT_REVIEW_REQUIRED / INVALID_FILE com o
// arquivo preservado e listado.

import { sanitizeErrorMessage } from "../weekly-ingestion/ingest-weekly-schedule-email";
import type { WeeklyReportWorkbookStore } from "../weekly-ingestion/store";
import { processWorkbookGrids } from "./process-workbook";
import { readWorkbookSafely } from "./read-workbook";
import type { WeeklyReportWorkbookResult } from "./types";

export interface ProcessWeeklyReportWorkbooksResult {
  examined: number;
  extracted: number;
  partial: number;
  pendingReview: number;
  legacy: number;
  invalid: number;
  failed: number;
}

export async function processWeeklyReportWorkbooks(
  store: WeeklyReportWorkbookStore,
  options: { limit?: number; readWorkbook?: typeof readWorkbookSafely } = {}
): Promise<ProcessWeeklyReportWorkbooksResult> {
  const result: ProcessWeeklyReportWorkbooksResult = { examined: 0, extracted: 0, partial: 0, pendingReview: 0, legacy: 0, invalid: 0, failed: 0 };
  const read = options.readWorkbook ?? readWorkbookSafely;

  for (const candidate of await store.listWorkbookCandidates(options.limit ?? 20)) {
    result.examined += 1;
    try {
      const buffer = await store.downloadAttachment(candidate);
      const sha256 = await store.computeSha256(buffer);
      if (candidate.sha256Hash && candidate.sha256Hash !== sha256) {
        throw new Error("SHA-256 do arquivo baixado difere do registrado no anexo — integridade comprometida.");
      }

      const reading = await read({ buffer, fileName: candidate.fileName, mimeType: candidate.mimeType });
      const fileFacts = { sha256, detectedFormat: reading.safety.detectedFormat, safety: reading.safety, sheetIndex: reading.sheetIndex };

      if (reading.safety.detectedFormat === "XLS_LEGACY") {
        await store.saveWorkbook(candidate, { ...fileFacts, status: "LEGACY_FORMAT_REVIEW_REQUIRED", errorMessage: null, summary: { note: "XLS legado: leitor atual não suporta; arquivo preservado para revisão." }, sheets: [] });
        result.legacy += 1;
        continue;
      }
      if (reading.safety.detectedFormat !== "XLSX" || !reading.safety.sizeValid) {
        await store.saveWorkbook(candidate, { ...fileFacts, status: "INVALID_FILE", errorMessage: null, summary: { notes: reading.safety.notes }, sheets: [] });
        result.invalid += 1;
        continue;
      }

      const context = await store.loadProcessingContext(candidate);
      const processed: WeeklyReportWorkbookResult = processWorkbookGrids(reading, { ...context, fileName: candidate.fileName });
      const { id } = await store.saveWorkbook(candidate, { ...fileFacts, status: processed.status, errorMessage: null, summary: processed.summary, sheets: processed.sheets });

      if (processed.status === "EXTRACTED") result.extracted += 1;
      else if (processed.status === "PARTIAL") result.partial += 1;
      else result.pendingReview += 1;

      await store.writeAudit({
        projectId: candidate.projectId,
        action: "WEEKLY_REPORT_WORKBOOK_PROCESSED",
        entityType: "WEEKLY_REPORT_WORKBOOK",
        entityId: id,
        detail:
          `Planilha "${candidate.fileName}" (SHA-256 ${sha256}, ${reading.sheetIndex.length} aba(s)) processada com valores armazenados: ${processed.status}. ` +
          `Abas: ${processed.sheets.map((sheet) => `${sheet.category}=${sheet.status}${sheet.originalSheetName ? ` ("${sheet.originalSheetName}")` : ""}`).join("; ")}. ` +
          `Segurança: macros=${reading.safety.macrosDetected ? "detectadas/ignoradas" : "não"}, links externos=${reading.safety.externalLinksDetected}, conexões=${reading.safety.dataConnectionsDetected}, fórmulas sem valor=${reading.safety.formulasWithoutCachedValue}.`,
      });
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      await store.saveWorkbook(candidate, {
        sha256: candidate.sha256Hash ?? "0".repeat(64),
        detectedFormat: "UNKNOWN",
        safety: null,
        sheetIndex: [],
        status: "FAILED",
        errorMessage: message,
        summary: null,
        sheets: [],
      });
      result.failed += 1;
    }
  }
  return result;
}
