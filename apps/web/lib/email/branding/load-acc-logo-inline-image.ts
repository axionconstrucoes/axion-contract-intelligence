// Leitura do arquivo real do logo ACC para embutir por Content-ID na
// assinatura institucional dos e-mails enviados. Nunca lança — quando o
// arquivo ainda não existe em public/branding/acc-logo.png (ou não pode
// ser lido), retorna null e o envio segue normalmente com assinatura só
// em texto (ver appendAccEmailSignature) — a ausência do logo nunca
// bloqueia nem quebra o envio de um e-mail.
//
// Só leitura de arquivo local, sem segredo algum — deliberadamente sem
// "server-only" (mesmo padrão de email-provider.ts/mime-message.ts) para
// ser testável por um script Node standalone.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { InlineImageAttachment } from "../email-provider";
import { ACC_EMAIL_LOGO_CID } from "./acc-email-signature";

const LOGO_FILE_NAME = "acc-logo.png";

// `appRootDir` default (process.cwd()) é correto em produção: o processo
// Next.js sempre roda com cwd = apps/web (é assim que "next dev"/"next
// build"/"next start" resolvem "public/" nesta monorepo, via `npm run
// ... --workspace=apps/web`). Só existe como parâmetro para permitir um
// script Node standalone (rodado a partir da raiz do repo, cwd
// diferente) testar esta função apontando para o apps/web real — nunca
// para mudar o comportamento em produção.
export function loadAccLogoInlineImage(appRootDir: string = process.cwd()): InlineImageAttachment | null {
  const filePath = path.join(appRootDir, "public", "branding", LOGO_FILE_NAME);

  if (!existsSync(filePath)) return null;

  try {
    const buffer = readFileSync(filePath);
    return {
      cid: ACC_EMAIL_LOGO_CID,
      filename: LOGO_FILE_NAME,
      mimeType: "image/png",
      contentBase64: buffer.toString("base64"),
    };
  } catch {
    return null;
  }
}
