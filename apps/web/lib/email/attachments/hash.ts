// Hashing determinístico de conteúdo — nenhum utilitário de hash
// existia no projeto antes desta fase (grep confirmou). SHA-256 em hex
// minúsculo, sempre — é o formato validado pela CHECK constraint de
// email_attachments.sha256_hash (^[0-9a-f]{64}$).

import { createHash } from "node:crypto";

export function computeSha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
