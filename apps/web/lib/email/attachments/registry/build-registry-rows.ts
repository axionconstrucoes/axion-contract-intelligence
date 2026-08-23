// Monta as linhas da aba "Anexos de E-mail" — função pura (sem I/O),
// testável por script Node standalone. Toda leitura vem de estruturas
// já existentes (email_attachments, emails, ai_findings,
// ai_curation_runs, document_versions) — nenhuma tabela nova.
//
// Regras centrais preservadas aqui (nunca violar):
// - seção 11: "considerado" exige referência REAL em source_refs/
//   conflicting_source_refs de um finding OU em source_id de uma
//   ai_curation_run com source_type='EMAIL_ATTACHMENT' — nunca inferido
//   a partir de processing_status ou nome de arquivo;
// - seção 17: mesmo sha256_hash em e-mails diferentes NUNCA colapsa em
//   uma única linha — cada email_attachments é uma proveniência própria;
// - seção 18: múltiplos Experts/findings agregam na MESMA linha, nunca
//   duplicam a linha.

import type { AiCurationRun } from "../../../additionals/findings/types";
import type { AiFinding } from "../../../additionals/findings/types";
import type { ExpertId, ExpertSeverity } from "../../../ai/types";
import type { EmailAttachment } from "../types";
import { resolveAttachmentDisplayStatus } from "./resolve-display-status";
import type { EmailAttachmentRegistryRow, EmailSummary, LinkedDocumentVersionSummary } from "./types";

const SEVERITY_RANK: Record<ExpertSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function higherSeverity(a: ExpertSeverity | null, b: ExpertSeverity): ExpertSeverity {
  if (!a) return b;
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

export interface BuildRegistryRowsInput {
  attachments: EmailAttachment[];
  emailsById: Map<string, EmailSummary>;
  findings: AiFinding[];
  curationRuns: AiCurationRun[];
  linkedDocumentVersionsById: Map<string, LinkedDocumentVersionSummary>;
}

export function buildEmailAttachmentRegistryRows(input: BuildRegistryRowsInput): EmailAttachmentRegistryRow[] {
  const { attachments, emailsById, findings, curationRuns, linkedDocumentVersionsById } = input;

  // Nº de ocorrências por hash — seção 17 ("mesmo conteúdo encontrado em X e-mails").
  const occurrencesByHash = new Map<string, number>();
  for (const attachment of attachments) {
    occurrencesByHash.set(attachment.sha256Hash, (occurrencesByHash.get(attachment.sha256Hash) ?? 0) + 1);
  }

  // Findings que referenciam este attachment (source_refs OU conflicting_source_refs, type='EMAIL_ATTACHMENT').
  const findingsByAttachmentId = new Map<string, AiFinding[]>();
  for (const finding of findings) {
    const refs = [...finding.sourceRefs, ...finding.conflictingSourceRefs];
    const attachmentIds = new Set(refs.filter((ref) => ref.type === "EMAIL_ATTACHMENT").map((ref) => ref.id));
    for (const attachmentId of attachmentIds) {
      const list = findingsByAttachmentId.get(attachmentId) ?? [];
      list.push(finding);
      findingsByAttachmentId.set(attachmentId, list);
    }
  }

  // Curation runs que rodaram diretamente sobre este attachment (mesmo sem finding — seção 11).
  const curationRunsByAttachmentId = new Map<string, AiCurationRun[]>();
  for (const run of curationRuns) {
    if (run.sourceType !== "EMAIL_ATTACHMENT") continue;
    const list = curationRunsByAttachmentId.get(run.sourceId) ?? [];
    list.push(run);
    curationRunsByAttachmentId.set(run.sourceId, list);
  }

  return attachments.map((attachment) => {
    const email = emailsById.get(attachment.emailId) ?? null;
    const linkedDocument = attachment.documentVersionId ? (linkedDocumentVersionsById.get(attachment.documentVersionId) ?? null) : null;

    const matchingFindings = findingsByAttachmentId.get(attachment.id) ?? [];
    const matchingCurationRuns = curationRunsByAttachmentId.get(attachment.id) ?? [];

    const consideredByAcc = matchingFindings.length > 0 || matchingCurationRuns.length > 0;

    const expertIdSet = new Set<ExpertId>();
    for (const finding of matchingFindings) {
      for (const expertId of finding.expertIds) expertIdSet.add(expertId);
    }
    for (const run of matchingCurationRuns) {
      for (const expertId of run.routedExpertIds) expertIdSet.add(expertId);
    }

    let highestSeverity: ExpertSeverity | null = null;
    for (const finding of matchingFindings) {
      highestSeverity = higherSeverity(highestSeverity, finding.severity);
    }

    return {
      attachment,
      email,
      displayStatus: resolveAttachmentDisplayStatus(attachment.processingStatus, linkedDocument?.processingStatus ?? null),
      linkedDocument,
      consideredByAcc,
      expertIds: Array.from(expertIdSet),
      findings: {
        count: matchingFindings.length,
        highestSeverity,
        findingIds: matchingFindings.map((f) => f.id),
      },
      sameContentOccurrenceCount: occurrencesByHash.get(attachment.sha256Hash) ?? 1,
    } satisfies EmailAttachmentRegistryRow;
  });
}
