// Puro, sem I/O. Bloco 6 — prioridade de vínculo entre um e-mail
// (resposta do cliente) e a document_version correta, exatamente na
// ordem especificada:
//   1. identificador interno da versão (explícito — usuário respondeu
//      a partir da própria tela do documento);
//   2. Message-ID/In-Reply-To/References;
//   3. thread do envio original;
//   4. hash ou identificador do anexo;
//   5. assunto/nome — só como candidato, NUNCA automático.
//
// LIMITAÇÃO REAL, DOCUMENTADA: o schema atual de `emails` (ver
// supabase/migrations/20260820125115_gmail_email_ingestion_foundation.sql)
// só grava message_id_header e provider_thread_id — NUNCA In-Reply-To
// nem References. O nível 2 da prioridade, portanto, nunca resolve
// nada nesta fase (sempre cai para o nível 3) — nunca inventado, nunca
// forjado. Documentado aqui, não escondido.
//
// "Vínculo inequívoco pode ser automático" = exatamente 1 candidato
// bate num nível decisivo (1-4). "Vínculo ambíguo exige escolha do
// documento" = 0 ou 2+ candidatos batem em todos os níveis decisivos —
// cai para SUBJECT_CANDIDATE, sempre não-automático.

import type { DocumentVersionLinkCandidate, InboundEmailForLinking } from "./types";

export interface DocumentVersionLinkResolution {
  status: "AUTOMATIC" | "AMBIGUOUS_NEEDS_HUMAN_CHOICE";
  linkMethod: "INTERNAL_VERSION_ID" | "MESSAGE_ID_REFERENCES" | "THREAD" | "ATTACHMENT_HASH" | "SUBJECT_CANDIDATE";
  // Preenchido só quando status=AUTOMATIC — a versão resolvida.
  documentVersionId: string | null;
  // Candidatos possíveis para escolha humana quando ambíguo (pode
  // incluir candidatos por assunto — nunca a decisão final).
  candidates: DocumentVersionLinkCandidate[];
  reason: string;
}

export function resolveDocumentVersionLinkCandidate(
  email: InboundEmailForLinking,
  candidates: DocumentVersionLinkCandidate[],
  options?: { explicitDocumentVersionId?: string | null }
): DocumentVersionLinkResolution {
  // Nível 1 — identificador interno explícito, sempre decisivo quando
  // fornecido (o usuário já sabe exatamente qual versão está
  // respondendo, ex.: a partir da própria tela do documento).
  if (options?.explicitDocumentVersionId) {
    return {
      status: "AUTOMATIC",
      linkMethod: "INTERNAL_VERSION_ID",
      documentVersionId: options.explicitDocumentVersionId,
      candidates: [],
      reason: "Identificador interno da versão fornecido explicitamente pelo usuário.",
    };
  }

  // Nível 2 — Message-ID/In-Reply-To/References: nunca resolve nesta
  // fase (ver limitação documentada acima) — cai sempre para o nível 3.

  // Nível 3 — thread do envio original.
  if (email.providerThreadId) {
    const threadMatches = candidates.filter((c) => c.originatingThreadId === email.providerThreadId);
    if (threadMatches.length === 1) {
      return {
        status: "AUTOMATIC",
        linkMethod: "THREAD",
        documentVersionId: threadMatches[0].documentVersionId,
        candidates: [],
        reason: `Thread do e-mail (${email.providerThreadId}) corresponde a exatamente 1 versão.`,
      };
    }
  }

  // Nível 4 — hash do anexo.
  if (email.attachmentSha256Hashes.length > 0) {
    const hashMatches = candidates.filter((c) =>
      c.fileSha256Hashes.some((hash) => email.attachmentSha256Hashes.includes(hash))
    );
    if (hashMatches.length === 1) {
      return {
        status: "AUTOMATIC",
        linkMethod: "ATTACHMENT_HASH",
        documentVersionId: hashMatches[0].documentVersionId,
        candidates: [],
        reason: "Hash de um anexo do e-mail corresponde a exatamente 1 versão.",
      };
    }
  }

  // Nível 5 — assunto/nome, SEMPRE candidato, nunca automático — nunca
  // transforma isso em aprovação/vínculo confirmado sem escolha humana.
  const subjectCandidates = candidates.filter(
    (c) => email.subject.toLowerCase().includes(c.documentTitle.toLowerCase()) || c.documentTitle.toLowerCase().includes(email.subject.toLowerCase())
  );

  return {
    status: "AMBIGUOUS_NEEDS_HUMAN_CHOICE",
    linkMethod: "SUBJECT_CANDIDATE",
    documentVersionId: null,
    candidates: subjectCandidates.length > 0 ? subjectCandidates : candidates,
    reason:
      subjectCandidates.length > 0
        ? "Nenhum vínculo inequívoco (id/thread/hash) — candidatos por semelhança de assunto, exige escolha humana."
        : "Nenhum vínculo inequívoco (id/thread/hash) nem candidato por assunto — exige escolha humana entre todas as versões do projeto.",
  };
}
