import "server-only";

import { getEmailProvider } from "./get-email-provider";
import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";

export async function sendSystemHealthAlertEmail(input: {
  recipientEmail: string;
  projectName: string;
  sourceType: string;
  summary: string;
  auditUrl: string;
}) {
  const subject = `[ALTO] ACC - FALHA OPERACIONAL - ${input.projectName}`;
  const text = `ACC · SUPERVISÃO OPERACIONAL\nRISCO ALTO\n\nFonte: ${input.sourceType}\nProblema: ${input.summary}\n\nAbrir Auditoria: ${input.auditUrl}\n\nO ACC suprimiu repetições desta mesma falha para evitar excesso de e-mails.`;
  const html = `<table role="presentation" width="100%" style="background:#fff;color:#000;padding:24px"><tr><td><p style="color:#000;font-weight:700">ACC · SUPERVISÃO OPERACIONAL</p><p><span style="display:inline-block;background:#f97316;color:#000;font-weight:700;padding:6px 12px;border-radius:999px">RISCO ALTO</span></p><p style="color:#000"><strong>Fonte:</strong> ${escapeHtml(input.sourceType)}</p><p style="color:#000"><strong>Problema:</strong> ${escapeHtml(input.summary)}</p><p><a href="${escapeHtml(input.auditUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:700">ABRIR AUDITORIA</a></p><p style="color:#6b7280;font-size:11px">O ACC suprimiu repetições desta mesma falha para evitar excesso de e-mails.</p></td></tr></table>`;
  const logo = loadAccLogoInlineImage();
  const signed = appendAccEmailSignature({ text, html }, logo !== null);
  return getEmailProvider().send({
    to: input.recipientEmail,
    subject,
    text: signed.text,
    html: signed.html,
    inlineImages: logo ? [logo] : undefined,
    correlationId: crypto.randomUUID(),
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
