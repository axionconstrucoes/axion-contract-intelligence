// Orquestrador da ingestão de UMA mensagem candidata ao cronograma
// semanal. Depende só da porta WeeklyScheduleIngestionStore (store.ts):
// nenhuma chamada Gmail/Supabase direta aqui.
//
// Fluxo (idempotente por (project_id, gmail_message_id)):
//   1. já avaliada? => nada a fazer (nunca reavalia/sobrescreve);
//   2. resolve remetente (membership + escalão SEGUNDO A MATRIZ de
//      responsabilidades) e aplica evaluateWeeklyScheduleEmail (pura);
//   3. não autorizada => grava a EVIDÊNCIA com a regra aplicada
//      (rejeições e ignorados preservam remetente/destinatários/anexos);
//      PENDING_HUMAN_REVIEW ainda ingere os .mpp em email_attachments
//      (estágio A, sempre seguro) para a revisão humana poder promover
//      depois sem novo download;
//   4. autorizada => ingere o .mpp selecionado (SHA-256). Hash já
//      conhecido no projeto => RECEIVED_DUPLICATE: o ENVIO é registrado
//      como evidência (message_id, thread, remetente, destinatários,
//      assunto, data, anexo) e conta como obrigação semanal cumprida,
//      mas nenhuma document_version/schedule_version nova é criada.
//      Hash novo => NOVA versão no documento CRONOGRAMA_REVISAO alvo com
//      processing_status = AWAITING_PROCESSING (fila do worker MPXJ
//      existente, scripts/process-document-version.mjs);
//   5. qualquer falha vira intake FAILED com o erro (sanitizado), nunca
//      exceção silenciosa nem linha parcial.
//
// Semana da OBRA (WNN) é extraída do assunto (parseWorkWeekSubject) e
// gravada como evidência; nunca convertida em semana civil.

import { parseWorkWeekSubject } from "../../email/registry/parse-work-week-subject";
import { evaluateWeeklyScheduleEmail, isMppAttachment } from "./evaluate-weekly-schedule-email";
import type { IngestedMppAttachment, WeeklyScheduleIngestionStore, WeeklyScheduleIntakeRecord } from "./store";
import { DuplicateDocumentVersionError } from "./store";
import type { EmailAttachmentDescriptor, WeeklyScheduleEmailCandidate, WeeklyScheduleIngestionConfig, WeeklyScheduleIntakeStatus } from "./types";
import { resolveWeekStart } from "./week-window";

export type ProcessCandidateOutcome =
  | { kind: "ALREADY_EVALUATED"; intakeId: string; status: WeeklyScheduleIntakeStatus }
  | { kind: "RECORDED"; intakeId: string; status: WeeklyScheduleIntakeStatus; rule: string; documentVersionId: string | null };

const SPREADSHEET_RE = /\.(xlsx|xlsm|xls)$/i;
const MEETING_MINUTES_RE = /(^|[^a-z0-9])(ata|atas|mom)([^a-z0-9]|$)|minuta[\s_-]*de[\s_-]*reuni/i;

function isSpreadsheetAttachment(attachment: EmailAttachmentDescriptor): boolean {
  return SPREADSHEET_RE.test(attachment.fileName) || /spreadsheetml|ms-excel/i.test(attachment.mimeType);
}

function isMeetingMinutesAttachment(attachment: EmailAttachmentDescriptor): boolean {
  const normalized = attachment.fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return MEETING_MINUTES_RE.test(normalized);
}

function isWeeklyPackageAttachment(attachment: EmailAttachmentDescriptor): boolean {
  return isMppAttachment(attachment) || isSpreadsheetAttachment(attachment) || isMeetingMinutesAttachment(attachment);
}

function withHash(attachments: EmailAttachmentDescriptor[], ingested: Map<string, IngestedMppAttachment>): EmailAttachmentDescriptor[] {
  return attachments.map((attachment) => {
    const hit = ingested.get(attachment.gmailAttachmentId);
    return hit
      ? { ...attachment, sizeBytes: hit.fileSizeBytes, sha256Hash: hit.sha256Hash }
      : { ...attachment, sha256Hash: attachment.sha256Hash ?? null };
  });
}

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Nunca deixa vazar tokens/segredos que porventura apareçam em mensagens de bibliotecas.
  return message.replace(/(bearer|token|secret|key|password)[=:\s]+[A-Za-z0-9._\-]{8,}/gi, "$1=[redacted]").slice(0, 2000);
}

export async function processWeeklyScheduleEmailCandidate(
  store: WeeklyScheduleIngestionStore,
  config: WeeklyScheduleIngestionConfig,
  candidate: WeeklyScheduleEmailCandidate
): Promise<ProcessCandidateOutcome> {
  const existing = await store.findIntakeByMessage(config.projectId, candidate.gmailMessageId);
  if (existing) {
    return { kind: "ALREADY_EVALUATED", intakeId: existing.id, status: existing.status };
  }

  const sender = await store.resolveSender(config.projectId, candidate.fromAddress, config.authorizedArea);
  const decision = evaluateWeeklyScheduleEmail(candidate, config, sender);
  const weekStart = resolveWeekStart(candidate.sentAt, config.timezone);
  const workWeek = parseWorkWeekSubject(candidate.subject);

  const base: WeeklyScheduleIntakeRecord = {
    projectId: config.projectId,
    configId: config.id,
    emailId: candidate.emailId,
    mailboxAddress: candidate.mailboxAddress,
    direction: candidate.direction,
    syncSource: "GMAIL_INBOUND_SYNC",
    gmailMessageId: candidate.gmailMessageId,
    gmailThreadId: candidate.gmailThreadId,
    messageIdHeader: candidate.messageIdHeader,
    fromAddress: candidate.fromAddress,
    toAddresses: candidate.toAddresses,
    ccAddresses: candidate.ccAddresses,
    subject: candidate.subject,
    sentAt: candidate.sentAt,
    providerLabels: candidate.providerLabels ?? [],
    weekStart,
    workWeekNumber: workWeek.workWeekNumber,
    workWeekLabel: workWeek.workWeekLabel,
    workWeekStatus: workWeek.workWeekStatus,
    attachments: candidate.attachments,
    senderUserId: decision.senderUserId,
    senderTier: decision.senderTier,
    status: decision.status,
    decisionRule: decision.rule,
    decisionReasons: decision.reasons,
    failureError: null,
    selectedEmailAttachmentId: null,
    selectedSha256Hash: null,
    documentVersionId: null,
    duplicateOfDocumentVersionId: null,
  };

  const ingested = new Map<string, IngestedMppAttachment>();

  const record = async (patch: Partial<WeeklyScheduleIntakeRecord>, auditAction: string, auditDetail: string) => {
    const row: WeeklyScheduleIntakeRecord = { ...base, ...patch, attachments: withHash(candidate.attachments, ingested) };
    const { id } = await store.recordIntake(row);
    await store.writeAudit({
      projectId: config.projectId,
      action: auditAction,
      entityType: "WEEKLY_SCHEDULE_EMAIL_INTAKE",
      entityId: id,
      detail: auditDetail,
    });
    return id;
  };

  try {
    if (decision.status === "PENDING_HUMAN_REVIEW" && candidate.emailId) {
      // Estágio A (sempre seguro): preserva os bytes para a revisão humana.
      for (const attachment of decision.mppCandidates) {
        try {
          ingested.set(attachment.gmailAttachmentId, await store.ingestAttachment(config.projectId, candidate, attachment));
        } catch {
          // Best-effort: a evidência da mensagem é gravada mesmo sem os bytes.
        }
      }
    }

    if (decision.status !== "AUTHORIZED_AUTO" || !decision.selectedAttachment) {
      const id = await record(
        {},
        `WEEKLY_SCHEDULE_EMAIL_${decision.status}`,
        `Mensagem ${candidate.gmailMessageId} avaliada: ${decision.status} (regra ${decision.rule}; escalão ${decision.senderTier ?? "n/a"}).`
      );
      return { kind: "RECORDED", intakeId: id, status: decision.status, rule: decision.rule, documentVersionId: null };
    }

    if (!candidate.emailId) {
      throw new Error("E-mail ainda não sincronizado em public.emails — anexo não pode ser ingerido nesta execução.");
    }

    // Pacote semanal do Planejamento: preserva, na mesma mensagem,
    // Cronograma MPP + planilha Excel + Ata de Reunião. O intake continua
    // sendo a unidade semanal (message_id/WNN); cada arquivo segue seu
    // pipeline próprio, mas todos mantêm a mesma origem email_id.
    for (const packageAttachment of candidate.attachments.filter(isWeeklyPackageAttachment)) {
      const stored = await store.ingestAttachment(config.projectId, candidate, packageAttachment);
      ingested.set(packageAttachment.gmailAttachmentId, stored);

      if (isMeetingMinutesAttachment(packageAttachment)) {
        await store.promoteMeetingMinutesAttachment(stored, candidate);
      }
    }

    const attachment =
      ingested.get(decision.selectedAttachment.gmailAttachmentId) ??
      (await store.ingestAttachment(config.projectId, candidate, decision.selectedAttachment));
    ingested.set(decision.selectedAttachment.gmailAttachmentId, attachment);

    const duplicate = await store.findDocumentVersionBySha(config.projectId, attachment.sha256Hash);
    if (duplicate) {
      const id = await record(
        {
          status: "RECEIVED_DUPLICATE",
          decisionRule: "DUPLICATE_SHA256",
          decisionReasons: [
            ...decision.reasons,
            `Envio válido registrado; o .mpp (SHA-256 ${attachment.sha256Hash}) já existe como document_version ${duplicate.id} — nenhuma versão nova criada, obrigação semanal considerada cumprida.`,
          ],
          selectedEmailAttachmentId: attachment.id,
          selectedSha256Hash: attachment.sha256Hash,
          duplicateOfDocumentVersionId: duplicate.id,
        },
        "WEEKLY_SCHEDULE_EMAIL_RECEIVED_DUPLICATE",
        `Mensagem ${candidate.gmailMessageId}: envio semanal recebido com .mpp já conhecido (document_version ${duplicate.id}).`
      );
      return { kind: "RECORDED", intakeId: id, status: "RECEIVED_DUPLICATE", rule: "DUPLICATE_SHA256", documentVersionId: null };
    }

    const documentId = await store.ensureTargetDocument(config);

    let created: { documentVersionId: string; versionIndex: number };
    try {
      created = await store.createScheduleDocumentVersion({
        projectId: config.projectId,
        documentId,
        attachment,
        candidate,
        author: candidate.fromAddress,
        weekStart,
      });
    } catch (error) {
      if (error instanceof DuplicateDocumentVersionError) {
        const id = await record(
          {
            status: "RECEIVED_DUPLICATE",
            decisionRule: "DUPLICATE_SHA256",
            decisionReasons: [...decision.reasons, "Índice único (project_id, sha256_hash) rejeitou a versão: anexo já registrado (corrida concorrente)."],
            selectedEmailAttachmentId: attachment.id,
            selectedSha256Hash: attachment.sha256Hash,
            duplicateOfDocumentVersionId: error.existing?.id ?? null,
          },
          "WEEKLY_SCHEDULE_EMAIL_RECEIVED_DUPLICATE",
          `Mensagem ${candidate.gmailMessageId}: .mpp já registrado (corrida concorrente).`
        );
        return { kind: "RECORDED", intakeId: id, status: "RECEIVED_DUPLICATE", rule: "DUPLICATE_SHA256", documentVersionId: null };
      }
      throw error;
    }

    const id = await record(
      {
        selectedEmailAttachmentId: attachment.id,
        selectedSha256Hash: attachment.sha256Hash,
        documentVersionId: created.documentVersionId,
      },
      "WEEKLY_SCHEDULE_VERSION_CREATED",
      `Cronograma semanal "${attachment.originalFileName}" (SHA-256 ${attachment.sha256Hash}, ${attachment.fileSizeBytes} bytes) ` +
        `recebido de ${candidate.fromAddress} em ${candidate.sentAt} (mensagem ${candidate.gmailMessageId}${workWeek.workWeekLabel ? `, ${workWeek.workWeekLabel}` : ""}) ` +
        `virou document_version ${created.documentVersionId} (v${created.versionIndex}, AWAITING_PROCESSING) — regra ${decision.rule}.`
    );
    return { kind: "RECORDED", intakeId: id, status: "AUTHORIZED_AUTO", rule: decision.rule, documentVersionId: created.documentVersionId };
  } catch (error) {
    const failure = sanitizeErrorMessage(error);
    const id = await record(
      {
        status: "FAILED",
        decisionRule: "INGESTION_FAILURE",
        decisionReasons: [...decision.reasons, `Decisão original: ${decision.status} (${decision.rule}).`],
        failureError: failure,
      },
      "WEEKLY_SCHEDULE_EMAIL_FAILED",
      `Mensagem ${candidate.gmailMessageId}: falha na ingestão — ${failure}`
    );
    return { kind: "RECORDED", intakeId: id, status: "FAILED", rule: "INGESTION_FAILURE", documentVersionId: null };
  }
}
