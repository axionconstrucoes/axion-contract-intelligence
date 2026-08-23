// Fingerprint determinístico para dedup/incremental (seção 12 do
// requisito): mesma fonte + mesmo conteúdo ⇒ mesmo fingerprint ⇒ nunca
// reexecuta curadoria nem cria finding duplicado. Uma revisão nova
// (conteúdo mudou) sempre produz um fingerprint diferente.

import { createHash } from "node:crypto";

export function computeSourceFingerprint(input: { sourceType: string; sourceId: string; contentHash: string }): string {
  return createHash("sha256").update(`${input.sourceType}:${input.sourceId}:${input.contentHash}`).digest("hex");
}

export function computeFindingFingerprint(input: {
  findingType: string;
  sourceFingerprint: string;
  classification?: string | null;
}): string {
  return createHash("sha256")
    .update(`${input.findingType}:${input.sourceFingerprint}:${input.classification ?? ""}`)
    .digest("hex");
}
