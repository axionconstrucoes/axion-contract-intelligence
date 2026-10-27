import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

// Resumo de cobertura por versão para LISTAS (cards de documentos,
// revisão de cláusulas). Leve de propósito: usa só a extração PROCESSED
// mais recente de cada versão e, dela, só os segmentos-marcador de
// página pendente e os sinalizados para revisão visual. A conta
// completa (inclusive páginas sem segmento) fica na tela da versão
// (computeExtractionCoverage). Sem campos próprios no schema ainda —
// ver docs/proposta-cobertura-extracao.md.

export type VersionCoverageSummary = {
  documentVersionId: string;
  extractionId: string;
  totalPages: number | null;
  readPages: number | null;
  pendingPages: number[];
  visualReviewPages: number[];
  partial: boolean;
};

const PAGE_SIZE = 1000;

export async function getVersionCoverageSummaries(
  versionIds: string[]
): Promise<Map<string, VersionCoverageSummary>> {
  const result = new Map<string, VersionCoverageSummary>();
  const ids = [...new Set(versionIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const supabase = await createSupabaseServerClient();

  const { data: extractions, error } = await supabase
    .from("document_extractions")
    .select("id,document_version_id,page_count,error_message,extractor,completed_at")
    .in("document_version_id", ids)
    .eq("status", "PROCESSED");

  if (error) throw error;

  const latest = new Map<string, NonNullable<typeof extractions>[number]>();
  for (const extraction of extractions ?? []) {
    const current = latest.get(extraction.document_version_id);
    if (!current || String(extraction.completed_at ?? "") > String(current.completed_at ?? "")) {
      latest.set(extraction.document_version_id, extraction);
    }
  }

  // Só extrações com controle de cobertura (OCR) têm marcadores.
  const tracked = [...latest.values()].filter(
    (extraction) =>
      String(extraction.error_message ?? "").startsWith("COBERTURA PARCIAL") ||
      String(extraction.extractor ?? "").includes("tesseract")
  );
  if (tracked.length === 0) return result;

  const pending = new Map<string, Set<number>>();
  const review = new Map<string, Set<number>>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: rows, error: segmentError } = await supabase
      .from("document_text_segments")
      .select("extraction_id,page_number,locator")
      .in(
        "extraction_id",
        tracked.map((extraction) => extraction.id)
      )
      .or("locator.like.*· PENDENTE:*,locator.like.*REVISAO_VISUAL*")
      .order("extraction_id", { ascending: true })
      .order("segment_index", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (segmentError) throw segmentError;

    for (const row of rows ?? []) {
      if (row.page_number == null) continue;
      if (row.locator?.includes("· PENDENTE:")) {
        (pending.get(row.extraction_id) ?? pending.set(row.extraction_id, new Set()).get(row.extraction_id)!).add(row.page_number);
      }
      if (row.locator?.includes("REVISAO_VISUAL")) {
        (review.get(row.extraction_id) ?? review.set(row.extraction_id, new Set()).get(row.extraction_id)!).add(row.page_number);
      }
    }
    if (!rows || rows.length < PAGE_SIZE) break;
  }

  for (const extraction of tracked) {
    const pendingPages = [...(pending.get(extraction.id) ?? [])].sort((a, b) => a - b);
    const visualReviewPages = [...(review.get(extraction.id) ?? [])].sort((a, b) => a - b);
    const partial = pendingPages.length > 0 || String(extraction.error_message ?? "").startsWith("COBERTURA PARCIAL");
    result.set(extraction.document_version_id, {
      documentVersionId: extraction.document_version_id,
      extractionId: extraction.id,
      totalPages: extraction.page_count,
      readPages: extraction.page_count != null ? extraction.page_count - pendingPages.length : null,
      pendingPages,
      visualReviewPages,
      partial,
    });
  }

  return result;
}
