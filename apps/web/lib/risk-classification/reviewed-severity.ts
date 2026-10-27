// Grau de risco EFETIVO = revisão humana mais recente (risk_classification_reviews) ou, sem
// revisão, a classificação original (IA/regra). Sem "server-only": recebe o client (usuário ou
// admin) e é usado por data.ts e pelos cron/mailers.
//
// Tolerância à migration ausente: enquanto 20261028120000 não estiver aplicada, a tabela não
// existe — nesse caso NADA muda (grau original), nunca uma página quebrada.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSeverity } from "@axion/types";

export type RiskSourceType = "CONTRACT_EVENT" | "DELIVERY_ITEM";

export interface RiskReviewRow {
  id: string;
  projectId: string;
  sourceType: RiskSourceType;
  sourceId: string;
  previousLevel: AlertSeverity | null;
  newLevel: AlertSeverity;
  suggestedLevel: AlertSeverity | null;
  justification: string;
  reference: string | null;
  origin: "REVISAO_HUMANA" | "ALTERACAO_DIRETA_PROVIDENCIA";
  reviewerUserId: string | null;
  createdAt: string;
}

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST200"]);

interface RawRow {
  id: string;
  project_id: string;
  source_type: RiskSourceType;
  source_id: string;
  previous_level: AlertSeverity | null;
  new_level: AlertSeverity;
  suggested_level: AlertSeverity | null;
  justification: string;
  reference: string | null;
  origin: RiskReviewRow["origin"];
  reviewer_user_id: string | null;
  created_at: string;
}

export const RISK_REVIEW_COLUMNS =
  "id,project_id,source_type,source_id,previous_level,new_level,suggested_level,justification,reference,origin,reviewer_user_id,created_at";

export function mapRiskReviewRow(row: RawRow): RiskReviewRow {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    previousLevel: row.previous_level,
    newLevel: row.new_level,
    suggestedLevel: row.suggested_level,
    justification: row.justification,
    reference: row.reference,
    origin: row.origin,
    reviewerUserId: row.reviewer_user_id,
    createdAt: row.created_at,
  };
}

/** Histórico (mais recente primeiro). Tabela ausente ⇒ lista vazia. */
export async function loadRiskReviews(
  client: SupabaseClient,
  input: { sourceType: RiskSourceType; sourceIds: readonly string[] }
): Promise<RiskReviewRow[]> {
  if (input.sourceIds.length === 0) return [];
  const { data, error } = await client
    .from("risk_classification_reviews")
    .select(RISK_REVIEW_COLUMNS)
    .eq("source_type", input.sourceType)
    .in("source_id", input.sourceIds as string[])
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code && MISSING_TABLE_CODES.has(error.code)) return [];
    throw new Error(`Falha ao carregar o histórico de classificação de risco: ${error.message}`);
  }
  return ((data ?? []) as RawRow[]).map(mapRiskReviewRow);
}

/** Revisão mais recente por origem (entrada: lista já em ordem decrescente de data). */
export function latestReviewBySource(reviews: readonly RiskReviewRow[]): Map<string, RiskReviewRow> {
  const latest = new Map<string, RiskReviewRow>();
  for (const review of reviews) if (!latest.has(review.sourceId)) latest.set(review.sourceId, review);
  return latest;
}

/** eventId → grau revisado (somente eventos que TÊM revisão). */
export async function loadReviewedEventSeverities(
  client: SupabaseClient,
  eventIds: readonly string[]
): Promise<Map<string, AlertSeverity>> {
  const reviews = await loadRiskReviews(client, { sourceType: "CONTRACT_EVENT", sourceIds: eventIds });
  return new Map(Array.from(latestReviewBySource(reviews)).map(([id, review]) => [id, review.newLevel]));
}

/**
 * Aplica o grau revisado aos eventos carregados: `aiAssessment.severity` passa a ser o EFETIVO e o
 * original é preservado em `originalSeverity`. Evento sem avaliação de IA não é alterado.
 */
export async function applyReviewedSeverity<T extends { id: string; aiAssessment: { severity: AlertSeverity; originalSeverity?: AlertSeverity } | null }>(
  client: SupabaseClient,
  events: T[]
): Promise<T[]> {
  const reviewed = await loadReviewedEventSeverities(client, events.map((event) => event.id));
  if (reviewed.size === 0) return events;
  return events.map((event) => {
    const level = reviewed.get(event.id);
    if (!level || !event.aiAssessment || level === event.aiAssessment.severity) return event;
    return { ...event, aiAssessment: { ...event.aiAssessment, severity: level, originalSeverity: event.aiAssessment.severity } };
  });
}
