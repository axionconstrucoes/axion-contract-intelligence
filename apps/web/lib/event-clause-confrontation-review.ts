import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import type { AiFindingType } from "@axion/types";
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
  categories: string[];
  requiresHumanReview: boolean;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
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
  requires_human_review: boolean;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

type ClauseRow = {
  id: string;
  clause_number: string;
  title: string;
  text: string;
};

const statusOrder: Record<ConfrontationCandidateStatus, number> = {
  PENDING_REVIEW: 0,
  APPROVED: 1,
  REJECTED: 2,
};

// O analisador (scripts/event-clause-confrontation-analyzer.mjs) calcula as
// categorias temáticas do confronto, mas não existe coluna dedicada para
// elas — hoje ficam embutidas na frase de `summary` gravada pelo RPC
// register_event_clause_confrontation_candidate. Extraímos aqui em vez de
// alterar o schema, já que o dado é reconstruível sem perda a partir do que
// já está persistido. Se o formato da frase mudar, o candidato apenas fica
// sem categorias exibidas (nunca quebra a página).
const CATEGORY_SUMMARY_PATTERN = /nas categorias ([A-Z_]+(?:,\s*[A-Z_]+)*)\.$/;

function extractCandidateCategories(candidate: CandidateRow): string[] {
  if (candidate.analyzer !== "event-clause-confrontation") {
    return [];
  }
  const match = candidate.summary.match(CATEGORY_SUMMARY_PATTERN);
  if (!match) {
    return [];
  }
  return match[1].split(",").map((category) => category.trim());
}

// Candidatos de confronto Evento x Cláusula vinculados a um evento, com os
// dados da cláusula já resolvidos para exibição. PENDING_REVIEW aparece
// primeiro; os demais permanecem visíveis para manter o histórico de revisão.
export async function getEventClauseConfrontationCandidates(
  eventId: string
): Promise<EventClauseConfrontationCandidate[]> {
  const supabase = await createSupabaseServerClient();

  const { data: candidateData, error: candidateError } = await supabase
    .from("event_clause_confrontation_candidates")
    .select(
      "id,event_id,clause_id,analyzer,analyzer_version,status,finding_type,severity,confidence,summary,event_basis,clause_basis,requires_human_review,reviewed_by_user_id,reviewed_at,review_note,created_at"
    )
    .eq("event_id", eventId);

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
    .select("id,clause_number,title,text")
    .in("id", clauseIds);

  if (clauseError) {
    throw new Error(`Falha ao carregar cláusulas do confronto: ${clauseError.message}`);
  }

  const clauseById = new Map((clauseData as unknown as ClauseRow[]).map((clause) => [clause.id, clause]));

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
        categories: extractCandidateCategories(candidate),
        requiresHumanReview: candidate.requires_human_review,
        reviewedByUserId: candidate.reviewed_by_user_id,
        reviewedAt: candidate.reviewed_at,
        reviewNote: candidate.review_note,
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
