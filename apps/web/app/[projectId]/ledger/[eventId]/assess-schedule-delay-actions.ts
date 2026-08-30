"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@axion/db/admin";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getEvent, getProject, getScheduleActivities } from "@/lib/data";
import { applyScheduleDelayAssessmentToEvent } from "@/lib/ai/experts/planning-director/apply-schedule-delay-assessment";
import { generateScheduleRecoverabilityAssessment } from "@/lib/ai/experts/planning-director/generate-schedule-recoverability-assessment";

export interface AssessScheduleDelayState {
  error: string | null;
  success: { previousSeverity: string | null; newSeverity: string; requiresHumanDecision: boolean } | null;
}

export const initialAssessScheduleDelayState: AssessScheduleDelayState = { error: null, success: null };

// Ponto de entrada REAL (não o gerador de prévia) que conecta o
// resultado estruturado do Diretor de Planejamento IA
// (ScheduleRecoverabilityAssessment) à severidade efetiva de um
// evento — ver Bloco 8. Disparado por um humano com permissão
// EDITOR/ADMIN a partir da tela do evento (mesmo padrão de "IA
// prepara → humano revisa/aprova" de sendContractAlertEmailAction),
// nunca automático.
export async function assessScheduleDelayAction(
  _prevState: AssessScheduleDelayState,
  formData: FormData
): Promise<AssessScheduleDelayState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();

  if (!projectId || !eventId) {
    return { error: "Dados do evento ausentes. Recarregue a página e tente novamente.", success: null };
  }

  const permission = await getCurrentProjectPermission(projectId);
  if (permission !== "ADMINISTRADOR" && permission !== "GESTOR" && permission !== "GERENTE") {
    return { error: "Avaliar risco de atraso de cronograma exige permissão GERENTE ou ADMINISTRADOR no projeto.", success: null };
  }

  const [project, event, activities] = await Promise.all([
    getProject(projectId),
    getEvent(eventId),
    getScheduleActivities(projectId),
  ]);

  if (!project || !event || event.projectId !== projectId) {
    return { error: "Evento ou projeto não encontrado.", success: null };
  }

  const recoverability = generateScheduleRecoverabilityAssessment(activities);
  if (!recoverability) {
    return { error: "Nenhuma atividade de cronograma está atrasada no momento — nada a avaliar.", success: null };
  }

  const admin = createSupabaseAdminClient();
  const result = await applyScheduleDelayAssessmentToEvent(admin, {
    projectId,
    eventId,
    recoverability,
    assessedByLabel: "Diretor de Planejamento IA",
  });

  revalidatePath(`/${projectId}/ledger/${eventId}`);

  return {
    error: null,
    success: {
      previousSeverity: result.previousSeverity,
      newSeverity: result.newSeverity,
      requiresHumanDecision: result.requiresHumanDecision,
    },
  };
}
