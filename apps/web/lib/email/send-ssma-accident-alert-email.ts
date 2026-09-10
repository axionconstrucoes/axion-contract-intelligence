import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";
import type { AlertSeverity } from "@axion/types";
import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccLogoInlineImage } from "./branding/load-acc-logo-inline-image";
import { EmailSendError } from "./email-provider";
import { getEmailProvider } from "./get-email-provider";
import { alertRiskLevelLabels, BADGE_STYLES, buildContractAlertSubject } from "./templates/contract-alert-template";

export interface SsmaAccidentAlertInput {
  projectId: string;
  submissionId: string;
  projectName: string;
  recipientEmail: string;
  recipientName: string | null;
  severity: Extract<AlertSeverity, "ALTA" | "CRITICA">;
  employeeName: string;
  leaveClassification: string;
  occurredAt: string;
  informedCause: string;
  accUrl: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

export async function sendSsmaAccidentAlertEmail(input: SsmaAccidentAlertInput) {
  const badge = BADGE_STYLES[input.severity];
  const riskLabel = alertRiskLevelLabels[input.severity];
  const subject = buildContractAlertSubject(input.projectName, input.severity);
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const text = [
    "ACC · AXION CONTROLE DE CONTRATOS",
    `RISCO ${riskLabel} · OCORRÊNCIA/ACIDENTE`,
    "",
    greeting,
    `Foi registrada uma ocorrência de SSMA na obra ${input.projectName}.`,
    `Funcionário: ${input.employeeName}`,
    `Classificação: ${input.leaveClassification}`,
    `Data e hora: ${input.occurredAt}`,
    `Causa informada: ${input.informedCause}`,
    "",
    `RESPONDER AO ACC: ${input.accUrl}`,
    "",
    "Comunicação automática determinística. A classificação e a investigação exigem revisão humana.",
  ].join("\n");
  const html = `<table role="presentation" width="100%" style="background:#fff;color:#000;padding:24px"><tr><td><p style="color:#000;font-weight:700">ACC · AXION CONTROLE DE CONTRATOS</p><p><span style="display:inline-block;background:${badge.background};color:${badge.color};font-weight:700;padding:6px 12px;border-radius:999px">RISCO ${escapeHtml(riskLabel)} · OCORRÊNCIA/ACIDENTE</span></p><p style="color:#000">${escapeHtml(greeting)}</p><p style="color:#000">Foi registrada uma ocorrência de SSMA na obra <strong>${escapeHtml(input.projectName)}</strong>.</p><table role="presentation" style="color:#000"><tr><td><strong>Funcionário</strong></td><td style="padding-left:12px">${escapeHtml(input.employeeName)}</td></tr><tr><td><strong>Classificação</strong></td><td style="padding-left:12px">${escapeHtml(input.leaveClassification)}</td></tr><tr><td><strong>Data e hora</strong></td><td style="padding-left:12px">${escapeHtml(input.occurredAt)}</td></tr><tr><td><strong>Causa informada</strong></td><td style="padding-left:12px">${escapeHtml(input.informedCause)}</td></tr></table><p><a href="${escapeHtml(input.accUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:700">RESPONDER AO ACC</a></p><p style="color:#6b7280;font-size:11px">Comunicação automática determinística. A classificação e a investigação exigem revisão humana.</p></td></tr></table>`;
  const inlineLogo = loadAccLogoInlineImage();
  const signed = appendAccEmailSignature({ text, html }, inlineLogo !== null);
  const provider = getEmailProvider();

  let result;
  try {
    result = await provider.send({
      to: input.recipientEmail,
      subject,
      text: signed.text,
      html: signed.html,
      inlineImages: inlineLogo ? [inlineLogo] : undefined,
      correlationId: crypto.randomUUID(),
    });
  } catch (error) {
    if (error instanceof EmailSendError) throw error;
    throw new EmailSendError("Falha inesperada ao comunicar a ocorrência de SSMA.");
  }

  const admin = createSupabaseAdminClient();
  await admin.from("emails").insert({
    project_id: input.projectId,
    from_address: result.from,
    to_address: input.recipientEmail,
    subject,
    sent_at: result.sentAt,
    snippet: text.slice(0, 280),
  });
  return result;
}
