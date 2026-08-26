// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.

import type { AlertSeverity } from "@axion/types";

import type { EmailActionButton } from "@/lib/email-actions/render-buttons";
import { renderEmailActionButtonsHtml, renderEmailActionButtonsText } from "@/lib/email-actions/render-buttons";

// Rótulo de RISCO (masculino: "RISCO ALTO") — deliberadamente distinto de
// severityLabels (apps/web/lib/labels.ts, "ALTA"/"Alta", feminino: usado
// para "Severidade"/"Prioridade" na UI). Os dois convivem: cada um serve
// um contexto gramatical diferente, nenhum substitui o outro.
export const alertRiskLevelLabels: Record<AlertSeverity, string> = {
  BAIXA: "BAIXO",
  MEDIA: "MÉDIO",
  ALTA: "ALTO",
  CRITICA: "CRÍTICO",
};

// "Serão exportados..." — aqui: "OBRA <NOME> - RISCO <NÍVEL>", ambos
// dinâmicos. Nunca um valor fixo/genérico.
export function buildContractAlertSubject(projectName: string, severity: AlertSeverity): string {
  return `ACC - ALERTAS DO CONTRATO - OBRA ${projectName.toUpperCase()} - RISCO ${alertRiskLevelLabels[severity]}`;
}

interface BadgeStyle {
  background: string;
  color: string;
}

// BAIXO: verde · MÉDIO: azul (nunca âmbar/amarelo/laranja-claro) ·
// ALTO: laranja · CRÍTICO: vermelho — todos com texto branco e destaque
// forte, exatamente como especificado. Exportado para ser reaproveitado
// por sla-escalation-template.ts — nunca duplicado.
export const BADGE_STYLES: Record<AlertSeverity, BadgeStyle> = {
  BAIXA: { background: "#16a34a", color: "#ffffff" },
  MEDIA: { background: "#2563eb", color: "#ffffff" },
  ALTA: { background: "#f97316", color: "#ffffff" },
  CRITICA: { background: "#dc2626", color: "#ffffff" },
};

export interface ContractAlertEmailInput {
  recipientName: string | null;
  projectName: string; // "obra"
  severity: AlertSeverity; // "risco"
  title: string;
  summary: string;
  relatedEventTitle: string | null; // "evento relacionado"
  contractualBasis: string | null; // "base contratual"
  keyEvidence: string[]; // "evidências principais" — rótulos/locators, nunca conteúdo binário
  potentialImpact: string | null; // "impacto potencial"
  recommendedAction: string | null; // "ação recomendada"
  responsibleName: string | null; // "responsável quando disponível"
  dueDate: string | null; // "prazo quando disponível" — ISO date
  eventUrl: string; // "link para abrir o evento no ACC" — neutro, sem token
  // Botões de ação (DAR CIÊNCIA/ASSUMIR RESPONSABILIDADE/DEFINIR PRAZO/
  // RESPONDER AO ACC) — vem de issueEmailAlertActionButtons(), nunca
  // montado aqui. Substitui o antigo campo único "respondUrl": RESPONDER
  // AO ACC agora é só mais um destes botões, todos com o mesmo padrão de
  // token seguro.
  actionButtons: EmailActionButton[];
}

export interface ContractAlertEmail {
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

// Constrói {subject, html, text} do padrão institucional de alerta
// contratual. Nunca inventa "responsável"/"prazo"/"ação recomendada" —
// quando o caller não tem essa informação real, o campo fica null e a
// linha correspondente simplesmente não aparece (nunca um placeholder
// fabricado tipo "A definir").
export function buildContractAlertEmail(input: ContractAlertEmailInput): ContractAlertEmail {
  const subject = buildContractAlertSubject(input.projectName, input.severity);
  const badge = BADGE_STYLES[input.severity];
  const riskLabel = alertRiskLevelLabels[input.severity];
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";

  const evidenceHtml =
    input.keyEvidence.length > 0
      ? `<ul style="margin:4px 0 0 0;padding-left:18px;color:#000000;font-size:13px;">${input.keyEvidence
          .map((item) => `<li style="margin-bottom:2px;">${escapeHtml(item)}</li>`)
          .join("")}</ul>`
      : `<span style="color:#000000;font-size:13px;">Nenhuma evidência vinculada nesta fase.</span>`;

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
              RISCO ${escapeHtml(riskLabel)}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 4px 24px;">
            <p style="margin:0 0 12px 0;color:#000000;font-size:14px;">${escapeHtml(greeting)}</p>
            <h1 style="margin:0 0 4px 0;color:#000000;font-size:18px;">${escapeHtml(input.title)}</h1>
            <p style="margin:0 0 16px 0;color:#000000;font-size:14px;">Obra: <strong>${escapeHtml(input.projectName)}</strong></p>
            <p style="margin:0 0 16px 0;color:#000000;font-size:14px;">${escapeHtml(input.summary)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 16px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${htmlRow("Evento relacionado", input.relatedEventTitle)}
              ${htmlRow("Base contratual", input.contractualBasis)}
              ${htmlRow("Impacto potencial", input.potentialImpact)}
              ${htmlRow("Ação recomendada", input.recommendedAction)}
              ${htmlRow("Responsável", input.responsibleName)}
              ${htmlRow("Prazo", input.dueDate)}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 16px 24px;">
            <p style="margin:0 0 4px 0;color:#000000;font-size:13px;font-weight:bold;">Evidências principais</p>
            ${evidenceHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 24px 24px;">
            <a href="${escapeHtml(input.eventUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;background-color:#111827;color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;">Abrir evento no ACC</a>
            ${renderEmailActionButtonsHtml(input.actionButtons)}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#6b7280;font-size:11px;">
              Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.
              Você também pode responder diretamente a este e-mail (Responder do Gmail).
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();

  const fieldRows = [
    textRow("Evento relacionado", input.relatedEventTitle),
    textRow("Base contratual", input.contractualBasis),
    textRow("Impacto potencial", input.potentialImpact),
    textRow("Ação recomendada", input.recommendedAction),
    textRow("Responsável", input.responsibleName),
    textRow("Prazo", input.dueDate),
  ].filter((row) => row !== "");

  const text = [
    `ACC - AXION Controle de Contratos`,
    `RISCO ${riskLabel}`,
    "",
    greeting,
    input.title,
    `Obra: ${input.projectName}`,
    "",
    input.summary,
    ...(fieldRows.length > 0 ? ["", ...fieldRows] : []),
    "",
    "Evidências principais:",
    input.keyEvidence.length > 0
      ? input.keyEvidence.map((item) => `- ${item}`).join("\n")
      : "Nenhuma evidência vinculada nesta fase.",
    "",
    `Abrir evento no ACC: ${input.eventUrl}`,
    ...(input.actionButtons.length > 0 ? ["", "Ações disponíveis:", renderEmailActionButtonsText(input.actionButtons)] : []),
    "",
    "Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.",
  ].join("\n");

  return { subject, html, text };
}
