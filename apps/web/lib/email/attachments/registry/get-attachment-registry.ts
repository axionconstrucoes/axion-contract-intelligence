// Orquestração I/O da aba "Anexos de E-mail" — só compõe funções de
// leitura já existentes (nenhuma tabela nova, nenhum novo caminho de
// escrita). server-only porque document-management.ts também é.

import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { getCurationRunsForProject } from "../../../additionals/findings/curation-run";
import { getFindingsForProject } from "../../../additionals/findings/get-findings";
import { getEmails } from "../../../data";
import { getManagedDocuments } from "../../../document-management";
import { getEmailAttachmentsForProject } from "../get-email-attachments";
import { buildEmailAttachmentRegistryRows } from "./build-registry-rows";
import type { EmailAttachmentRegistryRow, EmailSummary, LinkedDocumentVersionSummary } from "./types";

export async function getEmailAttachmentRegistryForProject(projectId: string): Promise<EmailAttachmentRegistryRow[]> {
  const supabase = await createSupabaseServerClient();

  const [attachments, emails, findings, curationRuns, managedDocuments] = await Promise.all([
    getEmailAttachmentsForProject(supabase, projectId),
    getEmails(projectId),
    getFindingsForProject(supabase, projectId),
    getCurationRunsForProject(supabase, projectId),
    getManagedDocuments(projectId),
  ]);

  const emailsById = new Map<string, EmailSummary>(emails.map((email) => [email.id, email]));

  const linkedDocumentVersionsById = new Map<string, LinkedDocumentVersionSummary>();
  for (const document of managedDocuments) {
    for (const version of document.versions) {
      linkedDocumentVersionsById.set(version.id, {
        documentId: document.id,
        documentVersionId: version.id,
        documentTitle: document.title,
        documentKind: document.kind,
        processingStatus: version.processingStatus as LinkedDocumentVersionSummary["processingStatus"],
      });
    }
  }

  return buildEmailAttachmentRegistryRows({ attachments, emailsById, findings, curationRuns, linkedDocumentVersionsById });
}
