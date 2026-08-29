"use server";

import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/lib/app-base-url";
import { issueEmailAlertActionButtons } from "@/lib/email-actions/issue-tokens";
import { buildConfrontationBlock, type ContractConfrontationBlock } from "@/lib/email/build-confrontation-block";
import { EmailSendError } from "@/lib/email/email-provider";
import { toEvidenceEmailDirection } from "@/lib/email/evidence-email-direction";
import { NotAuthorizedError, sendContractAlertEmail } from "@/lib/email/send-contract-alert-email";
import type { ContractAlertEvidenceItem } from "@/lib/email/templates/contract-alert-template";
import { getEmail, getEvent, getProject, getProjectMembers, getUser } from "@/lib/data";
import {
  getEventClauseConfrontationCandidates,
  type EventClauseConfrontationCandidate,
} from "@/lib/event-clause-confrontation-review";
import { findingTypeLabels, formatDate, sourceTypeShortLabels } from "@/lib/labels";
import { confrontationAnchorId } from "@/lib/ledger/confrontation-anchor";
import { validateConfrontationJustification } from "@/lib/ledger/confrontation-justification-validation";
import { evidenceAnchorId } from "@/lib/ledger/evidence-anchor";
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

  const [project, event, members, confrontationCandidates] = await Promise.all([
    getProject(projectId),
    getEvent(eventId),
    getProjectMembers(projectId),
    getEventClauseConfrontationCandidates(eventId),
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

  // ---------- confronto contratual estruturado (Parte D/E) ----------
  //
  // Só cross-references de cláusula (refType CLAUSE) com um candidato de
  // confrontação APPROVED correspondente viram bloco estruturado; as
  // demais permanecem no fallback genérico contractualBasis (nunca uma
  // cross-reference aparece nos dois lugares ao mesmo tempo). Candidatos
  // REJECTED nunca chegam aqui: a migration 20260821021746 só grava
  // event_cross_references no caminho APPROVE — nenhuma justificativa de
  // rejeição jamais vira "conclusão" de um confronto aprovado.
  const approvedConfrontationByClauseId = new Map<string, EventClauseConfrontationCandidate>(
    confrontationCandidates.filter((c) => c.status === "APPROVED").map((c) => [c.clauseId, c])
  );

  const relevantApprovedCandidates = event.crossReferences
    .filter((c) => c.refType === "CLAUSE")
    .map((c) => approvedConfrontationByClauseId.get(c.refId))
    .filter((c): c is EventClauseConfrontationCandidate => Boolean(c));

  // Bloqueio no servidor (Parte E — "o envio do alerta deve ser bloqueado
  // quando a aprovação não tiver justificativa específica"): mesma
  // validação compartilhada e determinística usada em actions.ts ao
  // aprovar. Cobre tanto candidatos aprovados ANTES desta correção
  // (review_note nulo/genérico, ex.: o e-mail real do piloto) quanto
  // qualquer aprovação futura que por algum motivo tenha passado da
  // validação de lá — nunca envia com uma "conclusão" vazia ou genérica.
  for (const candidate of relevantApprovedCandidates) {
    const justification = validateConfrontationJustification(candidate.reviewNote ?? "");
    if (!justification.valid) {
      return {
        error: `O confronto aprovado da Cláusula ${candidate.clauseNumber} não tem uma justificativa específica registrada (${justification.error}). Peça a um revisor com permissão de aprovação para complementá-la antes de enviar este alerta.`,
        success: null,
      };
    }
  }

  // Nome do revisor: sempre resolvido a partir de reviewed_by_user_id
  // (autoria real gravada pelo RPC de aprovação) via getUser() — que
  // busca um profile PELO ID recebido, nunca pela sessão atual. Quem
  // envia o alerta e quem aprovou o confronto podem ser pessoas
  // diferentes; o e-mail sempre mostra quem de fato aprovou.
  const reviewerIdsToResolve = Array.from(
    new Set(
      relevantApprovedCandidates.map((c) => c.reviewedByUserId).filter((id): id is string => Boolean(id))
    )
  );
  const reviewerProfiles = await Promise.all(reviewerIdsToResolve.map((id) => getUser(id)));
  const reviewerNameById = new Map(reviewerIdsToResolve.map((id, index) => [id, reviewerProfiles[index]?.name ?? null]));

  const confrontationBlocks: ContractConfrontationBlock[] = relevantApprovedCandidates.map((candidate) => {
    const reviewerName = candidate.reviewedByUserId ? (reviewerNameById.get(candidate.reviewedByUserId) ?? null) : null;
    return buildConfrontationBlock(
      {
        clauseNumber: candidate.clauseNumber,
        eventBasis: candidate.eventBasis,
        clauseBasis: candidate.clauseBasis,
        summary: candidate.summary,
        // Não-nula: validada acima (validateConfrontationJustification já
        // rejeita vazio/genérico e bloqueia o envio antes de chegar aqui).
        reviewNote: candidate.reviewNote as string,
        reviewedAt: candidate.reviewedAt,
      },
      reviewerName,
      `${eventUrl}#${confrontationAnchorId(candidate.id)}`
    );
  });

  const contractualBasis =
    event.crossReferences
      .filter((c) => !(c.refType === "CLAUSE" && approvedConfrontationByClauseId.has(c.refId)))
      .map((c) => c.note)
      .join(" | ") || null;

  // ---------- evidências: RECEBIDA/ENVIADA ou tipo real (Parte G) ----------
  //
  // Nunca gmail:// (ou qualquer URI interna) no href: cada evidência com
  // id real vira um link HTTPS para a âncora estável dela na página do
  // evento (evidenceAnchorId — mesma convenção usada por EvidenceViewer).
  // Direção (RECEBIDA/ENVIADA) vem de emails.direction, já classificado
  // pela ingestão Gmail a partir da mailbox monitorada (nunca recalculada/
  // adivinhada aqui — ver evidence-email-direction.ts); sem essa
  // informação, "DIREÇÃO NÃO IDENTIFICADA" em vez de um palpite.
  const keyEvidence: ContractAlertEvidenceItem[] = await Promise.all(
    event.evidence.map(async (e): Promise<ContractAlertEvidenceItem> => {
      if (!e.id) return e.label;

      const url = `${eventUrl}#${evidenceAnchorId(e.id)}`;

      if (e.emailId) {
        const email = await getEmail(e.emailId);
        if (email) {
          return {
            kind: "EMAIL",
            url,
            direction: toEvidenceEmailDirection(email.direction),
            from: email.from,
            to: email.to,
            date: formatDate(email.date),
            subject: email.subject,
          };
        }
      }

      return { kind: "OTHER", url, sourceTypeLabel: sourceTypeShortLabels[e.sourceType], label: e.label };
    })
  );

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
        confrontationBlocks,
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
