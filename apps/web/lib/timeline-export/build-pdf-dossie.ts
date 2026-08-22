// Dossiê PDF do Timeline filtrado (seção 3), usando jsPDF. Formatação
// simples e legível — não é o objetivo desta fase produzir um layout
// sofisticado, e sim um documento correto, completo e reprodutível.

import { jsPDF } from "jspdf";
import type { TimelineExportManifest, TimelineExportRow, TimelineFilterCriteria } from "./types";
import { categoryLabels, eventStatusLabels, sourceTypeShortLabels } from "../labels";

const PAGE_WIDTH = 210; // A4 mm
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 5;
const PAGE_HEIGHT = 297;

function describeFilters(filters: TimelineFilterCriteria): string[] {
  const lines: string[] = [];
  lines.push(
    `Fontes: ${filters.sources.length > 0 ? filters.sources.map((s) => sourceTypeShortLabels[s]).join(", ") : "Todas"}`
  );
  lines.push(
    `Categorias/Impactos: ${
      filters.categories.length > 0 ? filters.categories.map((c) => categoryLabels[c]).join(", ") : "Todas"
    }`
  );
  lines.push(
    `Período: ${filters.dateFrom ?? "(sem início)"} a ${filters.dateTo ?? "(sem fim)"}`
  );
  lines.push(`Participantes: ${filters.participants.length > 0 ? filters.participants.join(", ") : "Todos"}`);
  lines.push(
    `Seleção manual de eventos: ${
      filters.selectedEventIds && filters.selectedEventIds.length > 0
        ? `${filters.selectedEventIds.length} evento(s) selecionado(s) manualmente`
        : "Não aplicada"
    }`
  );
  return lines;
}

export function buildTimelineDossiePdf(manifest: TimelineExportManifest, rows: TimelineExportRow[]): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  function ensureSpace(next: number) {
    if (y + next > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function writeLine(text: string, options: { bold?: boolean; size?: number } = {}) {
    doc.setFont("helvetica", options.bold ? "bold" : "normal");
    doc.setFontSize(options.size ?? 10);
    const wrapped = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
    for (const line of wrapped) {
      ensureSpace(LINE_HEIGHT);
      doc.text(line, MARGIN, y);
      y += LINE_HEIGHT;
    }
  }

  // ---- Cabeçalho ----
  writeLine("ACC — Dossiê Contratual/Jurídico", { bold: true, size: 16 });
  writeLine(manifest.projectName, { bold: true, size: 12 });
  y += 2;
  writeLine(`Exportado em: ${manifest.exportedAt}`);
  writeLine(`Exportado por: ${manifest.exportedByName}`);
  writeLine(`ID da exportação: ${manifest.exportId}`);
  writeLine(`Registros exportados: ${manifest.itemCount} de ${manifest.totalAvailableCount} disponíveis`);
  y += 2;
  writeLine("Filtros aplicados:", { bold: true });
  for (const line of describeFilters(manifest.filters)) {
    writeLine(`- ${line}`);
  }
  y += 2;
  writeLine("Ordem: cronológica (mais antigo → mais recente).", { bold: true });
  y += 4;

  // ---- Eventos ----
  for (const row of rows) {
    ensureSpace(LINE_HEIGHT * 3);
    doc.setDrawColor(200);
    doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
    y += 3;

    writeLine(`${row.sequence}. ${row.eventDate} — ${row.title}`, { bold: true, size: 11 });
    writeLine(`TIPO: ${sourceTypeShortLabels[row.eventType] ?? row.eventType}`);
    writeLine(`RESUMO: ${row.summary}`);
    if (row.participants) writeLine(`PARTICIPANTES: ${row.participants}`);
    writeLine(`ORIGEM: ${row.sourceName ?? row.sourceType}`);

    const impacts: string[] = [];
    if (row.scopeImpact) impacts.push("Escopo");
    if (row.priceImpact) impacts.push("Preço");
    if (row.scheduleImpact) impacts.push("Prazo");
    writeLine(`IMPACTO: ${impacts.length > 0 ? impacts.join(", ") : "Não classificado"}`);

    if (row.contractReference || row.clauseReference) {
      writeLine(`CLÁUSULA/ADITIVO RELACIONADO: ${[row.contractReference, row.clauseReference].filter(Boolean).join(" | ")}`);
    }

    writeLine(`EVIDÊNCIAS: ${row.evidenceCount} evidência(s) vinculada(s)`);
    if (row.sourceReference) writeLine(`REFERÊNCIA À FONTE: ${row.sourceReference}`);
    writeLine(`Status de revisão: ${eventStatusLabels[row.reviewStatus as keyof typeof eventStatusLabels] ?? row.reviewStatus}`);

    if (row.notes) {
      writeLine(`ANOTAÇÃO INTERNA — INFORMAÇÃO DECLARADA: ${row.notes}`);
    }

    y += 3;
  }

  return doc.output("blob");
}
