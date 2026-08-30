import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import type { AiFindingType } from "@axion/types";
import { resolveNonTrashedDocumentIds } from "@/lib/documents/active-document-filter";
import type { ConfrontationCandidateSeverity, ConfrontationCandidateStatus } from "@/lib/labels";

export type EventClauseConfrontationCandidate = {
  id: string;
  eventId: string;
  clauseId: string;
  analyzer: string;
  analyzerVersion: string;
  status: ConfrontationCandidateStatus;
  findingType: AiFindingType;
  severity: ConfrontationCandidateSeverity;
  confidence: number;
  summary: string;
  eventBasis: string;
  clauseBasis: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  // Emenda de review_note em candidato já revisado (migration
  // 20260828150000, NÃO aplicada nesta etapa) — nunca confundida com a
  // autoria original acima. Ambas nulas quando a nota nunca foi emendada.
  reviewNoteAmendedByUserId: string | null;
  reviewNoteAmendedAt: string | null;
  createdAt: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
};

type CandidateRow = {
  id: string;
  event_id: string;
  clause_id: string;
  analyzer: string;
  analyzer_version: string;
  status: ConfrontationCandidateStatus;
  finding_type: AiFindingType;
  severity: ConfrontationCandidateSeverity;
  confidence: number | string;
  summary: string;
  event_basis: string;
  clause_basis: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  review_note_amended_by_user_id?: string | null;
  review_note_amended_at?: string | null;
  created_at: string;
};

type ClauseRow = {
  id: string;
  clause_number: string;
  title: string;
  text: string;
  document_version_id: string;
};

const statusOrder: Record<ConfrontationCandidateStatus, number> = {
  PENDING_REVIEW: 0,
  APPROVED: 1,
  REJECTED: 2,
};

// Candidatos de confronto Evento x Cláusula vinculados a um evento, com os
// dados da cláusula já resolvidos para exibição. PENDING_REVIEW aparece
// primeiro; os demais permanecem visíveis para manter o histórico de revisão.
export async function getEventClauseConfrontationCandidates(
  eventId: string
): Promise<EventClauseConfrontationCandidate[]> {
  const supabase = await createSupabaseServerClient();

  const BASE_COLUMNS =
    "id,event_id,clause_id,analyzer,analyzer_version,status,finding_type,severity,confidence,summary,event_basis,clause_basis,reviewed_by_user_id,reviewed_at,review_note,created_at";
  // review_note_amended_by_user_id/review_note_amended_at vêm da migration
  // 20260828150000 (RPC amend_event_clause_confrontation_review_note) —
  // ainda NÃO aplicada em nenhum ambiente nesta etapa. 42703
  // (undefined_column) é tratado como "nenhuma emenda ainda possível
  // neste ambiente", nunca quebra a tela — mesmo padrão já usado por
  // getProjectMemberInvitations (lib/data.ts) para 42P01/migration
  // pendente.
  const fullResult = await supabase
    .from("event_clause_confrontation_candidates")
    .select(`${BASE_COLUMNS},review_note_amended_by_user_id,review_note_amended_at`)
    .eq("event_id", eventId);

  const fallbackResult =
    fullResult.error?.code === "42703"
      ? await supabase.from("event_clause_confrontation_candidates").select(BASE_COLUMNS).eq("event_id", eventId)
      : null;

  const candidateData: unknown = fallbackResult ? fallbackResult.data : fullResult.data;
  const candidateError = fallbackResult ? fallbackResult.error : fullResult.error;

  if (candidateError) {
    if (candidateError.code === "22P02") {
      return [];
    }
    // Nunca lançar o objeto de erro do PostgREST diretamente: em um Server
    // Component isso vira "Runtime Error [object Object]" no Next.js, sem
    // nenhuma informação útil para diagnóstico.
    throw new Error(
      `Falha ao carregar candidatos de confrontação Evento x Cláusula: ${candidateError.message}`
    );
  }

  const candidates = (candidateData ?? []) as unknown as CandidateRow[];
  if (candidates.length === 0) {
    return [];
  }

  const clauseIds = Array.from(new Set(candidates.map((candidate) => candidate.clause_id)));

  const { data: clauseData, error: clauseError } = await supabase
    .from("clauses")
    .select("id,clause_number,title,text,document_version_id")
    .in("id", clauseIds);

  if (clauseError) {
    throw new Error(`Falha ao carregar cláusulas do confronto: ${clauseError.message}`);
  }

  const fetchedClauses = clauseData as unknown as ClauseRow[];

  // Regra CANÔNICA — um candidato de confronto cuja cláusula pertence a
  // um documento na lixeira nunca aparece na revisão (mesmo caminho de
  // "cláusula não encontrada" já usado logo abaixo, nunca uma segunda
  // regra divergente).
  const versionIds = Array.from(new Set(fetchedClauses.map((clause) => clause.document_version_id)));
  let documentIdByVersionId = new Map<string, string>();
  if (versionIds.length > 0) {
    const { data: versionData, error: versionError } = await supabase
      .from("document_versions")
      .select("id,document_id")
      .in("id", versionIds);
    if (versionError) {
      throw new Error(`Falha ao carregar versões de documento do confronto: ${versionError.message}`);
    }
    documentIdByVersionId = new Map(
      (versionData as unknown as { id: string; document_id: string }[]).map((v) => [v.id, v.document_id])
    );
  }
  const candidateDocumentIds = Array.from(new Set(Array.from(documentIdByVersionId.values())));
  const nonTrashedDocumentIds = await resolveNonTrashedDocumentIds(supabase, candidateDocumentIds);

  const clauseById = new Map(
    fetchedClauses
      .filter((clause) => {
        const documentId = documentIdByVersionId.get(clause.document_version_id);
        return documentId ? nonTrashedDocumentIds.has(documentId) : false;
      })
      .map((clause) => [clause.id, clause])
  );

  return candidates
    .map((candidate) => {
      const clause = clauseById.get(candidate.clause_id);
      if (!clause) {
        return null;
      }

      return {
        id: candidate.id,
        eventId: candidate.event_id,
        clauseId: candidate.clause_id,
        analyzer: candidate.analyzer,
        analyzerVersion: candidate.analyzer_version,
        status: candidate.status,
        findingType: candidate.finding_type,
        severity: candidate.severity,
        confidence: Number(candidate.confidence),
        summary: candidate.summary,
        eventBasis: candidate.event_basis,
        clauseBasis: candidate.clause_basis,
        reviewedByUserId: candidate.reviewed_by_user_id,
        reviewedAt: candidate.reviewed_at,
        reviewNote: candidate.review_note,
        reviewNoteAmendedByUserId: candidate.review_note_amended_by_user_id ?? null,
        reviewNoteAmendedAt: candidate.review_note_amended_at ?? null,
        createdAt: candidate.created_at,
        clauseNumber: clause.clause_number,
        clauseTitle: clause.title,
        clauseText: clause.text,
      } satisfies EventClauseConfrontationCandidate;
    })
    .filter((candidate): candidate is EventClauseConfrontationCandidate => candidate !== null)
    .sort((a, b) => {
      const byStatus = statusOrder[a.status] - statusOrder[b.status];
      if (byStatus !== 0) {
        return byStatus;
      }
      return b.confidence - a.confidence;
    });
}
