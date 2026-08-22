// Tipos da exportação do Timeline filtrado (dossiê contratual/jurídico).
// Nenhum tipo aqui inventa uma fonte de dado que não existe no schema
// real — campos sem fonte real ficam `null` e são documentados como tal
// (ver docs/timeline-export.md).

import type { ImplicationCategory, SourceType } from "@axion/types";

export type ExportFormatId = "PDF" | "XLSX" | "CSV" | "EVIDENCE_FILES" | "ZIP";

/**
 * Critérios de filtro do Timeline — exatamente os mesmos aplicados na
 * tela. A exportação nunca usa um critério diferente do que está
 * visível/ativo para o usuário no momento de exportar.
 */
export interface TimelineFilterCriteria {
  sources: SourceType[];
  categories: ImplicationCategory[];
  dateFrom: string | null; // ISO date (yyyy-mm-dd)
  dateTo: string | null; // ISO date (yyyy-mm-dd)
  participants: string[]; // endereços de e-mail selecionados
  /** Quando não vazio, restringe aos eventIds explicitamente marcados pelo usuário (seleção manual, além dos demais filtros). */
  selectedEventIds: string[] | null;
}

export function emptyTimelineFilterCriteria(): TimelineFilterCriteria {
  return {
    sources: [],
    categories: [],
    dateFrom: null,
    dateTo: null,
    participants: [],
    selectedEventIds: null,
  };
}

/** Um participante derivado de e-mails reais vinculados a eventos — nunca inventado. */
export interface TimelineParticipant {
  address: string;
  eventCount: number;
}

/** Metadado de versão de documento necessário para resolver evidência em arquivo — reaproveita ManagedDocumentVersion (lib/document-management.ts), nunca duplicado. */
export interface TimelineDocumentContext {
  documentVersionId: string;
  documentTitle: string;
  filePath: string | null;
  storageBucket: string | null;
  originalFileName: string | null;
  mimeType: string | null;
}

/** Dados de e-mail necessários para a representação legível (seção 8) e para participantes. */
export interface TimelineEmailContext {
  emailId: string;
  from: string;
  to: string;
  subject: string;
  sentAt: string;
  snippet: string;
}

/** Anotação interna vinculada ao evento — nunca confundida com evidência. */
export interface TimelineEventNoteContext {
  id: string;
  category: string;
  text: string;
  authorName: string;
  createdAt: string;
}

/**
 * Linha do índice estruturado (XLSX/CSV) — um item por evento. Campos
 * sem fonte real no schema atual ficam `null` (nunca inventados) e são
 * listados em `unavailableFields` do manifesto quando relevante.
 */
export interface TimelineExportRow {
  sequence: number;
  eventDate: string;
  eventType: SourceType;
  title: string;
  summary: string;
  sourceType: SourceType;
  sourceName: string | null;
  sender: string | null;
  recipients: string | null;
  participants: string | null;
  contractReference: string | null;
  clauseReference: string | null;
  scopeImpact: boolean;
  priceImpact: boolean;
  scheduleImpact: boolean;
  evidenceCount: number;
  sourceReference: string | null;
  eventId: string;
  documentOrEmailId: string | null;
  originalFilename: string | null;
  sourceLanguage: string | null;
  notes: string | null;
  reviewStatus: string;
}

export type EvidenceExportStatus = "INCLUDED" | "UNAVAILABLE" | "GENERATED_REPRESENTATION";

/** Entrada de manifesto para uma evidência específica — nunca omitida silenciosamente. */
export interface ManifestEvidenceEntry {
  eventId: string;
  evidenceId: string;
  label: string;
  locator: string;
  status: EvidenceExportStatus;
  packagedFileName: string | null;
  originalFileName: string | null;
  reason: string | null;
}

/**
 * Manifesto da exportação — a base da reprodutibilidade (seção 13).
 * Guardado dentro do pacote (manifest.json) e espelhado na linha
 * timeline_exports do banco (via Server Action).
 */
export interface TimelineExportManifest {
  exportId: string;
  projectId: string;
  projectName: string;
  exportedAt: string;
  exportedByUserId: string;
  exportedByName: string;
  filters: TimelineFilterCriteria;
  itemCount: number;
  totalAvailableCount: number;
  eventIds: string[];
  formats: ExportFormatId[];
  evidence: ManifestEvidenceEntry[];
  eventNotesIncluded: number;
  checksum: string | null; // só preenchido quando realmente calculado — nunca inventado
}
