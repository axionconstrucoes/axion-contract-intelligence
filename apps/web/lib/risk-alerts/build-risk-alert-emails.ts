// Templates dos e-mails de alerta de risco — puros, sem I/O, mesmo
// padrão institucional ACC dos templates existentes (badge de risco,
// fundo branco, texto preto, remetente "ACC AXION CONTROLE DE CONTRATOS"
// resolvido pelo provider, assinatura anexada por quem envia).
//
// Conteúdo mínimo (imediato/escalonamento): projeto, grau de risco,
// origem, resumo, impacto, prazo aplicável, nível atual, responsável,
// data/hora, recomendação, link seguro para o ACC (rota do projeto — sem
// token, sem URL assinada), necessidade de confirmação e de justificativa.
// Consolidado: resumo executivo, quantidade por risco, itens Médios,
// itens Baixos, prazos, responsáveis e links individuais.
// Nunca: tokens, anexos, conteúdo contratual extenso, dados de outro projeto.

import type { AlertSeverity } from "@axion/types";

import type { EmailActionButton } from "@/lib/email-actions/render-buttons";
import { renderEmailActionButtonsHtml, renderEmailActionButtonsText } from "@/lib/email-actions/render-buttons";
import { alertRiskLevelLabels, BADGE_STYLES, buildContractAlertSubject } from "@/lib/email/templates/contract-alert-template";
import { slaAreaLabels } from "@/lib/labels";
import type { SlaRiskLevel } from "@/lib/sla/types";

import { ALERT_ACTION_LABELS, type AlertActionType, type DigestContent, type DigestItem, type ImmediateAlertContent } from "./types";

export const RISK_LEVEL_TO_SEVERITY: Record<SlaRiskLevel, AlertSeverity> = {
  LOW: "BAIXA",
  MEDIUM: "MEDIA",
  HIGH: "ALTA",
  CRITICAL: "CRITICA",
};

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function formatDateTimeBR(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function row(label: string, value: string | null): string {
  if (!value) return "";
  return `<tr><td style="padding:6px 0;color:#000000;font-size:13px;font-weight:bold;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0 6px 12px;color:#000000;font-size:13px;">${escapeHtml(value)}</td></tr>`;
}

function textRow(label: string, value: string | null): string {
  return value ? `${label}: ${value}` : "";
}

/** Link seguro: rota interna do projeto (exige login no ACC) — nunca token/URL assinada. */
export function buildProjectLink(baseUrl: string, projectId: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${cleanBase}/${projectId}/${cleanPath}`;
}

export interface ImmediateEmailInput {
  content: ImmediateAlertContent;
  projectId: string;
  projectName: string;
  recipientName: string | null;
  baseUrl: string;
  timeZone: string;
  generatedAt: string;
  actionButtons: EmailActionButton[];
  /** Links das 5 ações formais (página autenticada; token curto/expirável). */
  actionLinks?: Partial<Record<AlertActionType, string>>;
  /** Código visível do alerta (fallback de correlação da resposta por e-mail). */
  visibleCode?: string | null;
}

const EMAIL_ACTION_ORDER: AlertActionType[] = ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"];
const EMAIL_ACTION_BUTTON_LABELS: Record<AlertActionType, string> = { ...ALERT_ACTION_LABELS, FORWARD: "ENVIAR PARA", EXPERT_CONSULTATION: "CONSULTAR ESPECIALISTA" };

function renderActionLinksHtml(links: Partial<Record<AlertActionType, string>> | undefined): string {
  if (!links) return "";
  return EMAIL_ACTION_ORDER.filter((a) => links[a])
    .map((a) => `<a href="${escapeHtml(links[a]!)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 14px;background-color:#ffffff;color:#7F1D1D;border:1px solid #7F1D1D;font-size:12px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(EMAIL_ACTION_BUTTON_LABELS[a])}</a>`)
    .join("");
}

function renderActionLinksText(links: Partial<Record<AlertActionType, string>> | undefined): string[] {
  if (!links) return [];
  return EMAIL_ACTION_ORDER.filter((a) => links[a]).map((a) => `${EMAIL_ACTION_BUTTON_LABELS[a]}: ${links[a]}`);
}

export function buildImmediateRiskAlertEmail(input: ImmediateEmailInput): BuiltEmail {
  const { content } = input;
  const severity = RISK_LEVEL_TO_SEVERITY[content.riskLevel];
  const badge = BADGE_STYLES[severity];
  const riskLabel = alertRiskLevelLabels[severity];
  const isEscalation = content.kind === "ESCALATION";
  const subjectBase = buildContractAlertSubject(input.projectName, severity);
  const codeTag = input.visibleCode ? ` [ACC-ALERTA:${input.visibleCode}]` : "";
  const subject = (isEscalation ? `${subjectBase} - ESCALONADO ${content.levelLabel.toUpperCase()}` : content.changed ? `${subjectBase} - ATUALIZADO` : subjectBase) + codeTag;
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const headline = isEscalation
    ? `Risco sem tratamento escalado para ${content.levelLabel}`
    : content.changed
      ? `Risco ${riskLabel} atualizado: ${content.caseTitle}`
      : `Novo risco ${riskLabel}: ${content.caseTitle}`;
  const originUrl = buildProjectLink(input.baseUrl, input.projectId, content.originPath);
  const actionUrl = content.slaActionId ? buildProjectLink(input.baseUrl, input.projectId, `acoes/${content.slaActionId}`) : buildProjectLink(input.baseUrl, input.projectId, "acoes");
  const requirements = [
    content.requiresAcknowledgment ? "confirmação de ciência obrigatória" : "confirmação de ciência não exigida",
    content.requiresJustification ? "justificativa obrigatória em caso de atraso" : "justificativa de atraso não exigida",
  ].join("; ");
  const rows: Array<[string, string | null]> = [
    ["Projeto", input.projectName],
    ["Grau de risco", riskLabel],
    ["Origem", `${content.reference} · área ${slaAreaLabels[content.area]}`],
    ["Resumo", content.summary],
    ["Impacto", content.impact || null],
    [content.deadlineLabel, formatDateTimeBR(content.deadlineAt, input.timeZone)],
    ["Nível atual", content.levelLabel],
    ["Nível anterior", content.previousLevelLabel],
    ["Responsável (Nível 1)", content.responsibleName],
    ["Motivo do escalonamento", content.escalationReason],
    ["Recomendação do Expert", content.recommendation],
    ["Exigências da Matriz", requirements],
    ["Gerado em", formatDateTimeBR(input.generatedAt, input.timeZone)],
  ];

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:20px 24px 8px 24px;"><span style="font-size:12px;font-weight:bold;letter-spacing:0.04em;color:#000000;">ACC · AXION CONTROLE DE CONTRATOS</span></td></tr>
      <tr><td style="padding:0 24px 16px 24px;"><span style="display:inline-block;background-color:${badge.background};color:${badge.color};font-size:13px;font-weight:bold;padding:6px 14px;border-radius:999px;">RISCO ${escapeHtml(riskLabel)}${isEscalation ? ` · ${escapeHtml(content.levelLabel.toUpperCase())}` : ""}</span></td></tr>
      <tr><td style="padding:0 24px 4px 24px;">
        <p style="margin:0 0 12px 0;color:#000000;font-size:14px;">${escapeHtml(greeting)}</p>
        <h1 style="margin:0 0 12px 0;color:#000000;font-size:18px;">${escapeHtml(headline)}</h1>
      </td></tr>
      <tr><td style="padding:0 24px 16px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(([l, v]) => row(l, v)).join("")}</table></td></tr>
      <tr><td style="padding:8px 24px 24px 24px;">
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;background-color:#111827;color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;">Abrir no ACC</a>
        <a href="${escapeHtml(originUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;background-color:#ffffff;color:#111827;border:1px solid #111827;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;">Ver evidência de origem</a>
        ${renderEmailActionButtonsHtml(input.actionButtons, content.caseTitle)}
      </td></tr>
      ${input.actionLinks ? `<tr><td style="padding:0 24px 16px 24px;"><p style="margin:0 0 8px 0;color:#000000;font-size:13px;font-weight:bold;">Ações sobre este alerta (abrem o ACC autenticado para confirmação):</p>${renderActionLinksHtml(input.actionLinks)}<p style="margin:4px 0 0 0;color:#4B5563;font-size:11px;">Você também pode simplesmente RESPONDER a este e-mail: sua resposta será registrada no alerta${input.visibleCode ? ` (código ${escapeHtml(input.visibleCode)})` : ""}.</p></td></tr>` : ""}
      <tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:11px;">Alerta gerado automaticamente pelo ACC a partir da Matriz de responsabilidades e prazos do projeto — não é uma decisão de IA. Fato, inferência e recomendação estão separados na tela do ACC.</p></td></tr>
    </table>
  </td></tr>
</table>`.trim();

  const text = [
    "ACC - AXION Controle de Contratos",
    `RISCO ${riskLabel}${isEscalation ? ` · ${content.levelLabel.toUpperCase()}` : ""}`,
    "",
    greeting,
    headline,
    "",
    ...rows.map(([l, v]) => textRow(l, v)).filter(Boolean),
    "",
    `Abrir no ACC: ${actionUrl}`,
    `Evidência de origem: ${originUrl}`,
    renderEmailActionButtonsText(input.actionButtons),
    ...(input.actionLinks ? ["", "Ações sobre este alerta (abrem o ACC autenticado para confirmação):", ...renderActionLinksText(input.actionLinks), input.visibleCode ? `Ou responda a este e-mail (código ${input.visibleCode}).` : "Ou responda a este e-mail."] : []),
    "",
    "Alerta gerado automaticamente pelo ACC a partir da Matriz de responsabilidades e prazos do projeto.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return { subject, html, text };
}

export interface DigestEmailInput {
  content: DigestContent;
  projectId: string;
  projectName: string;
  recipientName: string | null;
  baseUrl: string;
  timeZone: string;
  generatedAt: string;
}

function digestItemHtml(item: DigestItem, input: DigestEmailInput): string {
  const url = buildProjectLink(input.baseUrl, input.projectId, item.slaActionId ? `acoes/${item.slaActionId}` : item.originPath);
  const state = item.state === "NEW" ? "NOVO" : item.state === "CHANGED" ? "ALTERADO" : item.state === "CLOSED" ? "ENCERRADO" : "EM ABERTO";
  return `<li style="margin:0 0 10px 0;color:#000000;font-size:13px;"><strong>[${escapeHtml(state)}] ${escapeHtml(item.title)}</strong><br/>${escapeHtml(item.summary)}<br/><span style="color:#4B5563;">Área ${escapeHtml(slaAreaLabels[item.area])} · Prazo para assumir: ${escapeHtml(formatDateTimeBR(item.deadlineAt, input.timeZone))} · Responsável: ${escapeHtml(item.responsibleName ?? "não definido")}</span><br/><a href="${escapeHtml(url)}" style="color:#111827;">Abrir no ACC</a></li>`;
}

function digestItemText(item: DigestItem, input: DigestEmailInput): string {
  const url = buildProjectLink(input.baseUrl, input.projectId, item.slaActionId ? `acoes/${item.slaActionId}` : item.originPath);
  const state = item.state === "NEW" ? "NOVO" : item.state === "CHANGED" ? "ALTERADO" : item.state === "CLOSED" ? "ENCERRADO" : "EM ABERTO";
  return `- [${state}] ${item.title}\n  ${item.summary}\n  Área ${slaAreaLabels[item.area]} · Prazo para assumir: ${formatDateTimeBR(item.deadlineAt, input.timeZone)} · Responsável: ${item.responsibleName ?? "não definido"}\n  ${url}`;
}

export function buildRiskDigestEmail(input: DigestEmailInput): BuiltEmail {
  const { content } = input;
  const [year, month, day] = content.window.split("-");
  const subject = `OBRA ${input.projectName.toUpperCase()} - CONSOLIDADO SEMANAL DE RISCOS BAIXO/MÉDIO (${day}/${month}/${year})`;
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const summary = `${content.mediumItems.length} risco(s) MÉDIO(S), ${content.lowItems.length} risco(s) BAIXO(S) em aberto; ${content.closedItems.length} encerrado(s) desde o último consolidado.`;
  const section = (title: string, items: DigestItem[]) =>
    items.length === 0
      ? `<h2 style="margin:16px 0 4px 0;color:#000000;font-size:15px;">${escapeHtml(title)}</h2><p style="margin:0;color:#4B5563;font-size:13px;">Nenhum item.</p>`
      : `<h2 style="margin:16px 0 4px 0;color:#000000;font-size:15px;">${escapeHtml(title)}</h2><ul style="margin:0;padding-left:18px;">${items.map((i) => digestItemHtml(i, input)).join("")}</ul>`;

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:20px 24px 8px 24px;"><span style="font-size:12px;font-weight:bold;letter-spacing:0.04em;color:#000000;">ACC · AXION CONTROLE DE CONTRATOS</span></td></tr>
      <tr><td style="padding:0 24px 16px 24px;">
        <p style="margin:0 0 12px 0;color:#000000;font-size:14px;">${escapeHtml(greeting)}</p>
        <h1 style="margin:0 0 8px 0;color:#000000;font-size:18px;">Consolidado semanal de riscos — ${escapeHtml(input.projectName)}</h1>
        <p style="margin:0 0 4px 0;color:#000000;font-size:14px;"><strong>Resumo executivo:</strong> ${escapeHtml(summary)}</p>
        <p style="margin:0;color:#4B5563;font-size:12px;">Janela: quarta-feira ${escapeHtml(`${day}/${month}/${year}`)} 07:00 (${escapeHtml(input.timeZone)}) · gerado em ${escapeHtml(formatDateTimeBR(input.generatedAt, input.timeZone))}</p>
        ${section(`Riscos MÉDIOS (${content.mediumItems.length})`, content.mediumItems)}
        ${section(`Riscos BAIXOS (${content.lowItems.length})`, content.lowItems)}
        ${content.closedItems.length > 0 ? section(`Encerrados desde o último consolidado (${content.closedItems.length})`, content.closedItems) : ""}
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:11px;">Riscos BAIXO e MÉDIO não geram e-mail individual: são reunidos neste consolidado às quartas-feiras, 07:00 (${escapeHtml(input.timeZone)}). Alertas ALTO e CRÍTICO são enviados imediatamente.</p></td></tr>
    </table>
  </td></tr>
</table>`.trim();

  const text = [
    "ACC - AXION Controle de Contratos",
    `CONSOLIDADO SEMANAL DE RISCOS — ${input.projectName}`,
    "",
    greeting,
    `Resumo executivo: ${summary}`,
    `Janela: quarta-feira ${day}/${month}/${year} 07:00 (${input.timeZone}) · gerado em ${formatDateTimeBR(input.generatedAt, input.timeZone)}`,
    "",
    `RISCOS MÉDIOS (${content.mediumItems.length})`,
    ...(content.mediumItems.length ? content.mediumItems.map((i) => digestItemText(i, input)) : ["Nenhum item."]),
    "",
    `RISCOS BAIXOS (${content.lowItems.length})`,
    ...(content.lowItems.length ? content.lowItems.map((i) => digestItemText(i, input)) : ["Nenhum item."]),
    ...(content.closedItems.length ? ["", `ENCERRADOS DESDE O ÚLTIMO CONSOLIDADO (${content.closedItems.length})`, ...content.closedItems.map((i) => digestItemText(i, input))] : []),
  ].join("\n");

  return { subject, html, text };
}

// ------------------------------------------------------------------
// E-mails de acompanhamento na MESMA thread do alerta: encaminhamento
// (ENVIAR P/), devolução por falta de ação, resposta do Expert e
// confirmação de ação. Mesmo padrão institucional; sem anexos/tokens.
// ------------------------------------------------------------------
export interface FollowUpEmailInput {
  kind: "FORWARD" | "RETURNED" | "EXPERT_ANSWER" | "ACTION_CONFIRMATION";
  projectId: string;
  projectName: string;
  recipientName: string | null;
  baseUrl: string;
  timeZone: string;
  generatedAt: string;
  caseId: string;
  caseTitle: string;
  riskLevel: SlaRiskLevel;
  visibleCode: string | null;
  /** Pares rótulo/valor específicos do tipo (responsável anterior/novo, prazo, instrução, recomendação...). */
  rows: Array<[string, string | null]>;
  /** Parágrafos livres (ex.: resposta do Expert — recomenda, não executa). */
  paragraphs?: string[];
  requiresHumanReview?: boolean;
  actionLinks?: Partial<Record<AlertActionType, string>>;
}

const FOLLOW_UP_TITLES: Record<FollowUpEmailInput["kind"], string> = {
  FORWARD: "Alerta encaminhado para você",
  RETURNED: "Alerta devolvido ao responsável anterior (sem ação do encaminhado)",
  EXPERT_ANSWER: "Resposta do Expert (recomendação — revisão humana)",
  ACTION_CONFIRMATION: "Ação registrada no alerta",
};

export function buildAlertFollowUpEmail(input: FollowUpEmailInput): BuiltEmail {
  const severity = RISK_LEVEL_TO_SEVERITY[input.riskLevel];
  const badge = BADGE_STYLES[severity];
  const riskLabel = alertRiskLevelLabels[severity];
  const codeTag = input.visibleCode ? ` [ACC-ALERTA:${input.visibleCode}]` : "";
  const subject = `${buildContractAlertSubject(input.projectName, severity)} - ${FOLLOW_UP_TITLES[input.kind].toUpperCase()}${codeTag}`;
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const alertUrl = buildProjectLink(input.baseUrl, input.projectId, `alertas/${input.caseId}`);
  const rows: Array<[string, string | null]> = [["Projeto", input.projectName], ["Grau de risco", riskLabel], ["Alerta", input.caseTitle], ...input.rows, ["Gerado em", formatDateTimeBR(input.generatedAt, input.timeZone)]];
  const review = input.requiresHumanReview ? `<p style="margin:8px 0 0 0;color:#7F1D1D;font-size:13px;font-weight:bold;">O Expert apenas recomenda: nenhuma ação foi executada e o alerta continua aberto até decisão humana.</p>` : "";
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:20px 24px 8px 24px;"><span style="font-size:12px;font-weight:bold;letter-spacing:0.04em;color:#000000;">ACC · AXION CONTROLE DE CONTRATOS</span></td></tr>
      <tr><td style="padding:0 24px 16px 24px;"><span style="display:inline-block;background-color:${badge.background};color:${badge.color};font-size:13px;font-weight:bold;padding:6px 14px;border-radius:999px;">RISCO ${escapeHtml(riskLabel)}</span></td></tr>
      <tr><td style="padding:0 24px 4px 24px;"><p style="margin:0 0 12px 0;color:#000000;font-size:14px;">${escapeHtml(greeting)}</p><h1 style="margin:0 0 12px 0;color:#000000;font-size:18px;">${escapeHtml(FOLLOW_UP_TITLES[input.kind])}</h1>${(input.paragraphs ?? []).map((p) => `<p style="margin:0 0 10px 0;color:#000000;font-size:14px;white-space:pre-wrap;">${escapeHtml(p)}</p>`).join("")}${review}</td></tr>
      <tr><td style="padding:0 24px 16px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(([l, v]) => row(l, v)).join("")}</table></td></tr>
      <tr><td style="padding:8px 24px 24px 24px;"><a href="${escapeHtml(alertUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;background-color:#111827;color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;">Abrir alerta no ACC</a>${renderActionLinksHtml(input.actionLinks)}</td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:11px;">Mensagem gerada pelo ACC na conversa deste alerta. Você pode responder diretamente a este e-mail.</p></td></tr>
    </table>
  </td></tr>
</table>`.trim();
  const text = [
    "ACC - AXION Controle de Contratos",
    `RISCO ${riskLabel} · ${FOLLOW_UP_TITLES[input.kind]}`,
    "",
    greeting,
    ...(input.paragraphs ?? []),
    ...(input.requiresHumanReview ? ["O Expert apenas recomenda: nenhuma ação foi executada e o alerta continua aberto até decisão humana."] : []),
    "",
    ...rows.map(([l, v]) => textRow(l, v)).filter(Boolean),
    "",
    `Abrir alerta no ACC: ${alertUrl}`,
    ...renderActionLinksText(input.actionLinks),
  ].join("\n");
  return { subject, html, text };
}
