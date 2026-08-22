// Constrói o manifesto da exportação — a base da reprodutibilidade
// (seção 13 do requisito). Nunca omite uma fonte referenciada: toda
// evidência recebe uma entrada, mesmo quando indisponível.

import type {
  ExportFormatId,
  ManifestEvidenceEntry,
  TimelineExportManifest,
  TimelineFilterCriteria,
} from "./types";

export interface BuildManifestInput {
  exportId: string;
  projectId: string;
  projectName: string;
  exportedAt: string;
  exportedByUserId: string;
  exportedByName: string;
  filters: TimelineFilterCriteria;
  eventIds: string[];
  totalAvailableCount: number;
  formats: ExportFormatId[];
  evidence: ManifestEvidenceEntry[];
  eventNotesIncluded: number;
}

export function buildExportManifest(input: BuildManifestInput): TimelineExportManifest {
  return {
    exportId: input.exportId,
    projectId: input.projectId,
    projectName: input.projectName,
    exportedAt: input.exportedAt,
    exportedByUserId: input.exportedByUserId,
    exportedByName: input.exportedByName,
    filters: input.filters,
    itemCount: input.eventIds.length,
    totalAvailableCount: input.totalAvailableCount,
    eventIds: input.eventIds,
    formats: input.formats,
    evidence: input.evidence,
    eventNotesIncluded: input.eventNotesIncluded,
    // Nenhum checksum é calculado nesta fase (nenhuma ferramenta de
    // assinatura/hash do pacote final foi implementada) — nunca
    // inventado, sempre null até existir de fato.
    checksum: null,
  };
}
