// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// E-mail de LOTE de alertas de contrato: UMA mensagem reúne vários alertas do mesmo
// destinatário — inclusive de OBRAS DIFERENTES: cada caixa mostra a obra do PRÓPRIO alerta no
// cabeçalho ("RISCO [NÍVEL] | [OBRA]") e o lote nunca é pintado pelo risco mais grave.
//
// Os três botões (RESOLVIDO / EM ANDAMENTO / ENVIADO P/) são LINKS para a página de confirmação
// — nunca um <select>/<form>/JavaScript dentro do e-mail (Gmail/Outlook não suportam, e ENVIADO P/
// exige escolher um colaborador). Abrir o link NUNCA grava nada: quem registra é a confirmação
// explícita na página. VER EVENTO deixou de existir: o TÍTULO do alerta é o link para o evento.
//
// Resposta parcial: cada ação confirmada na página é salva na hora; o botão final RESPONDER AO ACC
// só é liberado quando TODOS os alertas tiverem uma ação. O alerta sem resposta (e os em andamento
// ou encaminhados) voltam em novo e-mail conforme o risco (acompanhamento recorrente).

import type { AlertSeverity } from "@axion/types";

import { ACC_EMAIL_LOGO_CID } from "@/lib/email/branding/acc-email-signature";
import {
  ACC_COLOR_BODY,
  ACC_COLOR_HEADING,
  ACC_COLOR_MUTED,
  ACC_FONT_FAMILY,
  ACC_FONT_SIZE_AUX,
  ACC_FONT_SIZE_BODY,
  ACC_FONT_SIZE_TITLE,
} from "@/lib/email/brand-style";
import {
  ALERT_TONES,
  BUTTON_COLUMN_WIDTH_PX,
  HEADER_GAP_PX,
  buildActionsPanelHtml,
  buildAlertBoxHtml,
  buildAlertHeaderHtml,
  buildThreeActionButtonsHtml,
  type ThreeActions,
} from "@/lib/email/templates/alert-box-style";
import {
  alertClauseHtml,
  alertClauseText,
  alertDescriptionHtml,
  alertEvidenceHtml,
  alertEvidenceText,
  alertRepeatHtml,
  alertTitleHtml,
} from "@/lib/email/templates/alert-body-parts";
import { repeatNoticeText } from "@/lib/alerts/repeat-policy";
import { alertRiskLevelLabels, escapeHtml, type ContractAlertEvidenceItem } from "./contract-alert-template";

export interface ContractAlertBatchEmailItem {
  eventId: string;
  title: string; // "título/evento"
  severity: AlertSeverity; // "grau de risco"
  riskDescription: string; // "descrição do risco"
  /** Obra DESTE alerta (um lote pode reunir obras diferentes). Padrão: input.projectName. */
  projectName?: string;
  clauseLabel: string | null; // ex.: "Cláusula 8.2 – Prazos e Cronograma" (verificada); null = pendente
  clauseText: string | null; // texto da cláusula, quando disponível
  evidence: ContractAlertEvidenceItem[]; // links para a origem; sem referência = "Pendente de confirmação"
  // Link neutro (sem token) direto para este evento no ACC — vira o link do TÍTULO.
  eventUrl: string;
  // Link para o bloco DESTE evento dentro da página do lote.
  respondItemUrl: string;
  // Página mínima de ação rápida, sem dashboard/sidebar.
  quickActionUrl?: string;
}

export interface ContractAlertBatchEmailInput {
  recipientName: string | null;
  /** Obra padrão dos itens que não informam a sua. */
  projectName: string;
  // Link único para a página do lote (CTA principal do rodapé).
  batchUrl: string;
  items: ContractAlertBatchEmailItem[];
  hasInlineLogo: boolean;
  // Logo INVERTIDO para as caixas CRÍTICO/ALTO — padrão: segue hasInlineLogo.
  hasInlineInvertedLogo?: boolean;
}

export interface ContractAlertBatchEmail {
  subject: string;
  html: string;
  text: string;
}

const alertRiskSubjectMarkers: Record<AlertSeverity, string> = {
  BAIXA: "🟢",
  MEDIA: "🔵",
  ALTA: "🟡",
  CRITICA: "🔴",
};

const SEVERITY_ORDER: Record<AlertSeverity, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };

function highestSeverity(items: readonly ContractAlertBatchEmailItem[]): AlertSeverity {
  return items.reduce<AlertSeverity>(
    (highest, item) => (SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[highest] ? item.severity : highest),
    "BAIXA"
  );
}

function projectOf(item: ContractAlertBatchEmailItem, fallback: string): string {
  return item.projectName?.trim() || fallback;
}

// Assunto: quantidade de alertas e o maior grau de risco; obra única -> nome da obra; obras
// diferentes -> contagem de obras (nunca finge que o lote é de uma obra só).
export function buildContractAlertBatchSubject(projectName: string, items: readonly ContractAlertBatchEmailItem[]): string {
  const worst = highestSeverity(items);
  const count = items.length;
  const plural = count === 1 ? "alerta" : "alertas";
  const projects = Array.from(new Set(items.map((item) => projectOf(item, projectName))));
  const where = projects.length === 1 ? `OBRA ${projects[0].toUpperCase()}` : `${projects.length} obras`;
  return `${alertRiskSubjectMarkers[worst]} [ACC] ${count} ${plural} de contrato — ${where}`;
}

// Cabeçalho do e-mail (fora das caixas): logo oficial + "ACC - Acompanhamento de Contratos".
// A obra aparece no cabeçalho de CADA caixa, não aqui.
function buildOuterHeaderHtml(hasInlineLogo: boolean): string {
  const logoCell = hasInlineLogo
    ? `<td style="vertical-align:middle;padding-right:8px;"><img src="cid:${ACC_EMAIL_LOGO_CID}" alt="ACC" width="29" height="29" style="display:block;border:0;width:29px;height:29px;" /></td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${logoCell}<td style="vertical-align:middle;"><p style="margin:0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_TITLE};font-weight:bold;color:${ACC_COLOR_HEADING};">ACC - Acompanhamento de Contratos</p></td></tr></table>`;
}

function buildRespondActionUrl(item: ContractAlertBatchEmailItem, action: ThreeActions): string {
  const url = new URL(item.quickActionUrl ?? item.respondItemUrl);
  url.searchParams.set("acao", action);
  return url.toString();
}

function buildItemHtml(
  item: ContractAlertBatchEmailItem,
  fallbackProject: string,
  logos: { maroon: boolean; inverted: boolean }
): string {
  const tone = ALERT_TONES[item.severity];
  const riskLabel = alertRiskLevelLabels[item.severity];

  const inner = `
    ${buildAlertHeaderHtml(item.severity, riskLabel, projectOf(item, fallbackProject), logos)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${HEADER_GAP_PX}px;">
      <tr>
        <td class="acc-batch-content-col" valign="top" style="padding:0;word-break:break-word;color:${tone.text};">
          ${alertTitleHtml(item.title, item.eventUrl, item.severity)}
          ${alertDescriptionHtml(item.riskDescription, item.severity)}
          ${alertClauseHtml({ label: item.clauseLabel, text: item.clauseText }, item.severity)}
          ${alertEvidenceHtml(item.evidence, item.severity)}
          ${alertRepeatHtml(item.severity)}
        </td>
        <td class="acc-batch-actions-col" valign="top" width="${BUTTON_COLUMN_WIDTH_PX}" style="width:${BUTTON_COLUMN_WIDTH_PX}px;padding:0 0 0 16px;">
          ${buildActionsPanelHtml(buildThreeActionButtonsHtml((action) => buildRespondActionUrl(item, action)))}
        </td>
      </tr>
    </table>`;

  return `
  <tr><td id="evento-${escapeHtml(item.eventId)}" style="padding:0 24px 16px 24px;">
    ${buildAlertBoxHtml(item.severity, inner)}
  </td></tr>`;
}

function buildItemText(item: ContractAlertBatchEmailItem, fallbackProject: string): string {
  const riskLabel = alertRiskLevelLabels[item.severity];
  return [
    `— RISCO ${riskLabel} | ${projectOf(item, fallbackProject)} —`,
    `${item.title} — ${item.eventUrl}`,
    item.riskDescription,
    alertClauseText({ label: item.clauseLabel, text: item.clauseText }),
    alertEvidenceText(item.evidence),
    repeatNoticeText(item.severity),
    `RESOLVIDO: ${buildRespondActionUrl(item, "RESOLVIDO")}`,
    `EM ANDAMENTO: ${buildRespondActionUrl(item, "EM_ANDAMENTO")}`,
    `ENVIADO P/: ${buildRespondActionUrl(item, "ENVIADO_PARA")}`,
  ].join("\n");
}

// Constrói {subject, html, text} do e-mail de LOTE. Mesma identidade das caixas do alerta
// individual; cada alerta é um bloco INDEPENDENTE (obra, risco, cor e botões próprios).
export function buildContractAlertBatchEmail(input: ContractAlertBatchEmailInput): ContractAlertBatchEmail {
  const subject = buildContractAlertBatchSubject(input.projectName, input.items);
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const logos = { maroon: input.hasInlineLogo, inverted: input.hasInlineInvertedLogo ?? input.hasInlineLogo };

  const itemsHtml = input.items.map((item) => buildItemHtml(item, input.projectName, logos)).join("");

  const html = `
<style>
  @media only screen and (max-width:640px) {
    .acc-batch-content-col, .acc-batch-actions-col { display:block !important; width:100% !important; }
    .acc-batch-actions-col { padding:16px 0 0 0 !important; }
  }
</style>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="820" cellpadding="0" cellspacing="0" style="width:100%;max-width:820px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:20px 24px 16px 24px;">
          <p style="margin:0 0 12px 0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">${escapeHtml(greeting)}</p>
          ${buildOuterHeaderHtml(input.hasInlineLogo)}
        </td></tr>
        ${itemsHtml}
        <tr><td style="padding:8px 24px 20px 24px;border-top:1px solid #e5e7eb;text-align:center;">
          <a href="${escapeHtml(input.batchUrl)}" style="display:inline-block;margin-top:12px;padding:12px 28px;background-color:${ACC_COLOR_HEADING};color:#ffffff;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;text-decoration:none;border-radius:6px;">RESPONDER AO ACC</a>
          <p style="margin:10px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_MUTED};">Cada ação confirmada é salva na hora. Este botão só libera o envio da resposta final depois que TODOS os alertas acima tiverem uma ação; os pendentes voltam a ser lembrados conforme o risco.</p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_MUTED};font-size:${ACC_FONT_SIZE_AUX};">
            Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.
          </p>
        </td></tr>
      </table>
    </td>
  </tr>
</table>`.trim();

  const text = [
    "ACC - Acompanhamento de Contratos",
    "",
    greeting,
    `Este e-mail reúne ${input.items.length} ${input.items.length === 1 ? "alerta" : "alertas"} de contrato — cada um precisa de uma ação própria antes que a resposta final ao ACC possa ser enviada. Cada ação confirmada é salva na hora.`,
    "",
    ...input.items.flatMap((item) => [buildItemText(item, input.projectName), ""]),
    `RESPONDER AO ACC (só libera depois que todos os alertas acima tiverem uma ação): ${input.batchUrl}`,
    "",
    "Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.",
  ].join("\n");

  return { subject, html, text };
}
