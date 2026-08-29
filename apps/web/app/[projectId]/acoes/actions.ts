"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@axion/db/admin";
import { createSupabaseServerClient } from "@axion/db/server";

import { getAppBaseUrl } from "@/lib/app-base-url";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { issueEmailAlertActionButtons } from "@/lib/email-actions/issue-tokens";
import { EmailSendError } from "@/lib/email/email-provider";
import { sendSlaEscalationEmail } from "@/lib/email/send-sla-escalation-email";
import { getProject } from "@/lib/data";
import { computeEscalation } from "@/lib/sla/compute-escalation";
import { computeSlaDeadlines } from "@/lib/sla/compute-deadlines";
import { resolveBusinessHoursConfig, resolveMatrixRule } from "@/lib/sla/resolve-matrix-rule";
import { formatSlaMatrixRuleAuditDetail, validateSlaMatrixRuleValues } from "@/lib/sla/validate-matrix-rule";
import { formatDurationBetween } from "@/lib/sla/format-duration";
import { buildSlaActionUrl } from "@/lib/sla/build-action-url";
import {
  getSlaActions,
  getSlaAreaResponsibles,
  getSlaMatrixRules,
  getSlaProjectSettings,
} from "@/lib/sla/sla-actions-data";
import type { SlaArea, SlaEscalationLevel, SlaRiskLevel } from "@/lib/sla/types";
import type {
  AssumeSlaActionState,
  CompleteSlaActionState,
  ConfigureSlaMatrixState,
  ConfigureSlaProjectSettingsState,
  ConfigureSlaResponsiblesState,
  CreateSlaActionState,
  ProcessSlaEscalationsState,
  ReassignSlaActionState,
  StartSlaActionState,
} from "./actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipos e estados iniciais vivem em ./actions-state.ts.

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function requiredField(formData: FormData, name: string): string {
  const value = optionalField(formData, name);
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

const RISK_LEVEL_TO_ALERT_SEVERITY: Record<SlaRiskLevel, "BAIXA" | "MEDIA" | "ALTA" | "CRITICA"> = {
  LOW: "BAIXA",
  MEDIUM: "MEDIA",
  HIGH: "ALTA",
  CRITICAL: "CRITICA",
};

const ESCALATION_LEVEL_LABELS: Record<SlaEscalationLevel, string> = {
  RESPONSAVEL: "Responsável",
  ESCALAO_1: "1º Escalão",
  ESCALAO_2: "2º Escalão",
  DIRETORIA: "Diretoria",
};

// ---------------- Criar ação ----------------

// A ação nasce sujeita à matriz: os três prazos do Relógio B são
// calculados aqui, uma única vez, a partir da regra resolvida
// (projeto > default) — nunca recalculados "para trás" se a matriz mudar
// depois (ver migration, colunas assume_due_at/respond_due_at/complete_due_at).
export async function createSlaActionAction(
  _prevState: CreateSlaActionState,
  formData: FormData
): Promise<CreateSlaActionState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const title = requiredField(formData, "title");
    const description = optionalField(formData, "description") ?? "";
    const riskLevel = requiredField(formData, "riskLevel") as SlaRiskLevel;
    const area = requiredField(formData, "area") as SlaArea;
    const contractualDeadlineRaw = optionalField(formData, "contractualDeadline");
    const origin = (optionalField(formData, "origin") ?? "MANUAL") as
      | "MANUAL"
      | "EXPERT_RECOMMENDATION"
      | "ESG_OBLIGATION"
      | "EVENT"
      | "ACTION_REQUEST"
      | "OTHER";
    const originExpertId = origin === "EXPERT_RECOMMENDATION" ? optionalField(formData, "originExpertId") : null;
    const relatedEventId = optionalField(formData, "relatedEventId");
    const relatedDocumentVersionId = optionalField(formData, "relatedDocumentVersionId");
    const relatedEsgObligationSubmissionId = optionalField(formData, "relatedEsgObligationSubmissionId");
    const relatedActionRequestId = optionalField(formData, "relatedActionRequestId");

    const [matrixRules, areaResponsibles, projectSettings] = await Promise.all([
      getSlaMatrixRules(projectId),
      getSlaAreaResponsibles(projectId),
      getSlaProjectSettings(projectId),
    ]);

    const rule = resolveMatrixRule(matrixRules, riskLevel, area);
    const businessHoursConfig = resolveBusinessHoursConfig(projectSettings);
    const createdAt = new Date().toISOString();
    const deadlines = computeSlaDeadlines(createdAt, rule, businessHoursConfig);

    const responsibleUserId =
      areaResponsibles.find((r) => r.area === area)?.responsibleDirectUserId ?? null;

    const { error } = await supabase.from("sla_actions").insert({
      project_id: projectId,
      origin,
      origin_expert_id: originExpertId,
      title,
      description,
      risk_level: riskLevel,
      area,
      responsible_user_id: responsibleUserId,
      contractual_deadline: contractualDeadlineRaw,
      assume_due_at: deadlines.assumeDueAt,
      respond_due_at: deadlines.respondDueAt,
      complete_due_at: deadlines.completeDueAt,
      related_event_id: relatedEventId,
      related_document_version_id: relatedDocumentVersionId,
      related_esg_obligation_submission_id: relatedEsgObligationSubmissionId,
      related_action_request_id: relatedActionRequestId,
      created_by_type: "USER",
      created_by_user_id: authData.user.id,
    });

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/acoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao criar ação.", success: false };
  }
}

// ---------------- Assumir ação ----------------

export async function assumeSlaActionAction(
  _prevState: AssumeSlaActionState,
  formData: FormData
): Promise<AssumeSlaActionState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const actionId = requiredField(formData, "actionId");

    // "Isso interrompe apenas o SLA de assumir, não necessariamente o
    // prazo de conclusão" (seção 8) — por isso status vira ACKNOWLEDGED,
    // nunca IN_PROGRESS/COMPLETED aqui.
    const { error } = await supabase
      .from("sla_actions")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by_user_id: authData.user.id,
        status: "ACKNOWLEDGED",
      })
      .eq("id", actionId);

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/acoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao assumir ação.", success: false };
  }
}

// ---------------- Iniciar ação ----------------

export async function startSlaActionAction(
  _prevState: StartSlaActionState,
  formData: FormData
): Promise<StartSlaActionState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const actionId = requiredField(formData, "actionId");

    const { error } = await supabase.from("sla_actions").update({ status: "IN_PROGRESS" }).eq("id", actionId);

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/acoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao iniciar ação.", success: false };
  }
}

// ---------------- Concluir ação ----------------

export async function completeSlaActionAction(
  _prevState: CompleteSlaActionState,
  formData: FormData
): Promise<CompleteSlaActionState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const actionId = requiredField(formData, "actionId");
    const completionNote = requiredField(formData, "completionNote");
    const relatedEventId = optionalField(formData, "relatedEventId");
    const relatedDocumentVersionId = optionalField(formData, "relatedDocumentVersionId");

    const updates: Record<string, unknown> = {
      completed_at: new Date().toISOString(),
      completed_by_user_id: authData.user.id,
      completion_note: completionNote,
      status: "COMPLETED",
    };
    if (relatedEventId) updates.related_event_id = relatedEventId;
    if (relatedDocumentVersionId) updates.related_document_version_id = relatedDocumentVersionId;

    const { error } = await supabase.from("sla_actions").update(updates).eq("id", actionId);

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/acoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao concluir ação.", success: false };
  }
}

// ---------------- Reatribuir ação (ADMIN) ----------------

export async function reassignSlaActionAction(
  _prevState: ReassignSlaActionState,
  formData: FormData
): Promise<ReassignSlaActionState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const actionId = requiredField(formData, "actionId");
    const newResponsibleUserId = requiredField(formData, "newResponsibleUserId");

    const { error } = await supabase
      .from("sla_actions")
      .update({ responsible_user_id: newResponsibleUserId })
      .eq("id", actionId);

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/acoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao reatribuir ação.", success: false };
  }
}

// ---------------- Configurar matriz de SLA (ADMINISTRADOR) ----------------
//
// Escrita já é bloqueada por RLS para quem não é ADMINISTRADOR
// (sla_matrix_rules_write_admin_only, has_project_permission(project_id,
// 'ADMIN'), migration 20260822054900) — mas a checagem explícita abaixo
// dá um erro claro em vez de deixar a mensagem crua do Postgres vazar
// para a UI, e é a "autorização revalidada no servidor" pedida (nunca
// confia só na UI ter ocultado o formulário). Só altera
// sla_matrix_rules — nunca sla_actions já criadas (nenhum recálculo
// retroativo: ações existentes mantêm os prazos já computados no
// momento em que foram criadas).
export async function configureSlaMatrixRuleAction(
  _prevState: ConfigureSlaMatrixState,
  formData: FormData
): Promise<ConfigureSlaMatrixState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const riskLevel = requiredField(formData, "riskLevel");
    const area = optionalField(formData, "area");
    const timeUnit = requiredField(formData, "timeUnit");
    const assumeDeadlineValue = Number(requiredField(formData, "assumeDeadlineValue"));
    const respondDeadlineValueRaw = optionalField(formData, "respondDeadlineValue");
    const completeDeadlineValueRaw = optionalField(formData, "completeDeadlineValue");
    const escalation2AfterValue = Number(requiredField(formData, "escalation2AfterValue"));
    const boardAfterValue = Number(requiredField(formData, "boardAfterValue"));
    const respondDeadlineValue = respondDeadlineValueRaw ? Number(respondDeadlineValueRaw) : null;
    const completeDeadlineValue = completeDeadlineValueRaw ? Number(completeDeadlineValueRaw) : null;
    const notifyByEmail = formData.get("notifyByEmail") === "on";
    const requiresAcknowledgmentConfirmation = formData.get("requiresAcknowledgmentConfirmation") === "on";
    const requiresDelayJustification = formData.get("requiresDelayJustification") === "on";

    // Autorização revalidada no servidor — nunca confia só em RLS
    // devolver um erro genérico, nem em o formulário estar oculto na UI.
    const permission = await getCurrentProjectPermission(projectId);
    if (permission !== "ADMINISTRADOR") {
      return { error: "Edição da Matriz de SLA exige permissão ADMINISTRADOR.", success: false };
    }

    const validation = validateSlaMatrixRuleValues({
      assumeDeadlineValue,
      respondDeadlineValue,
      completeDeadlineValue,
      escalation2AfterValue,
      boardAfterValue,
    });
    if (!validation.valid) {
      return { error: validation.error, success: false };
    }

    // "Anterior" para a auditoria — mesma linha que o upsert está prestes
    // a sobrescrever (chave project_id+risk_level+area). Ausente na
    // primeira configuração (era o default institucional) — tratado como
    // "(default institucional)" no log, nunca um erro.
    // .is("area", null) para o caso genérico (sem área) — .eq() com null
    // nunca bate (SQL "= NULL" nunca é verdadeiro); PostgREST só aceita
    // "is" para IS NULL.
    const previousRowQuery = supabase
      .from("sla_matrix_rules")
      .select(
        "time_unit,assume_deadline_value,respond_deadline_value,complete_deadline_value,escalation_2_after_value,board_after_value,notify_by_email,requires_acknowledgment_confirmation,requires_delay_justification"
      )
      .eq("project_id", projectId)
      .eq("risk_level", riskLevel);
    const { data: previousRow } = await (area ? previousRowQuery.eq("area", area) : previousRowQuery.is("area", null)).maybeSingle();

    const { error } = await supabase.from("sla_matrix_rules").upsert(
      {
        project_id: projectId,
        risk_level: riskLevel,
        area,
        time_unit: timeUnit,
        assume_deadline_value: assumeDeadlineValue,
        respond_deadline_value: respondDeadlineValue,
        complete_deadline_value: completeDeadlineValue,
        escalation_2_after_value: escalation2AfterValue,
        board_after_value: boardAfterValue,
        notify_by_email: notifyByEmail,
        requires_acknowledgment_confirmation: requiresAcknowledgmentConfirmation,
        requires_delay_justification: requiresDelayJustification,
        is_default: false,
        active: true,
        updated_by_user_id: authData.user.id,
      },
      { onConflict: "project_id,risk_level,area" }
    );

    if (error) {
      return { error: error.message, success: false };
    }

    // Auditoria com valores anteriores e novos — admin client só para
    // este INSERT (mesmo padrão de send-contract-alert-email.ts:
    // audit_log_entries não tem policy de INSERT para authenticated,
    // só é gravável via RPCs SECURITY DEFINER ou, aqui, pelo admin
    // client; a escrita em sla_matrix_rules em si continua 100% sob RLS
    // normal, autorização já revalidada acima).
    const admin = createSupabaseAdminClient();
    await admin.from("audit_log_entries").insert({
      project_id: projectId,
      actor_type: "USER",
      actor_user_id: authData.user.id,
      actor_label: null,
      action: "SLA_MATRIX_RULE_UPDATED",
      entity_type: "SLA_MATRIX_RULE",
      entity_id: `${projectId}:${riskLevel}:${area ?? "GLOBAL"}`,
      detail: formatSlaMatrixRuleAuditDetail(riskLevel, previousRow, {
        time_unit: timeUnit,
        assume_deadline_value: assumeDeadlineValue,
        respond_deadline_value: respondDeadlineValue,
        complete_deadline_value: completeDeadlineValue,
        escalation_2_after_value: escalation2AfterValue,
        board_after_value: boardAfterValue,
        notify_by_email: notifyByEmail,
        requires_acknowledgment_confirmation: requiresAcknowledgmentConfirmation,
        requires_delay_justification: requiresDelayJustification,
      }),
    });

    revalidatePath(`/${projectId}/acoes/configuracao`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao salvar regra de SLA.", success: false };
  }
}

// ---------------- Configurar responsáveis por área (ADMIN) ----------------

export async function configureSlaAreaResponsiblesAction(
  _prevState: ConfigureSlaResponsiblesState,
  formData: FormData
): Promise<ConfigureSlaResponsiblesState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const area = requiredField(formData, "area");

    const { error } = await supabase.from("sla_area_responsibles").upsert(
      {
        project_id: projectId,
        area,
        responsible_direct_user_id: optionalField(formData, "responsibleDirectUserId"),
        escalation_1_user_id: optionalField(formData, "escalation1UserId"),
        escalation_2_user_id: optionalField(formData, "escalation2UserId"),
        board_user_id: optionalField(formData, "boardUserId"),
        updated_by_user_id: authData.user.id,
      },
      { onConflict: "project_id,area" }
    );

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/acoes/configuracao`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao salvar responsáveis da área.",
      success: false,
    };
  }
}

// ---------------- Motor de escalonamento (determinístico) ----------------

/**
 * Varre as ações abertas do projeto e aplica o motor determinístico
 * (computeEscalation) — nunca decide via IA se um prazo expirou (seção
 * 10). Qualquer membro do projeto pode disparar a varredura (é só
 * "verificar se o tempo passou", não uma decisão privilegiada) — a
 * autoridade real de que a transição é válida está na RPC
 * escalate_sla_action (concorrência otimista, nunca duplica
 * escalonamento). Cada e-mail de escalonamento é melhor-esforço: uma
 * falha de envio não impede as demais ações de serem escaladas.
 */
export async function processSlaEscalationsAction(
  _prevState: ProcessSlaEscalationsState,
  formData: FormData
): Promise<ProcessSlaEscalationsState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");

    const [actions, matrixRules, areaResponsibles, project, projectSettings] = await Promise.all([
      getSlaActions(projectId),
      getSlaMatrixRules(projectId),
      getSlaAreaResponsibles(projectId),
      getProject(projectId),
      getSlaProjectSettings(projectId),
    ]);

    const businessHoursConfig = resolveBusinessHoursConfig(projectSettings);
    const now = new Date().toISOString();
    const openActions = actions.filter((a) => a.status !== "COMPLETED" && a.status !== "CANCELLED");

    let escalatedCount = 0;
    const baseUrl = getAppBaseUrl();

    for (const action of openActions) {
      const rule = resolveMatrixRule(matrixRules, action.riskLevel, action.area);
      const result = computeEscalation({
        status: action.status,
        currentEscalationLevel: action.currentEscalationLevel,
        assumeDueAt: action.assumeDueAt,
        respondDueAt: action.respondDueAt,
        completeDueAt: action.completeDueAt,
        acknowledgedAt: action.acknowledgedAt,
        completedAt: action.completedAt,
        contractualDeadline: action.contractualDeadline,
        now,
        rule,
        businessHoursConfig,
      });

      if (!result.shouldEscalate || !result.reason) {
        continue;
      }

      const { error: escalateError } = await supabase.rpc("escalate_sla_action", {
        p_action_id: action.id,
        p_expected_current_level: action.currentEscalationLevel,
        p_new_level: result.recommendedLevel,
        p_reason: result.reason,
      });

      if (escalateError) {
        // Outra chamada concorrente pode já ter escalado esta ação —
        // não interrompe a varredura das demais.
        continue;
      }

      escalatedCount += 1;

      if (rule.notifyByEmail && project) {
        const responsibles = areaResponsibles.find((r) => r.area === action.area);
        const notifiedUserId =
          result.recommendedLevel === "ESCALAO_1"
            ? responsibles?.escalation1UserId
            : result.recommendedLevel === "ESCALAO_2"
              ? responsibles?.escalation2UserId
              : result.recommendedLevel === "DIRETORIA"
                ? responsibles?.boardUserId
                : null;

        if (notifiedUserId) {
          const { data: recipientProfile } = await supabase
            .from("profiles")
            .select("email,name")
            .eq("id", notifiedUserId)
            .maybeSingle();

          if (recipientProfile?.email) {
            try {
              // Fail-closed só para os botões de ação — ver comentário
              // equivalente em ledger/[eventId]/send-alert-actions.ts.
              const actionButtons = await issueEmailAlertActionButtons({
                projectId,
                alertKind: "SLA_ACTION",
                alertId: action.id,
                intendedRecipientEmail: recipientProfile.email,
              }).catch(() => []);

              await sendSlaEscalationEmail({
                projectId,
                actionId: action.id,
                recipientEmail: recipientProfile.email,
                email: {
                  recipientName: recipientProfile.name ?? null,
                  projectName: project.name,
                  severity: RISK_LEVEL_TO_ALERT_SEVERITY[action.riskLevel],
                  actionTitle: action.title,
                  currentResponsibleName: action.responsibleName,
                  originalDeadline: action.assumeDueAt,
                  overdueBy: formatDurationBetween(action.assumeDueAt, now),
                  escalationLevelLabel: ESCALATION_LEVEL_LABELS[result.recommendedLevel],
                  recommendedAction: result.reasons[result.reasons.length - 1] ?? null,
                  eventUrl: buildSlaActionUrl(baseUrl, projectId, action.id),
                  actionButtons,
                },
              });
            } catch (emailError) {
              if (!(emailError instanceof EmailSendError)) {
                throw emailError;
              }
              // Falha de envio não desfaz o escalonamento já aplicado —
              // ele já está correto/auditado no banco.
            }
          }
        }
      }
    }

    revalidatePath(`/${projectId}/acoes`);
    return { error: null, escalatedCount };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao processar escalonamentos.",
      escalatedCount: 0,
    };
  }
}

// ---------------- Configurar timezone/expediente do projeto (ADMIN) ----------------

// Correção de timezone: o cálculo de horário útil nunca usa UTC como
// horário comercial — America/Sao_Paulo é o default institucional
// (ver apps/web/lib/sla/time-units.ts), configurável por projeto aqui.
export async function configureSlaProjectSettingsAction(
  _prevState: ConfigureSlaProjectSettingsState,
  formData: FormData
): Promise<ConfigureSlaProjectSettingsState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const timezone = requiredField(formData, "timezone");
    const businessDayStartHour = Number(requiredField(formData, "businessDayStartHour"));
    const businessDayEndHour = Number(requiredField(formData, "businessDayEndHour"));

    // Valida o identificador IANA antes de gravar — nunca deixa o banco
    // aceitar um valor que o motor de SLA não conseguiria interpretar
    // depois (Intl.DateTimeFormat lança para timezone inválida).
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return { error: `Timezone inválida: "${timezone}". Use um identificador IANA (ex.: America/Sao_Paulo).`, success: false };
    }

    const { error } = await supabase.from("sla_project_settings").upsert(
      {
        project_id: projectId,
        timezone,
        business_day_start_hour: businessDayStartHour,
        business_day_end_hour: businessDayEndHour,
        updated_by_user_id: authData.user.id,
      },
      { onConflict: "project_id" }
    );

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/acoes/configuracao`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao salvar timezone/expediente do projeto.",
      success: false,
    };
  }
}
