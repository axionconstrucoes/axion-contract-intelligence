import "server-only";

import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { getEmailProvider } from "./get-email-provider";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

export async function sendVersionImpactReviewEmail(input: {
  recipientEmail: string;
  recipientName: string | null;
  projectName: string;
  documentName: string;
  previousRevision: string | null;
  newRevision: string;
  scheduleImpact: string;
  priceImpact: string;
  response: string;
  sentToBudget: boolean;
  accUrl: string;
}) {
  const isHigh = input.scheduleImpact !== "NAO" || input.priceImpact !== "NAO";
  const label = isHigh ? "ALTO" : "MÉDIO";
  const color = isHigh ? "#FFD600" : "#2563eb";
  const badgeTextColor = isHigh ? "#000000" : "#ffffff";
  const subject = `${isHigh ? "🟡" : "🔵"} [RISCO ${label}] ACC - NOVA VERSÃO - OBRA ${input.projectName.toUpperCase()}`;
  const summary = [
    `Arquivo: ${input.documentName}`,
    `Versão: ${input.previousRevision ?? "—"} → ${input.newRevision}`,
    `Impacto no prazo: ${input.scheduleImpact}`,
    `Impacto no preço: ${input.priceImpact}`,
    `Resposta do Planejamento: ${input.response}`,
    `Encaminhado ao Orçamento: ${input.sentToBudget ? "Sim" : "Não"}`,
  ];
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const body = appendAccEmailSignature({
    text: [`ACC · AXION CONTROLE DE CONTRATOS`, `RISCO ${label} · NOVA VERSÃO`, "", greeting, ...summary, "", `RESPONDER AO ACC: ${input.accUrl}`].join("\n"),
    html: `<div style="background:#fff;color:#000;padding:24px;font-family:Arial,sans-serif"><p><strong>ACC · AXION CONTROLE DE CONTRATOS</strong></p><p><span style="background:${color};color:${badgeTextColor};padding:6px 12px;border-radius:999px;font-weight:700">RISCO ${label} · NOVA VERSÃO</span></p><p>${escapeHtml(greeting)}</p>${summary.map((line) => `<p style="margin:6px 0">${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(input.accUrl)}" title="Causa do alerta: ${escapeHtml(input.response)}" style="background:#111827;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;font-weight:700">RESPONDER AO ACC</a></p><p style="color:#6b7280;font-size:11px">Aviso obrigatório à gestão, mesmo quando a análise não identifica impacto. Decisão sujeita à revisão humana.</p></div>`,
  }, false);
  return getEmailProvider().send({
    to: input.recipientEmail,
    subject,
    text: body.text,
    html: body.html,
    correlationId: crypto.randomUUID(),
  });
}
