// Deliberadamente SEM "server-only" (mesmo padrão de
// templates/contract-alert-template.ts e fixture-safety-guard.ts):
// recebe o client (nunca o cria sozinho, nunca lê env/secret aqui
// dentro), por isso pode ser testado ponta a ponta por um script Node
// standalone contra um Postgres real — nunca só simulado.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSeverity } from "@axion/types";
import { deriveScheduleDelaySeverity } from "./derive-schedule-delay-severity";
import type { ScheduleRecoverabilityAssessment } from "./types";

// Serviço EXPLÍCITO e AUDITÁVEL que conecta o resultado estruturado do
// Diretor de Planejamento IA (ScheduleRecoverabilityAssessment) à
// severidade EFETIVA de um evento real — o elo que faltava (Bloco 8):
// deriveScheduleDelaySeverity() já existia, mas nunca era chamada por
// nenhum caminho real, só pelo gerador de prévia de e-mail (fixture
// DUX). Esta função é chamada pelo fluxo real de análise (ver
// run-multi-expert-curation.ts) — nunca só pelo preview.
//
// public.event_ai_assessments tem UNIQUE(event_id) — sempre no máximo
// 1 linha por evento; por isso "preservar a maior severidade" aqui
// significa: ler a severidade JÁ GRAVADA para este evento (se houver)
// e usá-la como piso antes de aplicar a regra do Bloco 3
// (deriveScheduleDelaySeverity já faz o max() internamente — nunca
// reimplementado aqui).
//
// Sem policy de INSERT/UPDATE para event_ai_assessments sob RLS normal
// (só SELECT) — por isso exige um client admin (mesmo padrão de
// send-contract-alert-email.ts para emails/audit_log_entries).

export interface ApplyScheduleDelayAssessmentInput {
  projectId: string;
  eventId: string;
  recoverability: ScheduleRecoverabilityAssessment | null;
  /** Rótulo do responsável pela avaliação — sempre o Expert IA nesta fase (nunca um humano fabricado). */
  assessedByLabel: string;
}

export interface ApplyScheduleDelayAssessmentResult {
  previousSeverity: AlertSeverity | null;
  newSeverity: AlertSeverity;
  requiresHumanDecision: boolean;
  reason: string;
}

/**
 * Aplica a regra do risco CRÍTICO (Bloco 3) a um evento real: lê a
 * severidade atual (se já houver uma linha), deriva a nova severidade
 * de forma determinística e nunca-rebaixante, grava em
 * event_ai_assessments (upsert por event_id) e registra 1 linha de
 * auditoria com evidências/justificativa/confiança/responsável/data —
 * tudo rastreável, nada silencioso.
 */
export async function applyScheduleDelayAssessmentToEvent(
  admin: SupabaseClient,
  input: ApplyScheduleDelayAssessmentInput
): Promise<ApplyScheduleDelayAssessmentResult> {
  const { data: existing, error: readError } = await admin
    .from("event_ai_assessments")
    .select("severity")
    .eq("event_id", input.eventId)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  const previousSeverity = (existing?.severity as AlertSeverity | undefined) ?? null;

  const { severity, requiresHumanDecision, reason } = deriveScheduleDelaySeverity(
    input.recoverability,
    previousSeverity ?? "BAIXA"
  );

  const confidence = input.recoverability
    ? input.recoverability.classification === "INCERTA"
      ? 0.4
      : 0.85
    : 0.2;

  // "Evidência/justificativa/confiança/responsável/data" rastreáveis —
  // event_ai_assessments não tem colunas dedicadas para cada um
  // (schema real, ainda não migrado para um formato mais rico), então
  // são codificados de forma compacta e legível dentro de `summary`
  // (mesmo padrão já usado em audit_log_entries.detail nas migrations
  // de lixeira desta rodada) — nunca perdidos, sempre auditáveis.
  const evidenceLines = input.recoverability
    ? Object.entries(input.recoverability.evidence)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `${key}: ${value}`)
    : [];

  const summary = [
    `Avaliação de recuperabilidade de atraso de cronograma — ${reason}`,
    input.recoverability ? `Justificativa: ${input.recoverability.justification}` : null,
    evidenceLines.length > 0 ? `Evidências: ${evidenceLines.join(" | ")}` : null,
    `Responsável pela avaliação: ${input.assessedByLabel}`,
    `Data da avaliação: ${input.recoverability?.assessedAt ?? new Date().toISOString()}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const { error: writeError } = await admin.from("event_ai_assessments").upsert(
    {
      event_id: input.eventId,
      finding_type: "DESVIO",
      severity,
      summary,
      confidence,
      requires_human_review: true,
    },
    { onConflict: "event_id" }
  );

  if (writeError) {
    throw writeError;
  }

  // actor_type='SYSTEM' exige actor_label NULL (mesma convenção de
  // audit_log_entries em toda a base — LEGACY é quem usa actor_label,
  // nunca SYSTEM) — "responsável pela avaliação" entra no texto do
  // detail, nunca na coluna de ator.
  const { error: auditError } = await admin.from("audit_log_entries").insert({
    project_id: input.projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action: "SCHEDULE_DELAY_SEVERITY_ASSESSED",
    entity_type: "CONTRACT_EVENT",
    entity_id: input.eventId,
    detail: `Severidade de atraso de cronograma avaliada por ${input.assessedByLabel}: ${previousSeverity ?? "(nenhuma anterior)"} -> ${severity}. ${reason}`,
  });

  if (auditError) {
    throw auditError;
  }

  return { previousSeverity, newSeverity: severity, requiresHumanDecision, reason };
}
