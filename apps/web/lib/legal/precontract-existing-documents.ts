// Converte os documentos já carregados pela página (getManagedDocuments)
// nas duas formas de que a tela jurídica precisa:
//
//   1. `PrecontractExistingDocument[]` — o que hidrata o card depois de
//      um F5, para o usuário nunca precisar reenviar o mesmo arquivo;
//   2. `ExistingDocumentSnapshot[]` — o que `classifyCandidate` usa para
//      deduplicação e reconhecimento de nova versão.
//
// Funções puras: nenhuma query nova (a página já buscou os documentos) e
// nenhuma I/O — é o que permite testar hidratação e deduplicação sem
// banco.

import { toExistingDocumentSnapshots } from "@/lib/documents/multi-upload/queue-core";
import type { ExistingDocumentSnapshot } from "@/lib/documents/multi-upload/types";
import { CONTRACTUAL_KINDS } from "@/lib/documents/extraction/load-precontract-document-texts";
import type { PrecontractExistingDocument } from "./precontract-document-state";

const CONTRACTUAL_KIND_SET = new Set<string>(CONTRACTUAL_KINDS);

export interface ManagedDocumentLike {
  id: string;
  kind: string;
  title: string;
  versions: readonly {
    id: string;
    versionIndex: number;
    versionLabel: string;
    originalFileName: string | null;
    fileSizeBytes: number | null;
    sha256Hash: string | null;
  }[];
}

/** Versão vigente = maior `versionIndex`. */
function currentVersion(document: ManagedDocumentLike) {
  return document.versions.reduce<ManagedDocumentLike["versions"][number] | null>(
    (current, version) => (current === null || version.versionIndex > current.versionIndex ? version : current),
    null
  );
}

export function selectContractualDocuments(
  documents: readonly ManagedDocumentLike[]
): ManagedDocumentLike[] {
  return documents.filter((document) => CONTRACTUAL_KIND_SET.has(document.kind));
}

/**
 * Documentos contratuais ativos que já existem, na forma que o card
 * entende. Documento sem versão não entra — não há o que verificar.
 */
export function toPrecontractExistingDocuments(
  documents: readonly ManagedDocumentLike[]
): PrecontractExistingDocument[] {
  const result: PrecontractExistingDocument[] = [];

  for (const document of selectContractualDocuments(documents)) {
    const version = currentVersion(document);
    if (!version) continue;

    result.push({
      documentId: document.id,
      documentVersionId: version.id,
      title: document.title,
      kind: document.kind,
      versionLabel: version.versionLabel,
      fileName: version.originalFileName ?? document.title,
      sizeBytes: version.fileSizeBytes ?? 0,
    });
  }

  return result;
}

/**
 * Snapshots para `classifyCandidate`. Usa TODOS os documentos do
 * projeto, não só os contratuais: um arquivo idêntico já enviado como
 * outro tipo continua sendo duplicado.
 */
export function toClassificationSnapshots(
  documents: readonly ManagedDocumentLike[]
): ExistingDocumentSnapshot[] {
  return toExistingDocumentSnapshots(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      kind: document.kind,
      versions: document.versions.map((version) => ({
        versionIndex: version.versionIndex,
        sha256Hash: version.sha256Hash,
      })),
    }))
  );
}
