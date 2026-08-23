// Template do e-mail de escalonamento (seção 12) — mesmo padrão
// institucional ACC do e-mail de Alerta de Contrato
// (contract-alert-template.ts): fundo branco, texto preto, badge de
// risco cor+texto, CRÍTICO com fundo vermelho/texto branco. Reaproveita
// buildContractAlertSubject/alertRiskLevelLabels — mesmo padrão de
// assunto e rótulo de risco, nunca duplicado.
//
// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.

import type { AlertSeverity } from "@axion/types";
import { alertRiskLevelLabels, buildContractAlertSubject } from "./contract-alert-template";

interface BadgeStyle {
  background: string;
  color: string;
}

const BADGE_STYLES: Record<AlertSeverity, BadgeStyle> = {
  BAIXA: { background: "#16a34a", color: "#ffffff" },
  MEDIA: { background: "#f59e0b", color: "#1a1200" },
  ALTA: { background: "#f97316", color: "#ffffff" },
  CRITICA: { background: "#dc2626", color: "#ffffff" },
};

export interface SlaEscalationEmailInput {
  recipientName: string | null;
  projectName: string;
  severity: AlertSeverity;
  actionTitle: string;
  currentResponsibleName: string | null;
  originalDeadline: string; // já formatado (ex.: "22/08/2026 14:00")
  overdueBy: string; // já formatado (ex.: "2h15min")
  escalationLevelLabel: string; // ex.: "2º Escalão", "Diretoria"
  recommendedAction: string | null;
  eventUrl: string;
  respondUrl: string;
}

export interface SlaEscalationEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlRow(label: string, value: string | null): string {
  if (!value) return "";
  return `
    <tr>
      <td style="padding:6px 0;color:#000000;font-size:13px;font-weight:bold;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:6px 0 6px 12px;color:#000000;font-size:13px;">${escapeHtml(value)}</td>
    </tr>`;
}

function textRow(label: string, value: string | null): string {
  if (!value) return "";
  return `${label}: ${value}`;
}

export function buildSlaEscalationEmail(input: SlaEscalationEmailInput): SlaEscalationEmail {
  const subject = buildContractAlertSubject(input.projectName, input.severity);
  const badge = BADGE_STYLES[input.severity];
  const riskLabel = alertRiskLevelLabels[input.severity];
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px 8px 24px;">
            <span style="font-size:12px;font-weight:bold;letter-spacing:0.04em;color:#000000;">ACC · AXION CONTROLE DE CONTRATOS</span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 16px 24px;">
            <span style="display:inline-block;background-color:${badge.background};color:${badge.color};font-size:13px;font-weight:bold;padding:6px 14px;border-radius:999px;">
              RISCO ${escapeHtml(riskLabel)} · ESCALONADO PARA ${escapeHtml(input.escalationLevelLabel.toUpperCase())}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 4px 24px;">
            <p style="margin:0 0 12px 0;color:#000000;font-size:14px;">${escapeHtml(greeting)}</p>
            <h1 style="margin:0 0 4px 0;color:#000000;font-size:18px;">Ação sem resolução foi escalada: ${escapeHtml(input.actionTitle)}</h1>
            <p style="margin:0 0 16px 0;color:#000000;font-size:14px;">Obra: <strong>${escapeHtml(input.projectName)}</strong></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 16px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${htmlRow("Responsável atual", input.currentResponsibleName)}
              ${htmlRow("Prazo original", input.originalDeadline)}
              ${htmlRow("Tempo excedido", input.overdueBy)}
              ${htmlRow("Nível de escalonamento", input.escalationLevelLabel)}
              ${htmlRow("Ação recomendada", input.recommendedAction)}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 24px 24px;">
            <a href="${escapeHtml(input.eventUrl)}" style="display:inline-block;margin-right:12px;padding:10px 18px;background-color:#111827;color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;">Abrir ação no ACC</a>
            <a href="${escapeHtml(input.respondUrl)}" style="display:inline-block;padding:10px 18px;background-color:#ffffff;color:#111827;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;border:1px solid #111827;">RESPONDER AO ACC</a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#6b7280;font-size:11px;">
              Este escalonamento foi gerado automaticamente pelo motor determinístico de SLA do ACC — não é uma decisão de IA.
              Você também pode responder diretamente a este e-mail (Responder do Gmail).
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();

  const fieldRows = [
    textRow("Responsável atual", input.currentResponsibleName),
    textRow("Prazo original", input.originalDeadline),
    textRow("Tempo excedido", input.overdueBy),
    textRow("Nível de escalonamento", input.escalationLevelLabel),
    textRow("Ação recomendada", input.recommendedAction),
  ].filter((row) => row !== "");

  const text = [
    `ACC - AXION Controle de Contratos`,
    `RISCO ${riskLabel} · ESCALONADO PARA ${input.escalationLevelLabel.toUpperCase()}`,
    "",
    greeting,
    `Ação sem resolução foi escalada: ${input.actionTitle}`,
    `Obra: ${input.projectName}`,
    ...(fieldRows.length > 0 ? ["", ...fieldRows] : []),
    "",
    `Abrir ação no ACC: ${input.eventUrl}`,
    `Responder ao ACC: ${input.respondUrl}`,
    "",
    "Este escalonamento foi gerado automaticamente pelo motor determinístico de SLA do ACC — não é uma decisão de IA.",
  ].join("\n");

  return { subject, html, text };
}
