"use client";

// Resolução de arquivos originais de evidência (seção 5/7) — client-side,
// reaproveitando o MESMO padrão de acesso ao Storage já usado em
// DocumentDownloadButton (createSignedUrl + fetch). Nunca usa service_role:
// roda com a sessão do usuário logado, então só resolve o que a RLS já
// permite ao usuário ver. Nenhuma evidência é omitida silenciosamente —
// toda evidência sem arquivo real disponível gera uma entrada UNAVAILABLE
// com a frase exigida no manifesto.

import { createSupabaseBrowserClient } from "@axion/db/browser";
import type { ContractEvent } from "@axion/types";

import { buildEmailTextRepresentation, sanitizeFileNameSegment } from "./email-representation";
import type { ManifestEvidenceEntry, TimelineDocumentContext, TimelineEmailContext } from "./types";

const UNAVAILABLE_REASON = "Fonte referenciada, arquivo original não disponível para exportação.";

export interface ResolvedEvidenceFile {
  entry: ManifestEvidenceEntry;
  content: Blob | null;
}

export interface ResolveEvidenceFilesInput {
  events: ContractEvent[];
  documentVersionsById: Map<string, TimelineDocumentContext>;
  emailsById: Map<string, TimelineEmailContext>;
}

async function fetchDocumentBlob(
  bucket: string,
  filePath: string
): Promise<Blob | null> {
  const supabase = createSupabaseBrowserClient();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, 60);

  if (error || !data?.signedUrl) {
    return null;
  }

  const response = await fetch(data.signedUrl);
  if (!response.ok) {
    return null;
  }

  return await response.blob();
}

/**
 * Resolve, um a um, o arquivo original (ou representação legível) de cada
 * evidência dos eventos informados. Roda no browser porque o acesso a
 * Storage nesta base de código é sempre client-side (signed URL), nunca via
 * Route Handler.
 */
export async function resolveEvidenceFiles({
  events,
  documentVersionsById,
  emailsById,
}: ResolveEvidenceFilesInput): Promise<ResolvedEvidenceFile[]> {
  const resolved: ResolvedEvidenceFile[] = [];
  let sequence = 0;

  for (const event of events) {
    for (const evidence of event.evidence) {
      sequence += 1;
      const evidenceId = evidence.id ?? `${event.id}:${sequence}`;
      const filePrefix = String(sequence).padStart(3, "0");

      if (evidence.documentVersionId) {
        const doc = documentVersionsById.get(evidence.documentVersionId);

        if (doc?.filePath && doc.storageBucket) {
          const blob = await fetchDocumentBlob(doc.storageBucket, doc.filePath);

          if (blob) {
            const originalFileName = doc.originalFileName ?? evidence.label;
            resolved.push({
              content: blob,
              entry: {
                eventId: event.id,
                evidenceId,
                label: evidence.label,
                locator: evidence.locator,
                status: "INCLUDED",
                packagedFileName: `${filePrefix}_${sanitizeFileNameSegment(originalFileName)}`,
                originalFileName: doc.originalFileName,
                reason: null,
              },
            });
            continue;
          }
        }

        resolved.push({
          content: null,
          entry: {
            eventId: event.id,
            evidenceId,
            label: evidence.label,
            locator: evidence.locator,
            status: "UNAVAILABLE",
            packagedFileName: null,
            originalFileName: doc?.originalFileName ?? null,
            reason: UNAVAILABLE_REASON,
          },
        });
        continue;
      }

      if (evidence.emailId) {
        const email = emailsById.get(evidence.emailId);

        if (email) {
          const text = buildEmailTextRepresentation(email);
          resolved.push({
            content: new Blob([text], { type: "text/plain;charset=utf-8" }),
            entry: {
              eventId: event.id,
              evidenceId,
              label: evidence.label,
              locator: evidence.locator,
              status: "GENERATED_REPRESENTATION",
              packagedFileName: `${filePrefix}_email_${sanitizeFileNameSegment(email.emailId)}.txt`,
              originalFileName: null,
              reason: "Representação legível gerada pelo sistema — o arquivo .eml original não é armazenado nesta fase.",
            },
          });
          continue;
        }
      }

      resolved.push({
        content: null,
        entry: {
          eventId: event.id,
          evidenceId,
          label: evidence.label,
          locator: evidence.locator,
          status: "UNAVAILABLE",
          packagedFileName: null,
          originalFileName: null,
          reason: UNAVAILABLE_REASON,
        },
      });
    }
  }

  return resolved;
}
