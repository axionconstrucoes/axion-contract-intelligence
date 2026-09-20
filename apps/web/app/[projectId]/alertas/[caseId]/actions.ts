"use server";

// Ações formais do alerta (RESOLVIDO / TOMANDO PROVIDÊNCIAS / ENVIAR P/ /
// ESPECIALISTA / OUTRO / CONFIRMAR RESOLUÇÃO) — POST autenticado.
// Transição calculada pela máquina de estados (pura) e persistida pela
// RPC record_risk_alert_action (autorização, estado esperado,
// idempotência, um encaminhamento ativo, escalonamento imediato, outbox).
// Nenhum e-mail é enviado aqui; o worker envia a partir da outbox.
// Tokens de link do e-mail são revalidados (hash, expiração, dono) e
// marcados como usados — mas a ação NUNCA depende só do token.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";

import type { EmailRegistryActionState } from "@/app/[projectId]/documentos/emails/actions-state";
import { assertWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { hashActionToken, isActionTokenValid } from "@/lib/risk-alerts/action-links";
import { applyAlertAction, type AlertCaseSnapshot } from "@/lib/risk-alerts/alert-state-machine";
import { routeExpert } from "@/lib/risk-alerts/experts/route-alert-expert";
import { createSupabaseRiskAlertStore } from "@/lib/risk-alerts/supabase-store";
import type { AlertActionType } from "@/lib/risk-alerts/types";
import { resolveMatrixPolicy } from "@/lib/sla/resolve-matrix-policy";
import { getSlaAreaResponsibles, getSlaMatrixRules, getSlaProjectSettings } from "@/lib/sla/sla-actions-data";
import type { SlaRiskLevel } from "@/lib/sla/types";

const ACTIONS: AlertActionType[] = ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER", "RESOLUTION_CONFIRMED"];

function field(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value ? value : null;
}

export async function applyAlertActionAction(_prev: EmailRegistryActionState, formData: FormData): Promise<EmailRegistryActionState> {
  const supabase = await createSupabaseServerClient();
  try {
    assertWeeklyReportsEnabled();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Sessão expirada. Faça login novamente.");
    const projectId = field(formData, "projectId");
    const caseId = field(formData, "caseId");
    const action = field(formData, "action") as AlertActionType | null;
    if (!projectId || !caseId || !action || !ACTIONS.includes(action)) throw new Error("Ação inválida.");

    // Sessão (RLS) para leitura: só membro do projeto enxerga o alerta.
    const store = createSupabaseRiskAlertStore(supabase);
    const loaded = await store.loadCaseSnapshotForAction(caseId);
    if (!loaded || loaded.snapshot.projectId !== projectId) throw new Error("Alerta não encontrado.");

    const [rules, responsibles, settings, { data: config }, { data: members }, { data: profiles }] = await Promise.all([
      getSlaMatrixRules(projectId),
      getSlaAreaResponsibles(projectId),
      getSlaProjectSettings(projectId),
      supabase.from("project_weekly_schedule_ingestion_configs").select("enabled,risk_alerts_enabled,pilot_recipient_allowlist_user_ids,sender_domain,risk_alert_severity_map,pilot_project_confirmed_at").eq("project_id", projectId).maybeSingle(),
      supabase.from("project_memberships").select("user_id,status").eq("project_id", projectId),
      supabase.from("profiles").select("id,name,email"),
    ]);
    const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    const recipients = new Map((members ?? []).map((m) => [m.user_id as string, { userId: m.user_id as string, name: (profileById.get(m.user_id as string)?.name as string | null) ?? null, email: (profileById.get(m.user_id as string)?.email as string | null) ?? null, membershipStatus: m.status as string }]));
    const corporateDomain = ((config?.sender_domain as string | null) ?? "axion.com.br").toLowerCase();
    const eligibleForwardUserIds = (members ?? [])
      .filter((m) => m.status === "ACTIVE" && m.user_id !== auth.user!.id)
      .map((m) => m.user_id as string)
      .filter((id) => ((profileById.get(id)?.email as string | null) ?? "").toLowerCase().split("@")[1] === corporateDomain);

    const riskLevel = loaded.snapshot.riskLevel as SlaRiskLevel;
    const policy = resolveMatrixPolicy({ rules, responsibles, settings, area: loaded.record.area, riskLevel });
    // ESPECIALISTA: a escolha explícita do dropdown prevalece; a decisão
    // (temas, confiança, sugerido × confirmado) é auditada com o evento.
    const expertRouting = action === "EXPERT_CONSULTATION" ? routeExpert({ question: field(formData, "question") ?? "", selectedExpertId: field(formData, "expertId") }) : null;
    if (expertRouting?.reviewRequired) return { error: "Selecione o Expert: o tema da pergunta não foi identificado com confiança suficiente.", success: false, message: null };
    const transition = applyAlertAction({
      now: new Date().toISOString(),
      snapshot: loaded.snapshot as AlertCaseSnapshot,
      action,
      actorUserId: auth.user.id,
      origin: "WEB",
      payload: {
        text: field(formData, "text"),
        justification: field(formData, "justification"),
        evidence: field(formData, "evidence"),
        forecastAt: field(formData, "forecastAt"),
        targetUserId: field(formData, "targetUserId"),
        expertId: expertRouting?.expertId ?? null,
        expertRouting: expertRouting ? { ...expertRouting } : null,
        question: field(formData, "question"),
        confirmed: formData.get("confirmed") === "on" || formData.get("confirmed") === "true",
      },
      policy,
      config: {
        enabled: Boolean(config?.enabled),
        riskAlertsEnabled: Boolean(config?.risk_alerts_enabled),
        pilotRecipientAllowlistUserIds: (config?.pilot_recipient_allowlist_user_ids as string[] | null) ?? null,
        senderDomain: (config?.sender_domain as string | null) ?? null,
        severityMap: (config?.risk_alert_severity_map as Record<string, SlaRiskLevel> | null) ?? null,
        pilotProjectConfirmedAt: (config?.pilot_project_confirmed_at as string | null) ?? null,
      },
      recipients,
      eligibleForwardUserIds,
    });
    if (!transition.ok) return { error: transition.message, success: false, message: null };

    // Token do link (opcional): pré-checado aqui (mensagem amigável) e
    // consumido pela RPC (hash, dono, ação, validade, uso único — atômico
    // com a ação). Nunca é a autorização.
    const token = field(formData, "token");
    const tokenHash = token ? hashActionToken(token) : null;
    if (tokenHash) {
      const { data: link } = await supabase.from("risk_alert_action_links").select("id,expires_at,used_at,action_type").eq("token_hash", tokenHash).eq("case_id", caseId).eq("recipient_user_id", auth.user.id).maybeSingle();
      if (!link || !isActionTokenValid({ expiresAt: link.expires_at as string, usedAt: (link.used_at as string | null) ?? null }, new Date().toISOString()) || link.action_type !== action) {
        return { error: "Link de ação expirado ou inválido. Use os botões da própria página.", success: false, message: null };
      }
    }

    const outcome = await store.applyTransition(caseId, transition, auth.user.id, { actionLinkTokenHash: tokenHash });
    revalidatePath(`/${projectId}/alertas/${caseId}`);
    revalidatePath(`/${projectId}/acoes`);
    return { error: null, success: true, message: `${transition.summary}. Estado: ${outcome.state}.${transition.escalation ? ` Escalonamento imediato para ${transition.escalation.toLevel} registrado.` : ""}${transition.topLevelReached ? " Nível máximo já atingido (Diretoria informada)." : ""}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao registrar ação.", success: false, message: null };
  }
}
