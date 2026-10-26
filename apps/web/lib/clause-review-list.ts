import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { orderDocumentally } from "./clause-review-order";
import { withActiveDocumentFilter } from "./documents/active-document-filter";

// Lista compacta da revisão de cláusulas (todos os status) + detalhe do
// candidato selecionado. Só leitura: decisões (APPROVED/REJECTED)
// continuam exclusivas da RPC review_clause_extraction_candidate.

export type ClauseCandidateStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export type ClauseReviewListItem = {
  id: string;
  documentVersionId: string;
  documentTitle: string;
  versionLabel: string;
  number: string;
  title: string;
  status: ClauseCandidateStatus;
  confidence: number;
  section: string | null;
  hierarchy: string | null;
  startPage: number | null;
  endPage: number | null;
  flags: string[];
  searchText: string;
};

export type ClauseReviewDetail = ClauseReviewListItem & {
  detector: string;
  detectorVersion: string;
  proposedTitle: string;
  // Texto proposto SEM as linhas de metadado "[...]" do detector.
  proposedBody: string;
  metaLines: string[];
  locator: string | null;
  sourceText: string | null;
  sourceLocator: string | null;
  sourcePageNumber: number | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  clauseId: string | null;
};

export type ClauseReviewTotals = Record<ClauseCandidateStatus, number>;

type CandidateRow = {
  id: string;
  document_version_id: string;
  source_segment_id: string | null;
  detector: string;
  detector_version: string;
  status: ClauseCandidateStatus;
  confidence: number | string;
  proposed_clause_number: string;
  proposed_title: string;
  proposed_text: string;
  page_number: number | null;
  locator: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  clause_id: string | null;
};

const PAGE_SIZE = 1000;

export function splitCandidateText(text: string): { meta: string[]; body: string } {
  const lines = text.split("\n");
  const meta: string[] = [];
  while (lines.length > 0 && /^\[.*\]$/.test(lines[0].trim())) {
    meta.push(lines.shift()!.trim().slice(1, -1));
  }
  return { meta, body: lines.join("\n").trim() };
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function toListItem(
  row: CandidateRow,
  document: { title: string },
  version: { version_label: string }
): ClauseReviewListItem {
  const { meta, body } = splitCandidateText(row.proposed_text);
  const structure = meta.find((line) => line.startsWith("Estrutura decimal"));
  const section = structure?.match(/Parte ([A-Z])/u)?.[1] ?? null;
  const hierarchy = structure ? structure.split(" · ").slice(section ? 2 : 1).join(" · ") : null;
  const crossing = meta.find((line) => line.startsWith("Atravessa páginas"))?.match(/(\d+)–(\d+)/u);
  const flags = meta.filter((line) => line.startsWith("REVISAR:")).map((line) => line.replace(/^REVISAR:\s*/u, ""));

  return {
    id: row.id,
    documentVersionId: row.document_version_id,
    documentTitle: document.title,
    versionLabel: version.version_label,
    number: row.proposed_clause_number,
    title: row.proposed_title,
    status: row.status,
    confidence: Number(row.confidence),
    section,
    hierarchy,
    startPage: crossing ? Number(crossing[1]) : row.page_number,
    endPage: crossing ? Number(crossing[2]) : row.page_number,
    flags,
    searchText: fold(`${row.proposed_clause_number} ${row.proposed_title} ${body}`),
  };
}

async function loadScope(projectId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: documentData, error: documentError } = await withActiveDocumentFilter((filterActive) => {
    let query = supabase.from("documents").select("id,title,kind").eq("project_id", projectId);
    if (filterActive) query = query.is("deleted_at", null);
    return query;
  });
  if (documentError) {
    if (documentError.code === "22P02") return null;
    throw documentError;
  }
  const documents = (documentData ?? []) as Array<{ id: string; title: string; kind: string }>;
  if (documents.length === 0) return null;

  const { data: versionData, error: versionError } = await supabase
    .from("document_versions")
    .select("id,document_id,version_label")
    .in(
      "document_id",
      documents.map((document) => document.id)
    );
  if (versionError) throw versionError;
  const versions = (versionData ?? []) as Array<{ id: string; document_id: string; version_label: string }>;

  return {
    supabase,
    documentById: new Map(documents.map((document) => [document.id, document])),
    versionById: new Map(versions.map((version) => [version.id, version])),
  };
}

const CANDIDATE_COLUMNS =
  "id,document_version_id,source_segment_id,detector,detector_version,status,confidence,proposed_clause_number,proposed_title,proposed_text,page_number,locator,reviewed_at,review_note,clause_id";

export async function getClauseReviewList(
  projectId: string
): Promise<{ items: ClauseReviewListItem[]; totals: ClauseReviewTotals }> {
  const totals: ClauseReviewTotals = { PENDING_REVIEW: 0, APPROVED: 0, REJECTED: 0 };
  const scope = await loadScope(projectId);
  if (!scope || scope.versionById.size === 0) return { items: [], totals };

  const rows: CandidateRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await scope.supabase
      .from("clause_extraction_candidates")
      .select(CANDIDATE_COLUMNS)
      .in("document_version_id", [...scope.versionById.keys()])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as CandidateRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  // rows vêm em ordem de criação = ordem de detecção = ordem do texto.
  const byVersion = new Map<string, Array<{ item: ClauseReviewListItem; docIndex: number }>>();
  rows.forEach((row, docIndex) => {
    const version = scope.versionById.get(row.document_version_id);
    const document = version ? scope.documentById.get(version.document_id) : null;
    if (!version || !document) return;
    totals[row.status] = (totals[row.status] ?? 0) + 1;
    const list = byVersion.get(row.document_version_id) ?? [];
    list.push({ item: toListItem(row, document, version), docIndex });
    byVersion.set(row.document_version_id, list);
  });

  // Ordem: documento/versão → ordem documental com hierarquia numérica
  // (6.2 antes de 6.10; anomalias de numeração no lugar onde aparecem).
  const groups = [...byVersion.values()].sort(
    (a, b) =>
      a[0].item.documentTitle.localeCompare(b[0].item.documentTitle, "pt-BR") ||
      a[0].item.versionLabel.localeCompare(b[0].item.versionLabel, "pt-BR", { numeric: true })
  );
  const items = groups.flatMap((group) =>
    orderDocumentally(group, {
      label: (entry) => entry.item.number,
      docIndex: (entry) => entry.docIndex,
      isAnomaly: (entry) =>
        /\(\d+ª ocorrência\)/u.test(entry.item.number) ||
        entry.item.flags.some((flag) => flag.startsWith("NUMERACAO_INCONSISTENTE")),
    }).map((entry) => entry.item)
  );

  return { items, totals };
}

export async function getClauseReviewDetail(
  projectId: string,
  candidateId: string
): Promise<ClauseReviewDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(candidateId)) return null;
  const scope = await loadScope(projectId);
  if (!scope) return null;

  const { data, error } = await scope.supabase
    .from("clause_extraction_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as CandidateRow | null;
  if (!row) return null;

  const version = scope.versionById.get(row.document_version_id);
  const document = version ? scope.documentById.get(version.document_id) : null;
  if (!version || !document) return null; // outro projeto ou documento na lixeira

  let segment: { page_number: number | null; locator: string | null; text_content: string } | null = null;
  if (row.source_segment_id) {
    const { data: segmentData, error: segmentError } = await scope.supabase
      .from("document_text_segments")
      .select("page_number,locator,text_content")
      .eq("id", row.source_segment_id)
      .maybeSingle();
    if (segmentError) throw segmentError;
    segment = segmentData;
  }

  const { meta, body } = splitCandidateText(row.proposed_text);
  return {
    ...toListItem(row, document, version),
    detector: row.detector,
    detectorVersion: row.detector_version,
    proposedTitle: row.proposed_title,
    proposedBody: body,
    metaLines: meta,
    locator: row.locator,
    sourceText: segment?.text_content ?? null,
    sourceLocator: segment?.locator ?? null,
    sourcePageNumber: segment?.page_number ?? null,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    clauseId: row.clause_id,
  };
}
