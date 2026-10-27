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
import { ACC_EMAIL_LOGO_CID, ACC_EMAIL_LOGO_INVERTED_CID } from "./acc-email-signature";

const LOGO_FILE_NAME = "acc-logo.png";
// Derivado do arquivo oficial por scripts/derive-acc-logo-inverted.mjs (vinho <-> branco).
const LOGO_INVERTED_FILE_NAME = "acc-logo-invertido.png";

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

/**
 * Versão INVERTIDA do logo oficial (fundos escuros: caixas de risco CRÍTICO
 * e ALTO). Mesmo contrato de loadAccLogoInlineImage: nunca lança; null
 * quando o arquivo não existe/não pode ser lido.
 */
export function loadAccLogoInvertedInlineImage(appRootDir: string = process.cwd()): InlineImageAttachment | null {
  const filePath = path.join(appRootDir, "public", "branding", LOGO_INVERTED_FILE_NAME);

  if (!existsSync(filePath)) return null;

  try {
    const buffer = readFileSync(filePath);
    return {
      cid: ACC_EMAIL_LOGO_INVERTED_CID,
      filename: LOGO_INVERTED_FILE_NAME,
      mimeType: "image/png",
      contentBase64: buffer.toString("base64"),
    };
  } catch {
    return null;
  }
}

/**
 * Logos que as caixas de alerta precisam: só anexa a imagem que algum alerta
 * do e-mail realmente usa (`needs`), para não inflar o e-mail à toa.
 */
export function loadAccAlertLogos(
  needs: { maroon: boolean; inverted: boolean },
  appRootDir: string = process.cwd()
): { images: InlineImageAttachment[]; availability: { maroon: boolean; inverted: boolean } } {
  const maroon = needs.maroon ? loadAccLogoInlineImage(appRootDir) : null;
  const inverted = needs.inverted ? loadAccLogoInvertedInlineImage(appRootDir) : null;
  return {
    images: [maroon, inverted].filter((image): image is InlineImageAttachment => image !== null),
    availability: { maroon: maroon !== null, inverted: inverted !== null },
  };
}
