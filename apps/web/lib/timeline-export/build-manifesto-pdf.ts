// Manifesto legível (00_MANIFESTO.pdf) — resumo curto da exportação
// para abertura rápida do pacote. O manifesto completo/reprodutível,
// máquina-legível, é manifest.json (ver build-manifest.ts) — este PDF
// nunca é a única fonte de verdade, só a leitura humana rápida.

import { jsPDF } from "jspdf";
import type { TimelineExportManifest } from "./types";
import { categoryLabels, sourceTypeShortLabels } from "../labels";

export function buildManifestoPdf(manifest: TimelineExportManifest): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 15;
  let y = margin;

  function line(text: string, bold = false, size = 11) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, 210 - margin * 2) as string[];
    for (const w of wrapped) {
      doc.text(w, margin, y);
      y += 6;
    }
  }

  line("ACC — Manifesto da Exportação", true, 16);
  y += 2;
  line(`Projeto: ${manifest.projectName}`, true);
  line(`ID da exportação: ${manifest.exportId}`);
  line(`Exportado em: ${manifest.exportedAt}`);
  line(`Exportado por: ${manifest.exportedByName}`);
  y += 2;
  line(`Registros exportados: ${manifest.itemCount} de ${manifest.totalAvailableCount} disponíveis`, true);
  line(`Formatos incluídos: ${manifest.formats.join(", ")}`);
  line(`Anotações internas incluídas: ${manifest.eventNotesIncluded}`);
  y += 2;

  line("Filtros aplicados:", true);
  line(
    `Fontes: ${
      manifest.filters.sources.length > 0
        ? manifest.filters.sources.map((s) => sourceTypeShortLabels[s]).join(", ")
        : "Todas"
    }`
  );
  line(
    `Categorias/Impactos: ${
      manifest.filters.categories.length > 0
        ? manifest.filters.categories.map((c) => categoryLabels[c]).join(", ")
        : "Todas"
    }`
  );
  line(`Período: ${manifest.filters.dateFrom ?? "(sem início)"} a ${manifest.filters.dateTo ?? "(sem fim)"}`);
  line(`Participantes: ${manifest.filters.participants.length > 0 ? manifest.filters.participants.join(", ") : "Todos"}`);

  y += 2;
  const unavailable = manifest.evidence.filter((e) => e.status === "UNAVAILABLE");
  if (unavailable.length > 0) {
    line(`${unavailable.length} evidência(s) referenciada(s), arquivo original não disponível para exportação.`, true);
  }

  y += 4;
  line(
    "Este manifesto e o arquivo manifest.json (dados completos e reprodutíveis) devem ser preservados junto ao pacote.",
    false,
    9
  );

  return doc.output("blob");
}
