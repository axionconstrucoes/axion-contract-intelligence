// Reprocessamento IDEMPOTENTE de um intake após revisão humana
// (status APPROVED_HUMAN_REVIEW registrado pela RPC
// review_weekly_schedule_intake). Usa os anexos já ingeridos em
// email_attachments (nunca volta ao Gmail): escolhe o .mpp indicado na
// revisão (ou o único .mpp), deduplica por SHA-256 e cria a versão na
// mesma fila do worker MPXJ. O resultado é gravado no evento de revisão
// (reprocess_result) e em auditoria.

import { isMppAttachment } from "./evaluate-weekly-schedule-email";
import { sanitizeErrorMessage } from "./ingest-weekly-schedule-email";
import type { IngestedMppAttachment, ReviewedIntakePromotionStore } from "./store";
import { DuplicateDocumentVersionError } from "./store";

export interface PromoteReviewedIntakeResult {
  outcome: "PROMOTED" | "ALREADY_PROMOTED" | "RECEIVED_DUPLICATE" | "NOT_APPROVED" | "NO_ATTACHMENT" | "AMBIGUOUS" | "FAILED";
  documentVersionId: string | null;
  detail: string;
}

export async function promoteReviewedIntake(
  store: ReviewedIntakePromotionStore,
  intakeId: string,
  reviewEventId: string | null
): Promise<PromoteReviewedIntakeResult> {
  const finish = async (result: PromoteReviewedIntakeResult) => {
    await store.recordReprocessResult(reviewEventId, result);
    return result;
  };

  const intake = await store.getIntakeForPromotion(intakeId);
  if (!intake) return finish({ outcome: "FAILED", documentVersionId: null, detail: "Intake não encontrado." });

  if (intake.documentVersionId) {
    return finish({ outcome: "ALREADY_PROMOTED", documentVersionId: intake.documentVersionId, detail: "Intake já possui document_version." });
  }
  if (intake.status !== "APPROVED_HUMAN_REVIEW") {
    return finish({ outcome: "NOT_APPROVED", documentVersionId: null, detail: `Status ${intake.status} não permite promoção.` });
  }
  if (!intake.emailId) {
    return finish({ outcome: "NO_ATTACHMENT", documentVersionId: null, detail: "Intake sem e-mail sincronizado — anexos indisponíveis." });
  }

  try {
    const ingested = await store.listIngestedAttachments(intake.emailId);
    const mpps = ingested.filter((attachment) => isMppAttachment({ fileName: attachment.originalFileName, mimeType: attachment.mimeType }));

    let selected: IngestedMppAttachment | null = null;
    if (intake.selectedEmailAttachmentId) {
      selected = mpps.find((attachment) => attachment.id === intake.selectedEmailAttachmentId) ?? null;
      if (!selected) {
        return finish({ outcome: "NO_ATTACHMENT", documentVersionId: null, detail: "Anexo selecionado na revisão não é um .mpp ingerido deste e-mail." });
      }
    } else if (mpps.length === 1) {
      selected = mpps[0];
    } else if (mpps.length === 0) {
      return finish({ outcome: "NO_ATTACHMENT", documentVersionId: null, detail: "Nenhum .mpp ingerido para este e-mail." });
    } else {
      return finish({ outcome: "AMBIGUOUS", documentVersionId: null, detail: `${mpps.length} anexos .mpp — selecione o anexo principal antes de aprovar.` });
    }

    const duplicate = await store.findDocumentVersionBySha(intake.projectId, selected.sha256Hash);
    if (duplicate) {
      await store.updateIntakeAfterPromotion(intake.intakeId, {
        status: "RECEIVED_DUPLICATE",
        decisionRule: "DUPLICATE_SHA256",
        decisionReason: `Revisão humana aprovou o envio; o .mpp (SHA-256 ${selected.sha256Hash}) já existe como document_version ${duplicate.id}.`,
        selectedEmailAttachmentId: selected.id,
        selectedSha256Hash: selected.sha256Hash,
        documentVersionId: null,
        duplicateOfDocumentVersionId: duplicate.id,
        failureError: null,
      });
      return finish({ outcome: "RECEIVED_DUPLICATE", documentVersionId: null, detail: `SHA-256 já registrado em ${duplicate.id}.` });
    }

    const config = await store.getConfig(intake.configId);
    if (!config) return finish({ outcome: "FAILED", documentVersionId: null, detail: "Configuração do projeto não encontrada." });

    const documentId = await store.ensureTargetDocument(config);
    let created: { documentVersionId: string; versionIndex: number };
    try {
      created = await store.createScheduleDocumentVersion({
        projectId: intake.projectId,
        documentId,
        attachment: selected,
        candidate: { sentAt: intake.sentAt, gmailMessageId: intake.gmailMessageId, subject: intake.subject, fromAddress: intake.fromAddress },
        author: intake.fromAddress,
        weekStart: intake.weekStart,
      });
    } catch (error) {
      if (error instanceof DuplicateDocumentVersionError) {
        await store.updateIntakeAfterPromotion(intake.intakeId, {
          status: "RECEIVED_DUPLICATE",
          decisionRule: "DUPLICATE_SHA256",
          decisionReason: "Índice único (project_id, sha256_hash) rejeitou a versão durante a promoção.",
          selectedEmailAttachmentId: selected.id,
          selectedSha256Hash: selected.sha256Hash,
          documentVersionId: null,
          duplicateOfDocumentVersionId: error.existing?.id ?? null,
          failureError: null,
        });
        return finish({ outcome: "RECEIVED_DUPLICATE", documentVersionId: null, detail: "Anexo já registrado (corrida concorrente)." });
      }
      throw error;
    }

    await store.updateIntakeAfterPromotion(intake.intakeId, {
      status: "APPROVED_HUMAN_REVIEW",
      decisionRule: "HUMAN_REVIEW_APPROVED",
      decisionReason: `Promovido após revisão humana: document_version ${created.documentVersionId} (v${created.versionIndex}, AWAITING_PROCESSING).`,
      selectedEmailAttachmentId: selected.id,
      selectedSha256Hash: selected.sha256Hash,
      documentVersionId: created.documentVersionId,
      duplicateOfDocumentVersionId: null,
      failureError: null,
    });
    await store.writeAudit({
      projectId: intake.projectId,
      action: "WEEKLY_SCHEDULE_VERSION_CREATED_AFTER_REVIEW",
      entityType: "WEEKLY_SCHEDULE_EMAIL_INTAKE",
      entityId: intake.intakeId,
      detail: `Cronograma "${selected.originalFileName}" (SHA-256 ${selected.sha256Hash}) promovido após revisão humana: document_version ${created.documentVersionId} (v${created.versionIndex}).`,
    });
    return finish({ outcome: "PROMOTED", documentVersionId: created.documentVersionId, detail: `v${created.versionIndex} criada e enfileirada para o worker MPXJ.` });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    await store.updateIntakeAfterPromotion(intake.intakeId, {
      status: "FAILED",
      decisionRule: "INGESTION_FAILURE",
      decisionReason: `Falha na promoção após revisão: ${message}`,
      selectedEmailAttachmentId: intake.selectedEmailAttachmentId,
      selectedSha256Hash: null,
      documentVersionId: null,
      duplicateOfDocumentVersionId: null,
      failureError: message,
    });
    return finish({ outcome: "FAILED", documentVersionId: null, detail: message });
  }
}
