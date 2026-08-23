"use server";

import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/lib/app-base-url";
import { buildRespondToAccUrl } from "@/lib/email/build-respond-to-acc-url";
import { EmailSendError } from "@/lib/email/email-provider";
import { NotAuthorizedError, sendContractAlertEmail } from "@/lib/email/send-contract-alert-email";
import { getEvent, getProject } from "@/lib/data";
import { findingTypeLabels } from "@/lib/labels";
import type { SendContractAlertState } from "./send-alert-actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipo e estado inicial vivem em ./send-alert-actions-state.ts.

// "IA prepara → humano revisa/edita → humano aprova → sistema envia": o
// achado de IA (event.aiAssessment) já existe e já passou por revisão
// humana implícita (é isso que o resto da página de Ledger existe para
// fazer); esta action só executa o envio depois que um humano com
// permissão EDITOR/ADMIN preencheu o destinatário e clicou em enviar —
// nunca automático, nunca disparado por um Expert.
export async function sendContractAlertEmailAction(
  _prevState: SendContractAlertState,
  formData: FormData
): Promise<SendContractAlertState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();
  const recipientEmail = String(formData.get("recipientEmail") ?? "").trim();
  const recipientName = String(formData.get("recipientName") ?? "").trim() || null;

  if (!projectId || !eventId) {
    return { error: "Dados do evento ausentes. Recarregue a página e tente novamente.", success: null };
  }
  if (!recipientEmail) {
    return { error: "Informe o e-mail do destinatário.", success: null };
  }

  const [project, event] = await Promise.all([getProject(projectId), getEvent(eventId)]);

  if (!project || !event || event.projectId !== projectId) {
    return { error: "Evento ou projeto não encontrado.", success: null };
  }

  if (!event.aiAssessment) {
    return {
      error: "Este evento não possui um achado de IA associado para virar um alerta.",
      success: null,
    };
  }

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/${projectId}/ledger/${eventId}`;
  const respondUrl = buildRespondToAccUrl(baseUrl, {
    projectId,
    eventId,
    riskLevel: event.aiAssessment.severity,
  });

  const contractualBasis =
    event.crossReferences.length > 0 ? event.crossReferences.map((c) => c.note).join(" | ") : null;

  const keyEvidence = event.evidence.map((e) => `${e.label} (${e.locator})`);

  try {
    await sendContractAlertEmail({
      projectId,
      eventId,
      recipientEmail,
      alert: {
        recipientName,
        projectName: project.name,
        severity: event.aiAssessment.severity,
        title: event.title,
        summary: event.aiAssessment.summary,
        relatedEventTitle: event.title,
        contractualBasis,
        keyEvidence,
        potentialImpact: findingTypeLabels[event.aiAssessment.findingType],
        recommendedAction: null,
        responsibleName: null,
        dueDate: null,
        eventUrl,
        respondUrl,
      },
    });
  } catch (error) {
    if (error instanceof NotAuthorizedError || error instanceof EmailSendError) {
      return { error: error.message, success: null };
    }
    throw error;
  }

  revalidatePath(`/${projectId}/ledger/${eventId}`);
  return { error: null, success: `Alerta enviado para ${recipientEmail}.` };
}
