// Orquestrador da classificação determinística dos e-mails já
// sincronizados (public.emails) e seus anexos (email_attachments).
// Depende só da porta EmailClassificationStore. Idempotente: só
// e-mails ainda não classificados (ou AUTO reclassificáveis) entram;
// classificações CONFIRMED por humano nunca são sobrescritas.

import type { EmailClassificationStore } from "../../schedule/weekly-ingestion/store";
import { classifyAttachment, classifyEmail } from "./classify-email-document";

export interface ClassifySyncedEmailsResult {
  examined: number;
  classified: number;
  pendingReview: number;
  unclassified: number;
  attachmentsClassified: number;
}

export async function classifySyncedEmails(
  store: EmailClassificationStore,
  projectId: string,
  options: { limit?: number } = {}
): Promise<ClassifySyncedEmailsResult> {
  const result: ClassifySyncedEmailsResult = { examined: 0, classified: 0, pendingReview: 0, unclassified: 0, attachmentsClassified: 0 };
  const rules = await store.getClientRecipientRules(projectId);
  const emails = await store.listEmailsToClassify(projectId, options.limit ?? 200);

  for (const email of emails) {
    result.examined += 1;
    if (email.classificationStatus === "CONFIRMED") continue;

    const classification = classifyEmail({
      subject: email.subject,
      fromAddress: email.fromAddress,
      toAddresses: email.toAddresses,
      ccAddresses: [],
      direction: email.direction,
      attachmentFileNames: email.attachments.map((attachment) => attachment.fileName),
      clientDomains: rules.domains,
      clientAddresses: rules.addresses,
    });

    await store.saveEmailClassification(email.emailId, {
      classification: classification.classification,
      status: classification.status === "CONFIRMED" ? "AUTO" : classification.status,
      confidence: classification.confidence,
      reasons: classification.reasons,
      sentToClient: classification.sentToClient,
      workWeekNumber: classification.workWeekNumber,
      workWeekLabel: classification.workWeekLabel,
      workWeekStatus: classification.workWeekStatus,
    });
    if (classification.status === "AUTO") result.classified += 1;
    else if (classification.status === "PENDING_HUMAN_REVIEW") result.pendingReview += 1;
    else result.unclassified += 1;

    for (const attachment of email.attachments) {
      if (attachment.confirmedClassification) continue;
      const suggested = classifyAttachment({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        emailClassification: classification.classification,
      });
      await store.saveAttachmentClassification(attachment.id, {
        suggested: suggested.classification,
        confidence: suggested.confidence,
        reasons: suggested.reasons,
      });
      result.attachmentsClassified += 1;
    }
  }

  return result;
}
