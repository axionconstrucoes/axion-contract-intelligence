// Assinatura institucional ACC anexada a TODO e-mail enviado pelo
// sistema (nunca a assinatura pessoal do Google Workspace — essa nunca é
// tocada). Reaproveita ACC_SENDER_DISPLAY_NAME (sender-identity.ts) como
// única fonte do texto "ACC AXION CONTROLE DE CONTRATOS", nunca duplicado.
//
// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone. A
// leitura do arquivo do logo (I/O real) vive em load-acc-logo-inline-image.ts.

import { ACC_SENDER_DISPLAY_NAME } from "../sender-identity";

/** Content-ID referenciado como "cid:" dentro do HTML da assinatura. */
export const ACC_EMAIL_LOGO_CID = "acc-logo-signature";

export function buildAccEmailSignatureText(): string {
  return ACC_SENDER_DISPLAY_NAME;
}

/**
 * `hasInlineLogo` reflete se o arquivo real do logo está disponível
 * nesta execução (load-acc-logo-inline-image.ts) — quando não está,
 * NUNCA referencia "cid:" (isso quebraria a exibição em qualquer cliente
 * de e-mail); a assinatura cai para texto em negrito, sem imagem.
 */
export function buildAccEmailSignatureHtml(hasInlineLogo: boolean): string {
  const logoCell = hasInlineLogo
    ? `<td style="vertical-align:middle;padding-right:8px;"><img src="cid:${ACC_EMAIL_LOGO_CID}" alt="ACC" width="28" height="28" style="display:block;border:0;" /></td>`
    : "";

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;">`,
    "<tr>",
    logoCell,
    `<td style="vertical-align:middle;"><span style="font-size:12px;font-weight:bold;letter-spacing:0.02em;color:#000000;">${ACC_SENDER_DISPLAY_NAME}</span></td>`,
    "</tr>",
    "</table>",
  ].join("");
}

/**
 * Anexa a assinatura ao final do texto/HTML já prontos — nunca reescreve
 * o conteúdo existente, só adiciona um bloco novo ao fim. `html` só
 * aparece no retorno quando já estava presente na entrada (nunca cria um
 * canal HTML que não existia).
 */
export function appendAccEmailSignature(email: { text: string; html?: string }, hasInlineLogo: boolean): { text: string; html?: string } {
  const text = `${email.text}\n\n— \n${buildAccEmailSignatureText()}`;
  if (!email.html) return { text };
  return { text, html: `${email.html}\n${buildAccEmailSignatureHtml(hasInlineLogo)}` };
}
