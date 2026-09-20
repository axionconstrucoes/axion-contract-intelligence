"use server";

// Server Actions do registro documental por e-mail. Todas passam pelo
// client de SESSÃO (createSupabaseServerClient) chamando RPCs SECURITY
// DEFINER que validam a permissão do projeto e gravam o evento de
// revisão com valor anterior/novo — nunca service-role a partir daqui
// (mesmo padrão de promoteEmailAttachmentAction). O reprocessamento
// técnico de um intake aprovado (criar a versão a partir do anexo já
// ingerido) é feito pelo worker (scripts/weekly-schedule-email-ingest.mjs,
// fase "promote") de forma idempotente; o resultado aparece no evento.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type { EmailRegistryActionState } from "./actions-state";

function requiredField(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function failure(error: unknown, fallback: string): EmailRegistryActionState {
  return { error: error instanceof Error ? error.message : fallback, success: false, message: null };
}

async function requireUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada. Faça login novamente.");
  return data.user;
}

const REVIEW_ACTIONS = new Set(["APPROVE", "REJECT", "SET_WORK_WEEK", "SELECT_ATTACHMENT", "LINK_PROJECT", "SET_CLASSIFICATION", "REPROCESS"]);

export async function reviewWeeklyScheduleIntakeAction(
  _prevState: EmailRegistryActionState,
  formData: FormData
): Promise<EmailRegistryActionState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const emailId = requiredField(formData, "emailId");
    const intakeId = requiredField(formData, "intakeId");
    const action = requiredField(formData, "action");
    const justification = requiredField(formData, "justification");
    if (!REVIEW_ACTIONS.has(action)) throw new Error("Ação de revisão inválida.");

    const payload: Record<string, unknown> = {};
    if (action === "SET_WORK_WEEK") {
      const number = Number(requiredField(formData, "workWeekNumber"));
      if (!Number.isInteger(number) || number < 1 || number > 260) throw new Error("Semana da obra inválida (1–260).");
      payload.work_week_number = number;
      payload.work_week_label = `W${number}`;
    }
    if (action === "SELECT_ATTACHMENT") payload.email_attachment_id = requiredField(formData, "emailAttachmentId");
    if (action === "LINK_PROJECT") payload.project_id = requiredField(formData, "targetProjectId");
    if (action === "SET_CLASSIFICATION") payload.classification = requiredField(formData, "classification");

    const { error } = await supabase.rpc("review_weekly_schedule_intake", {
      p_intake_id: intakeId,
      p_action: action,
      p_justification: justification,
      p_payload: payload,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos/emails/${emailId}`);
    revalidatePath(`/${projectId}/documentos`);
    return {
      error: null,
      success: true,
      message:
        action === "APPROVE" || action === "REPROCESS"
          ? "Decisão registrada. O reprocessamento é idempotente e roda na próxima execução do worker; o resultado aparece no histórico de revisão."
          : "Decisão registrada com valor anterior/novo e justificativa.",
    };
  } catch (error) {
    return failure(error, "Falha ao registrar a revisão.");
  }
}

export async function confirmEmailClassificationAction(
  _prevState: EmailRegistryActionState,
  formData: FormData
): Promise<EmailRegistryActionState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const emailId = requiredField(formData, "emailId");
    const attachmentId = optionalField(formData, "emailAttachmentId");
    const classification = requiredField(formData, "classification");
    const justification = requiredField(formData, "justification");

    const { error } = await supabase.rpc("confirm_email_document_classification", {
      p_email_id: emailId,
      p_email_attachment_id: attachmentId,
      p_classification: classification,
      p_justification: justification,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos/emails/${emailId}`);
    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true, message: "Classificação confirmada e auditada." };
  } catch (error) {
    return failure(error, "Falha ao confirmar a classificação.");
  }
}

export async function setScheduleBaselineAction(
  _prevState: EmailRegistryActionState,
  formData: FormData
): Promise<EmailRegistryActionState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const emailId = optionalField(formData, "emailId");
    const scheduleVersionId = requiredField(formData, "scheduleVersionId");
    const justification = requiredField(formData, "justification");

    const { error } = await supabase.rpc("set_project_schedule_baseline", {
      p_project_id: projectId,
      p_schedule_version_id: scheduleVersionId,
      p_justification: justification,
    });
    if (error) throw new Error(error.message);

    if (emailId) revalidatePath(`/${projectId}/documentos/emails/${emailId}`);
    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true, message: "Baseline oficial definida (anterior preservada no histórico)." };
  } catch (error) {
    return failure(error, "Falha ao definir a baseline oficial.");
  }
}

export async function mapWeeklyReportSheetAction(
  _prevState: EmailRegistryActionState,
  formData: FormData
): Promise<EmailRegistryActionState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const emailId = requiredField(formData, "emailId");
    const sheetId = requiredField(formData, "sheetId");
    const sheetName = requiredField(formData, "sheetName");
    const justification = requiredField(formData, "justification");

    const { error } = await supabase.rpc("map_weekly_report_sheet", {
      p_sheet_id: sheetId,
      p_sheet_name: sheetName,
      p_justification: justification,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos/emails/${emailId}`);
    return { error: null, success: true, message: "Aba mapeada e auditada; a extração é refeita pelo worker (idempotente)." };
  } catch (error) {
    return failure(error, "Falha ao mapear a aba.");
  }
}

export async function validateWeeklyReportCurveValuesAction(
  _prevState: EmailRegistryActionState,
  formData: FormData
): Promise<EmailRegistryActionState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const emailId = requiredField(formData, "emailId");
    const sheetId = requiredField(formData, "sheetId");
    const cutoffDate = requiredField(formData, "cutoffDate");
    const planned = Number(requiredField(formData, "plannedCumulative"));
    const actual = Number(requiredField(formData, "actualCumulative"));
    const forecast = optionalField(formData, "forecastCumulative");
    const justification = requiredField(formData, "justification");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) throw new Error("Data de corte inválida.");
    for (const value of [planned, actual]) {
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("Percentuais devem estar entre 0 e 100.");
    }

    const point = (value: number) => [{ period: cutoffDate, date: cutoffDate, value }];
    const series = [
      { type: "PHYSICAL_PLANNED", unit: "PERCENT", scale: "CUMULATIVE", sourceLabel: "Validação humana — planejado acumulado", points: point(planned) },
      { type: "PHYSICAL_ACTUAL", unit: "PERCENT", scale: "CUMULATIVE", sourceLabel: "Validação humana — realizado acumulado", points: point(actual) },
      ...(forecast !== null && Number.isFinite(Number(forecast))
        ? [{ type: "PHYSICAL_FORECAST", unit: "PERCENT", scale: "CUMULATIVE", sourceLabel: "Validação humana — projetado", points: point(Number(forecast)) }]
        : []),
    ];

    const { error } = await supabase.rpc("validate_weekly_report_sheet_values", {
      p_sheet_id: sheetId,
      p_data: { series, cutoffDate, headers: ["validação humana"] },
      p_cutoff_date: cutoffDate,
      p_justification: justification,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos/emails/${emailId}`);
    return { error: null, success: true, message: "Valores da Curva S validados; métricas serão recalculadas pelo worker." };
  } catch (error) {
    return failure(error, "Falha ao validar a Curva S.");
  }
}
