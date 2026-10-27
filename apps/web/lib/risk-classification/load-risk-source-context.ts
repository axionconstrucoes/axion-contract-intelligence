import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSeverity } from "@axion/types";

import { loadEventAlertContexts } from "@/lib/alerts/load-event-alert-context";

import { deadlineStatusFromDate } from "./facts-builders";
import { loadRiskReviews, type RiskReviewRow, type RiskSourceType } from "./reviewed-severity";
import type { DeadlineStatus, SourceRef } from "./suggest-risk";

// Contexto de classificação de UM alerta/providência, lido SEMPRE no servidor e conferido contra a
// obra da rota: o navegador nunca entrega cláusula, evidência ou prazo. Sem vínculo verificável o
// campo fica vazio (a sugestão então pede a confirmação) — nunca é inferido.

export interface RiskSourceContext {
  sourceType: RiskSourceType;
  sourceId: string;
  projectId: string;
  title: string;
  /** Grau efetivo: revisão humana mais recente ou, sem revisão, o original (IA/tabela). */
  currentLevel: AlertSeverity | null;
  /** Grau original (IA em eventos; sem revisão = o mesmo que o efetivo). */
  originalLevel: AlertSeverity | null;
  verifiedClause: SourceRef | null;
  obligationDescription: string | null;
  evidence: SourceRef[];
  /** Único prazo que o ACC calcula sozinho (providências); eventos não têm prazo cadastrado. */
  deadline: { status: DeadlineStatus; date: string | null; ref: SourceRef | null };
  history: RiskReviewRow[];
}

export async function loadRiskSourceContext(
  supabase: SupabaseClient,
  input: { projectId: string; sourceType: RiskSourceType; sourceId: string; today: string }
): Promise<RiskSourceContext | null> {
  const { projectId, sourceType, sourceId, today } = input;
  const history = await loadRiskReviews(supabase, { sourceType, sourceIds: [sourceId] });
  const latest = history[0] ?? null;

  if (sourceType === "CONTRACT_EVENT") {
    const [{ data: event }, { data: assessment }, contexts] = await Promise.all([
      supabase.from("contract_events").select("id,project_id,title").eq("id", sourceId).maybeSingle(),
      supabase.from("event_ai_assessments").select("severity").eq("event_id", sourceId).maybeSingle(),
      loadEventAlertContexts(supabase, [sourceId], ""),
    ]);
    // A obra vem do registro: evento de outra obra nunca é tratado como desta.
    if (!event || event.project_id !== projectId) return null;
    const context = contexts.get(sourceId);
    const original = (assessment?.severity as AlertSeverity | undefined) ?? null;
    const evidence: SourceRef[] = [];
    for (const item of context?.evidence ?? []) {
      if (typeof item === "string") continue; // sem origem verificável ("Pendente de confirmação")
      const label = "label" in item ? item.label : "subject" in item ? item.subject : "Evidência";
      evidence.push({ kind: "EVIDENCIA", label, url: item.url ?? null });
    }
    return {
      sourceType,
      sourceId,
      projectId,
      title: event.title as string,
      currentLevel: latest?.newLevel ?? original,
      originalLevel: original,
      verifiedClause: context?.clause ? { kind: "CLAUSULA", label: context.clause.label, url: `/${projectId}/revisao-clausulas` } : null,
      obligationDescription: context?.clause?.text ?? null,
      evidence,
      deadline: { status: "DESCONHECIDO", date: null, ref: null },
      history,
    };
  }

  const { data: item } = await supabase
    .from("project_delivery_items")
    .select("id,project_id,title,deadline,evidence,risk")
    .eq("id", sourceId)
    .maybeSingle();
  if (!item || item.project_id !== projectId) return null;
  const deadline = item.deadline ? String(item.deadline).slice(0, 10) : null;
  const risk = (item.risk as AlertSeverity | null) ?? null;
  const itemRef: SourceRef = { kind: "PROVIDENCIA", label: `Providência: ${item.title as string}`, url: `/${projectId}/providencias#item-${sourceId}` };
  return {
    sourceType,
    sourceId,
    projectId,
    title: item.title as string,
    currentLevel: risk,
    originalLevel: history.length > 0 ? (history[history.length - 1].previousLevel ?? null) : risk,
    verifiedClause: null, // providências não têm vínculo cláusula↔obrigação cadastrado
    obligationDescription: null,
    evidence: item.evidence ? [{ kind: "EVIDENCIA", label: String(item.evidence), url: itemRef.url }] : [],
    deadline: { status: deadlineStatusFromDate(deadline, today), date: deadline, ref: deadline ? { ...itemRef, kind: "PRAZO", label: `Prazo da providência: ${deadline}` } : null },
    history,
  };
}
