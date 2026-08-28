"use server";

import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/lib/app-base-url";
import { issueEmailAlertActionButtons } from "@/lib/email-actions/issue-tokens";
import { EmailSendError } from "@/lib/email/email-provider";
import { NotAuthorizedError, sendContractAlertEmail } from "@/lib/email/send-contract-alert-email";
import { getEvent, getProject, getProjectMembers } from "@/lib/data";
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
  const submittedRecipientEmail = String(formData.get("recipientEmail") ?? "").trim();

  if (!projectId || !eventId) {
    return { error: "Dados do evento ausentes. Recarregue a página e tente novamente.", success: null };
  }
  if (!submittedRecipientEmail) {
    return { error: "Informe o e-mail do destinatário.", success: null };
  }

  const [project, event, members] = await Promise.all([
    getProject(projectId),
    getEvent(eventId),
    getProjectMembers(projectId),
  ]);

  if (!project || !event || event.projectId !== projectId) {
    return { error: "Evento ou projeto não encontrado.", success: null };
  }

  if (!event.aiAssessment) {
    return {
      error: "Este evento não possui um achado de IA associado para virar um alerta.",
      success: null,
    };
  }

  // Nunca confiar no nome (nem, por segurança adicional, na capitalização
  // do e-mail) vindos do navegador: o destinatário é resolvido de novo
  // aqui a partir da mesma fonte canônica de membros ACTIVE do projeto
  // usada pela tela de Usuários (getProjectMembers), nunca de uma
  // consulta paralela. Um e-mail que não pertence a um membro ACTIVE
  // deste projeto bloqueia o envio inteiro.
  const recipientMember = members.find(
    (m) => m.status === "ACTIVE" && m.user.email.toLowerCase() === submittedRecipientEmail.toLowerCase()
  );

  if (!recipientMember) {
    return {
      error: "O destinatário informado não corresponde a um usuário ativo deste projeto.",
      success: null,
    };
  }

  const recipientEmail = recipientMember.user.email;
  const recipientName = recipientMember.user.name;

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/${projectId}/ledger/${eventId}`;

  // Fail-closed só para os botões de ação: se a emissão dos tokens
  // falhar, o alerta ainda é enviado (comportamento já existente),
  // só sem DAR CIÊNCIA/ASSUMIR RESPONSABILIDADE/DEFINIR PRAZO/RESPONDER
  // AO ACC — nunca um link quebrado, nunca bloqueia o envio por causa
  // desta feature nova.
  const actionButtons = await issueEmailAlertActionButtons({
    projectId,
    alertKind: "CONTRACT_EVENT",
    alertId: eventId,
    intendedRecipientEmail: recipientEmail,
  }).catch(() => []);

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
        actionButtons,
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
