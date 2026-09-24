// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone
// (mesmo padrão de contract-alert-template.ts).
//
// E-mail de LOTE: um único e-mail pode reunir vários eventos/alertas
// (requisito 1 do prompt "MÚLTIPLOS ALERTAS E BLOQUEIO DE REPLY"). Cada
// alerta é um bloco INDEPENDENTE (título/evento, descrição do risco,
// grau de risco, cláusula, evidências) com sua própria coluna de ações
// alinhada verticalmente ao lado — nunca uma única coluna de ações
// genérica para todos os alertas.
//
// A coluna de ações de cada alerta, AQUI NO E-MAIL, é só um convite
// visual/navegacional para abrir aquele evento específico ou ir direto
// para o bloco correspondente na página de resposta do lote — nunca um
// <select>/<form>/JavaScript dentro do e-mail (Gmail/Outlook não
// suportam, e a ação "ENVIADO P/" exige escolher um colaborador, o que
// só é possível numa página real). Quem de fato registra
// RESOLVIDO/EM ANDAMENTO/ENVIADO P/ é a página do lote
// (apps/web/app/[projectId]/ledger/lote-alertas/[batchId]) — ver
// contract-alert-batch-form.tsx — nunca o e-mail em si.

import type { AlertSeverity } from "@axion/types";

import { ACC_EMAIL_LOGO_CID } from "@/lib/email/branding/acc-email-signature";
import {
  ACC_COLOR_BODY,
  ACC_COLOR_HEADING,
  ACC_COLOR_MUTED,
  ACC_FONT_FAMILY,
  ACC_FONT_SIZE_AUX,
  ACC_FONT_SIZE_BODY,
  ACC_FONT_SIZE_SECTION,
  ACC_FONT_SIZE_TITLE,
} from "@/lib/email/brand-style";
import {
  alertRiskLevelLabels,
  BADGE_STYLES,
  escapeHtml,
  evidenceItemHtml,
  evidenceItemText,
  type ContractAlertEvidenceItem,
} from "./contract-alert-template";

export interface ContractAlertBatchEmailItem {
  eventId: string;
  title: string; // "título/evento"
  severity: AlertSeverity; // "grau de risco"
  riskDescription: string; // "descrição do risco"
  clauseLabel: string | null; // "cláusula" — ex.: "Cláusula 8.2 – Prazos e Cronograma"
  clauseText: string | null; // texto da cláusula, quando disponível
  evidence: ContractAlertEvidenceItem[]; // "evidências"
  // Link neutro (sem token) direto para este evento no ACC — mesmo
  // espírito de eventUrl em contract-alert-template.ts.
  eventUrl: string;
  // Link para o bloco DESTE evento dentro da página do lote (âncora
  // "#evento-<eventId>") — é aqui, e só aqui, que a ação real
  // (RESOLVIDO/EM ANDAMENTO/ENVIADO P/) é registrada.
  respondItemUrl: string;
}

export interface ContractAlertBatchEmailInput {
  recipientName: string | null;
  projectName: string; // "obra"
  // Link único para a página do lote (usado no CTA principal do
  // rodapé) — a mesma página que respondItemUrl de cada item aponta,
  // só sem âncora.
  batchUrl: string;
  items: ContractAlertBatchEmailItem[];
  hasInlineLogo: boolean;
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

// Assunto reflete a quantidade de alertas e o maior grau de risco entre
// eles (requisito 7: "o mesmo e-mail pode conter CRÍTICO/ALTO/MÉDIO/
// BAIXO... cada evento mantém seu próprio label e cor") — nunca finge
// que o lote inteiro tem um único grau de risco quando não tem.
export function buildContractAlertBatchSubject(projectName: string, items: readonly ContractAlertBatchEmailItem[]): string {
  const worst = highestSeverity(items);
  const count = items.length;
  const plural = count === 1 ? "alerta" : "alertas";
  return `${alertRiskSubjectMarkers[worst]} [ACC] ${count} ${plural} de contrato — OBRA ${projectName.toUpperCase()}`;
}

// Logo do e-mail de LOTE ~25% MENOR que o logo do e-mail de alerta
// único (38px, EMAIL_LOGO_ATTR_SIZE_PX de contract-alert-template.ts):
// 38 * 0.75 = 28.5px — arredondado para 29px. Cabeçalho deliberadamente
// mais compacto que o de um único alerta, porque aqui ele antecede N
// blocos de alerta, não só um.
const EMAIL_LOGO_PREVIOUS_SIZE_PX = 38;
const EMAIL_LOGO_REDUCTION_FACTOR = 0.75;
const EMAIL_LOGO_SIZE_PX = Math.round(EMAIL_LOGO_PREVIOUS_SIZE_PX * EMAIL_LOGO_REDUCTION_FACTOR);

// Cabeçalho compacto: logo + "ACC - Acompanhamento de Contratos" (texto
// do layout aprovado) na mesma linha, nome do projeto em vermelho/negrito
// na linha abaixo — mesmo texto/cores validados no mockup do piloto.
function buildHeaderHtml(hasInlineLogo: boolean, projectName: string): string {
  const logoCell = hasInlineLogo
    ? `<td style="vertical-align:middle;padding-right:8px;"><img src="cid:${ACC_EMAIL_LOGO_CID}" alt="ACC" width="${EMAIL_LOGO_SIZE_PX}" height="${EMAIL_LOGO_SIZE_PX}" style="display:block;border:0;width:${EMAIL_LOGO_SIZE_PX}px;height:${EMAIL_LOGO_SIZE_PX}px;" /></td>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${logoCell}<td style="vertical-align:middle;">
    <p style="margin:0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;color:${ACC_COLOR_BODY};">ACC - Acompanhamento de Contratos</p>
    <p style="margin:2px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_TITLE};font-weight:bold;color:${ACC_COLOR_HEADING};">${escapeHtml(projectName)}</p>
  </td></tr></table>`;
}

// As 4 cores/rótulos do layout aprovado. VER EVENTO é o único link REAL
// (sem token, sempre disponível, nunca conta como resposta). RESOLVIDO/
// EM ANDAMENTO/ENVIADO P/ aqui são indicadores visuais/navegacionais —
// todos levam ao MESMO lugar (o bloco deste evento na página do lote),
// nunca gravam nada por si só: Gmail/Outlook não suportam <select>, e
// ENVIADO P/ exige escolher um colaborador, o que só é possível numa
// página real (ver contract-alert-batch-form.tsx). A cor/rótulo de cada
// botão é só uma prévia do que será escolhido na página — nunca finge
// que o clique já registrou a ação.
const BATCH_ACTION_BUTTON_STYLES = {
  VER_EVENTO: { background: "#FFD600", color: "#000000", label: "VER EVENTO" },
  RESOLVIDO: { background: "#1B2A4A", color: "#ffffff", label: "RESOLVIDO" },
  EM_ANDAMENTO: { background: "#15803D", color: "#ffffff", label: "EM ANDAMENTO" },
  ENVIADO_PARA: { background: "#F97316", color: "#ffffff", label: "ENVIADO P/" },
} as const;

function buildBatchActionButtonHtml(
  href: string,
  style: { background: string; color: string; label: string },
  title: string,
  marginTop: string
): string {
  return `<a href="${escapeHtml(href)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(`${style.label} — ${title}`)}" style="display:block;width:100%;box-sizing:border-box;margin:${marginTop} 0 0 0;padding:8px 10px;background-color:${style.background};color:${style.color};font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;text-decoration:none;border-radius:6px;text-align:center;">${escapeHtml(style.label)}</a>`;
}

// Bloco de ações de UM alerta — alinhado ao lado do conteúdo do MESMO
// alerta (requisito 1: "a coluna de ações deve ficar alinhada
// verticalmente com o respectivo alerta"), nunca uma coluna
// compartilhada entre alertas.
function buildRespondActionUrl(
  item: ContractAlertBatchEmailItem,
  action: "RESOLVIDO" | "EM_ANDAMENTO" | "ENVIADO_PARA"
): string {
  const url = new URL(item.respondItemUrl);
  url.searchParams.set("acao", action);
  url.searchParams.set("evento", item.eventId);
  return url.toString();
}

function buildItemActionsColumnHtml(item: ContractAlertBatchEmailItem): string {
  const verEvento = buildBatchActionButtonHtml(
    item.eventUrl,
    BATCH_ACTION_BUTTON_STYLES.VER_EVENTO,
    "Abre o evento completo no ACC — somente consulta, não conta como resposta.",
    "0"
  );
  const resolvido = buildBatchActionButtonHtml(
    buildRespondActionUrl(item, "RESOLVIDO"),
    BATCH_ACTION_BUTTON_STYLES.RESOLVIDO,
    "Abre este alerta na página do ACC com RESOLVIDO pré-selecionado.",
    "8px"
  );
  const emAndamento = buildBatchActionButtonHtml(
    buildRespondActionUrl(item, "EM_ANDAMENTO"),
    BATCH_ACTION_BUTTON_STYLES.EM_ANDAMENTO,
    "Abre este alerta na página do ACC com EM ANDAMENTO pré-selecionado.",
    "8px"
  );
  const enviadoPara = buildBatchActionButtonHtml(
    buildRespondActionUrl(item, "ENVIADO_PARA"),
    BATCH_ACTION_BUTTON_STYLES.ENVIADO_PARA,
    "Abre este alerta na página do ACC com ENVIADO P/ pré-selecionado e o destinatário visível.",
    "8px"
  );
  const caption = `<p style="margin:8px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_MUTED};text-align:center;">A resposta a este e-mail só é liberada depois que TODOS os alertas do lote tiverem uma ação.</p>`;

  return `${verEvento}${resolvido}${emAndamento}${enviadoPara}${caption}`;
}

function buildItemHtml(item: ContractAlertBatchEmailItem, index: number): string {
  const badge = BADGE_STYLES[item.severity];
  const riskLabel = alertRiskLevelLabels[item.severity];
  const badgeHtml = `<span style="display:inline-block;background-color:${badge.background};color:${badge.color};font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;padding:5px 12px;border-radius:999px;">RISCO ${escapeHtml(riskLabel)}</span>`;

  const clauseHtml =
    item.clauseLabel || item.clauseText
      ? `<p style="margin:12px 0 2px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;color:${ACC_COLOR_HEADING};text-transform:uppercase;letter-spacing:0.02em;">Cláusula impactada</p>
         ${item.clauseLabel ? `<p style="margin:0 0 4px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};color:${ACC_COLOR_BODY};font-weight:bold;">${escapeHtml(item.clauseLabel)}</p>` : ""}
         ${item.clauseText ? `<p style="margin:0;padding:8px 12px;border-left:3px solid #9ca3af;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_MUTED};font-style:italic;">&ldquo;${escapeHtml(item.clauseText)}&rdquo;</p>` : ""}`
      : "";

  const evidenceHtml =
    item.evidence.length > 0
      ? `<ul style="margin:4px 0 0 0;padding-left:16px;">${item.evidence.map(evidenceItemHtml).join("")}</ul>`
      : `<span style="font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_MUTED};font-size:${ACC_FONT_SIZE_AUX};">Nenhuma evidência vinculada nesta fase.</span>`;

  return `
  <tr><td id="evento-${escapeHtml(item.eventId)}" style="padding:${index === 0 ? "0" : "20px"} 24px 20px 24px;${index === 0 ? "" : "border-top:1px solid #e5e7eb;"}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="acc-batch-content-col" valign="top" width="64%" style="width:64%;padding:0 24px 0 0;word-break:break-word;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
            <td style="vertical-align:middle;padding-right:8px;">${badgeHtml}</td>
            <td style="vertical-align:middle;"><h2 style="margin:0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;color:${ACC_COLOR_HEADING};word-break:break-word;">${escapeHtml(item.title)}</h2></td>
          </tr></table>
          <p style="margin:0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};color:${ACC_COLOR_BODY};"><strong>Risco:</strong> ${escapeHtml(item.riskDescription)}</p>
          ${clauseHtml}
          <p style="margin:14px 0 4px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;color:${ACC_COLOR_HEADING};text-transform:uppercase;letter-spacing:0.02em;">Evidências</p>
          ${evidenceHtml}
        </td>
        <td class="acc-batch-actions-col" valign="top" width="36%" style="width:36%;padding:0 0 0 4px;border-left:1px solid #e5e7eb;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 0 0 20px;">
            ${buildItemActionsColumnHtml(item)}
          </td></tr></table>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

function buildItemText(item: ContractAlertBatchEmailItem): string {
  const riskLabel = alertRiskLevelLabels[item.severity];
  return [
    `— ${item.title} (RISCO ${riskLabel}) —`,
    `Risco: ${item.riskDescription}`,
    ...(item.clauseLabel ? [`Cláusula impactada: ${item.clauseLabel}`] : []),
    ...(item.clauseText ? [`"${item.clauseText}"`] : []),
    "Evidências:",
    item.evidence.length > 0 ? item.evidence.map(evidenceItemText).join("\n") : "Nenhuma evidência vinculada nesta fase.",
    `Ver evento: ${item.eventUrl}`,
    `Responder a este alerta (RESOLVIDO/EM ANDAMENTO/ENVIADO P/): ${item.respondItemUrl}`,
  ].join("\n");
}

// Constrói {subject, html, text} do e-mail de LOTE de alertas de
// contrato. Layout: mesma identidade visual institucional do alerta
// individual (contract-alert-template.ts) — cabeçalho com marca/logo,
// duas colunas por alerta (conteúdo ~64% / ações ~36%), tabelas +
// estilos inline (Gmail/Outlook). Cada alerta é um bloco INDEPENDENTE,
// separado por uma borda superior, nunca uma coluna de ações
// compartilhada entre alertas.
export function buildContractAlertBatchEmail(input: ContractAlertBatchEmailInput): ContractAlertBatchEmail {
  const subject = buildContractAlertBatchSubject(input.projectName, input.items);
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";

  const itemsHtml = input.items.map((item, index) => buildItemHtml(item, index)).join("");

  const html = `
<style>
  @media only screen and (max-width:640px) {
    .acc-batch-content-col, .acc-batch-actions-col { display:block !important; width:100% !important; }
    .acc-batch-actions-col { padding:16px 0 0 0 !important; border-left:none !important; border-top:1px solid #e5e7eb !important; }
  }
</style>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="820" cellpadding="0" cellspacing="0" style="width:100%;max-width:820px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:20px 24px 0 24px;">
          <p style="margin:0 0 12px 0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">${escapeHtml(greeting)}</p>
          ${buildHeaderHtml(input.hasInlineLogo, input.projectName)}
        </td></tr>
        ${itemsHtml}
        <tr><td style="padding:20px 24px;border-top:1px solid #e5e7eb;text-align:center;">
          <a href="${escapeHtml(input.batchUrl)}" style="display:inline-block;padding:12px 28px;background-color:${ACC_COLOR_HEADING};color:#ffffff;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;text-decoration:none;border-radius:6px;">RESPONDER AO ACC</a>
          <p style="margin:10px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_MUTED};">Este botão só libera o envio depois que TODOS os alertas acima tiverem uma ação definida na página do ACC.</p>
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
    input.projectName,
    "",
    greeting,
    `Este e-mail reúne ${input.items.length} ${input.items.length === 1 ? "alerta" : "alertas"} de contrato — cada um precisa de uma ação própria antes que a resposta ao ACC possa ser enviada.`,
    "",
    ...input.items.flatMap((item) => [buildItemText(item), ""]),
    `RESPONDER AO ACC (só libera depois que todos os alertas acima tiverem uma ação): ${input.batchUrl}`,
    "",
    "Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.",
  ].join("\n");

  return { subject, html, text };
}
