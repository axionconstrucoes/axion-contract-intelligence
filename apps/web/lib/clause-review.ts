import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { withActiveDocumentFilter } from "./documents/active-document-filter";

export type ClauseReviewCandidate = {
  id: string;
  documentVersionId: string;
  sourceSegmentId: string | null;

  detector: string;
  detectorVersion: string;

  confidence: number;

  proposedClauseNumber: string;
  proposedTitle: string;
  proposedText: string;

  pageNumber: number | null;
  locator: string | null;

  createdAt: string;

  documentId: string;
  documentTitle: string;
  documentKind: string;

  versionLabel: string;
  originalFileName: string | null;

  sourceText: string | null;
  sourceLocator: string | null;
  sourcePageNumber: number | null;
};

type DocumentRow = {
  id: string;
  title: string;
  kind: string;
};

type VersionRow = {
  id: string;
  document_id: string;
  version_label: string;
  original_file_name: string | null;
};

type CandidateRow = {
  id: string;
  document_version_id: string;
  source_segment_id: string | null;
  detector: string;
  detector_version: string;
  confidence: number | string;
  proposed_clause_number: string;
  proposed_title: string;
  proposed_text: string;
  page_number: number | null;
  locator: string | null;
  created_at: string;
};

type SegmentRow = {
  id: string;
  page_number: number | null;
  locator: string | null;
  text_content: string;
};

export async function getClauseReviewCandidates(
  projectId: string
): Promise<ClauseReviewCandidate[]> {
  const supabase =
    await createSupabaseServerClient();

  // Regra CANÔNICA — candidatos de extração de um documento na lixeira
  // nunca aparecem na revisão de cláusulas.
  const {
    data: documentData,
    error: documentError,
  } = await withActiveDocumentFilter((filterActive) => {
    let query = supabase.from("documents").select("id,title,kind").eq("project_id", projectId);
    if (filterActive) query = query.is("deleted_at", null);
    return query;
  });

  if (documentError) {
    if (documentError.code === "22P02") {
      return [];
    }

    throw documentError;
  }

  const documents =
    (documentData ?? []) as unknown as DocumentRow[];

  if (documents.length === 0) {
    return [];
  }

  const documentById =
    new Map(
      documents.map(
        (document) => [
          document.id,
          document,
        ]
      )
    );

  const {
    data: versionData,
    error: versionError,
  } = await supabase
    .from("document_versions")
    .select(
      "id,document_id,version_label,original_file_name"
    )
    .in(
      "document_id",
      documents.map(
        (document) => document.id
      )
    );

  if (versionError) {
    throw versionError;
  }

  const versions =
    (versionData ?? []) as unknown as VersionRow[];

  if (versions.length === 0) {
    return [];
  }

  const versionById =
    new Map(
      versions.map(
        (version) => [
          version.id,
          version,
        ]
      )
    );

  const {
    data: candidateData,
    error: candidateError,
  } = await supabase
    .from(
      "clause_extraction_candidates"
    )
    .select(
      "id,document_version_id,source_segment_id,detector,detector_version,confidence,proposed_clause_number,proposed_title,proposed_text,page_number,locator,created_at"
    )
    .in(
      "document_version_id",
      versions.map(
        (version) => version.id
      )
    )
    .eq(
      "status",
      "PENDING_REVIEW"
    )
    .order(
      "confidence",
      {
        ascending: false,
      }
    )
    .order(
      "created_at",
      {
        ascending: true,
      }
    );

  if (candidateError) {
    throw candidateError;
  }

  const candidates =
    (candidateData ?? []) as unknown as CandidateRow[];

  if (candidates.length === 0) {
    return [];
  }

  const segmentIds =
    candidates
      .map(
        (candidate) =>
          candidate.source_segment_id
      )
      .filter(
        (id): id is string =>
          Boolean(id)
      );

  const segmentById =
    new Map<string, SegmentRow>();

  if (segmentIds.length > 0) {
    const {
      data: segmentData,
      error: segmentError,
    } = await supabase
      .from(
        "document_text_segments"
      )
      .select(
        "id,page_number,locator,text_content"
      )
      .in(
        "id",
        segmentIds
      );

    if (segmentError) {
      throw segmentError;
    }

    for (
      const segment of
        (segmentData ?? []) as unknown as SegmentRow[]
    ) {
      segmentById.set(
        segment.id,
        segment
      );
    }
  }

  return candidates
    .map((candidate) => {
      const version =
        versionById.get(
          candidate.document_version_id
        );

      if (!version) {
        return null;
      }

      const document =
        documentById.get(
          version.document_id
        );

      if (!document) {
        return null;
      }

      const segment =
        candidate.source_segment_id
          ? segmentById.get(
              candidate.source_segment_id
            )
          : null;

      return {
        id: candidate.id,

        documentVersionId:
          candidate.document_version_id,

        sourceSegmentId:
          candidate.source_segment_id,

        detector:
          candidate.detector,

        detectorVersion:
          candidate.detector_version,

        confidence:
          Number(
            candidate.confidence
          ),

        proposedClauseNumber:
          candidate.proposed_clause_number,

        proposedTitle:
          candidate.proposed_title,

        proposedText:
          candidate.proposed_text,

        pageNumber:
          candidate.page_number,

        locator:
          candidate.locator,

        createdAt:
          candidate.created_at,

        documentId:
          document.id,

        documentTitle:
          document.title,

        documentKind:
          document.kind,

        versionLabel:
          version.version_label,

        originalFileName:
          version.original_file_name,

        sourceText:
          segment?.text_content ??
          null,

        sourceLocator:
          segment?.locator ??
          null,

        sourcePageNumber:
          segment?.page_number ??
          null,
      };
    })
    .filter(
      (
        candidate
      ): candidate is ClauseReviewCandidate =>
        candidate !== null
    );
}
