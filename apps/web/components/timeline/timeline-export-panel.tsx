"use client";

import { useState } from "react";
import type { ContractEvent } from "@axion/types";

import { Button } from "@/components/ui/button";
import { categoryLabels, sourceTypeShortLabels } from "@/lib/labels";
import { recordTimelineExportAction } from "@/app/[projectId]/timeline/timeline-export-actions";
import { sortChronological } from "@/lib/timeline-export/apply-filters";
import { buildExportRows } from "@/lib/timeline-export/build-export-rows";
import { buildExportManifest } from "@/lib/timeline-export/build-manifest";
import { buildExportCsv } from "@/lib/timeline-export/build-csv";
import { buildExportXlsx } from "@/lib/timeline-export/build-xlsx";
import { buildTimelineDossiePdf } from "@/lib/timeline-export/build-pdf-dossie";
import { buildManifestoPdf } from "@/lib/timeline-export/build-manifesto-pdf";
import { buildZipPackage } from "@/lib/timeline-export/build-zip-package";
import { resolveEvidenceFiles } from "@/lib/timeline-export/resolve-evidence-files";
import type {
  ExportFormatId,
  TimelineDocumentContext,
  TimelineEmailContext,
  TimelineEventNoteContext,
  TimelineFilterCriteria,
} from "@/lib/timeline-export/types";

const FORMAT_OPTIONS: Array<{ id: ExportFormatId; label: string }> = [
  { id: "PDF", label: "Dossiê PDF" },
  { id: "XLSX", label: "Índice XLSX/CSV" },
  { id: "EVIDENCE_FILES", label: "Arquivos originais" },
  { id: "ZIP", label: "Tudo em ZIP" },
];

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function describeFilterSummary(criteria: TimelineFilterCriteria): string[] {
  const lines: string[] = [];
  lines.push(
    `Fontes: ${criteria.sources.length > 0 ? criteria.sources.map((s) => sourceTypeShortLabels[s]).join(", ") : "Todas"}`
  );
  lines.push(
    `Categorias/Impactos: ${
      criteria.categories.length > 0 ? criteria.categories.map((c) => categoryLabels[c]).join(", ") : "Todas"
    }`
  );
  lines.push(`Período: ${criteria.dateFrom ?? "(sem início)"} a ${criteria.dateTo ?? "(sem fim)"}`);
  lines.push(`Participantes: ${criteria.participants.length > 0 ? criteria.participants.join(", ") : "Todos"}`);
  lines.push(
    `Seleção manual de eventos: ${
      criteria.selectedEventIds && criteria.selectedEventIds.length > 0
        ? `${criteria.selectedEventIds.length} evento(s)`
        : "Não aplicada"
    }`
  );
  return lines;
}

export function TimelineExportPanel({
  projectId,
  projectName,
  criteria,
  exportEvents,
  totalAvailableCount,
  emailsById,
  documentVersionsById,
  eventNotesByEventId,
  exportedByUserId,
  exportedByName,
}: {
  projectId: string;
  projectName: string;
  criteria: TimelineFilterCriteria;
  exportEvents: ContractEvent[];
  totalAvailableCount: number;
  emailsById: Map<string, TimelineEmailContext>;
  documentVersionsById: Map<string, TimelineDocumentContext>;
  eventNotesByEventId: Map<string, TimelineEventNoteContext[]>;
  exportedByUserId: string;
  exportedByName: string;
}) {
  const [open, setOpen] = useState(false);
  const [formats, setFormats] = useState<Set<ExportFormatId>>(new Set(["PDF", "XLSX"]));
  const [status, setStatus] = useState<"idle" | "generating" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  function toggleFormat(id: ExportFormatId) {
    setFormats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (exportEvents.length === 0) {
      setError("Nenhum evento no conjunto filtrado. Ajuste os filtros antes de exportar.");
      setStatus("error");
      return;
    }
    if (formats.size === 0) {
      setError("Selecione ao menos um formato de exportação.");
      setStatus("error");
      return;
    }

    setStatus("generating");
    setError(null);

    try {
      const exportId = crypto.randomUUID();
      const exportedAt = new Date().toISOString();
      const chronological = sortChronological(exportEvents);

      const rows = buildExportRows({
        events: chronological,
        emailsById,
        documentVersionsById,
        eventNotesByEventId,
      });

      // A resolução de evidências (que classifica cada uma como
      // INCLUDED/UNAVAILABLE/GENERATED_REPRESENTATION) roda sempre que se
      // exporta, independente dos formatos marcados: a reprodutibilidade
      // (seção 13) e o registro de fontes indisponíveis (seção 10) não
      // dependem de qual arquivo baixável foi escolhido.
      const resolvedEvidence = await resolveEvidenceFiles({
        events: chronological,
        documentVersionsById,
        emailsById,
      });

      const eventNotesIncluded = chronological.reduce(
        (total, event) => total + (eventNotesByEventId.get(event.id)?.length ?? 0),
        0
      );

      const manifest = buildExportManifest({
        exportId,
        projectId,
        projectName,
        exportedAt,
        exportedByUserId,
        exportedByName,
        filters: criteria,
        eventIds: chronological.map((e) => e.id),
        totalAvailableCount,
        formats: Array.from(formats),
        evidence: resolvedEvidence.map((r) => r.entry),
        eventNotesIncluded,
      });

      const datePrefix = exportedAt.slice(0, 10);

      if (formats.has("ZIP")) {
        const [manifestoPdf, timelinePdf, indiceXlsx] = await Promise.all([
          Promise.resolve(buildManifestoPdf(manifest)),
          Promise.resolve(buildTimelineDossiePdf(manifest, rows)),
          buildExportXlsx(rows),
        ]);
        const zip = await buildZipPackage({
          manifest,
          manifestoPdf,
          indiceXlsx,
          timelinePdf,
          evidenceFiles: resolvedEvidence,
        });
        downloadBlob(zip, `timeline-export-${datePrefix}-${exportId.slice(0, 8)}.zip`);
      } else {
        if (formats.has("PDF")) {
          downloadBlob(buildTimelineDossiePdf(manifest, rows), `timeline-dossie-${datePrefix}.pdf`);
        }
        if (formats.has("XLSX")) {
          const xlsx = await buildExportXlsx(rows);
          downloadBlob(xlsx, `timeline-indice-${datePrefix}.xlsx`);
          const csv = buildExportCsv(rows);
          downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `timeline-indice-${datePrefix}.csv`);
        }
        if (formats.has("EVIDENCE_FILES")) {
          for (const file of resolvedEvidence) {
            if (file.content && file.entry.packagedFileName) {
              downloadBlob(file.content, file.entry.packagedFileName);
            }
          }
        }
      }

      const result = await recordTimelineExportAction({
        exportId,
        projectId,
        filters: criteria,
        eventIds: chronological.map((e) => e.id),
        formats: Array.from(formats),
      });

      if (!result.ok) {
        setError(`Exportação gerada, mas falhou ao registrar auditoria: ${result.error}`);
        setStatus("error");
        return;
      }

      setDoneMessage(`${chronological.length} evento(s) exportado(s). ID da exportação: ${exportId}.`);
      setStatus("done");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Falha inesperada ao gerar a exportação.");
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
          setStatus("idle");
          setError(null);
          setDoneMessage(null);
        }}
      >
        Exportar Timeline Filtrado
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-sm font-medium">
        Serão exportados {exportEvents.length} evento(s) de {totalAvailableCount} registro(s) disponíveis.
      </p>

      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {describeFilterSummary(criteria).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium text-muted-foreground">Formatos</legend>
        {FORMAT_OPTIONS.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formats.has(option.id)}
              onChange={() => toggleFormat(option.id)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {status === "done" && doneMessage ? <p className="text-sm text-emerald-600">{doneMessage}</p> : null}

      <div className="flex gap-2">
        <Button type="button" onClick={handleConfirm} disabled={status === "generating"}>
          {status === "generating" ? "Gerando…" : "Confirmar exportação"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={status === "generating"}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
