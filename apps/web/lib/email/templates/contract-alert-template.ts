// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.

import type { AlertSeverity } from "@axion/types";

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
import { repeatNoticeText } from "@/lib/alerts/repeat-policy";
import type { ContractConfrontationBlock } from "@/lib/email/build-confrontation-block";
import { ALERT_TONES, buildAlertBoxHtml, buildAlertHeaderHtml, panelStyle } from "@/lib/email/templates/alert-box-style";
import { EVIDENCE_EMAIL_DIRECTION_LABELS, type EvidenceEmailDirection } from "@/lib/email/evidence-email-direction";
import type { EmailActionButton } from "@/lib/email-actions/render-buttons";
import { ACC_ACTION_BUTTON_CLASS, renderEmailActionButtonsHtml, renderEmailActionButtonsText } from "@/lib/email-actions/render-buttons";

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

const alertRiskSubjectMarkers: Record<AlertSeverity, string> = {
  BAIXA: "🟢",
  MEDIA: "🔵",
  ALTA: "🟡",
  CRITICA: "🔴",
};

// "Serão exportados..." — aqui: "OBRA <NOME> - RISCO <NÍVEL>", ambos
// dinâmicos. Nunca um valor fixo/genérico.
export function buildContractAlertSubject(projectName: string, severity: AlertSeverity): string {
  return `${alertRiskSubjectMarkers[severity]} [RISCO ${alertRiskLevelLabels[severity]}] ACC - OBRA ${projectName.toUpperCase()}`;
}

interface BadgeStyle {
  background: string;
  color: string;
}

// BAIXO: verde · MÉDIO: azul (nunca âmbar/amarelo/laranja-claro) ·
// ALTO: amarelo · CRÍTICO: vermelho — contraste forte e padronizado.
// forte, exatamente como especificado. Indicador de STATUS, não hierarquia
// de texto — por isso não vem de brand-style.ts. Exportado para ser
// reaproveitado por sla-escalation-template.ts — nunca duplicado.
export const BADGE_STYLES: Record<AlertSeverity, BadgeStyle> = {
  BAIXA: { background: "#16a34a", color: "#ffffff" },
  MEDIA: { background: "#2563eb", color: "#ffffff" },
  ALTA: { background: "#FFD600", color: "#000000" },
  CRITICA: { background: "#dc2626", color: "#ffffff" },
};

// Cada evidência é texto simples (compatibilidade — nunca link, renderizado
// exatamente como antes), um e-mail (RECEBIDA/ENVIADA/DIREÇÃO NÃO
// IDENTIFICADA + De/Para/Data/Assunto — Parte G) ou outra fonte (tipo real
// do SourceType, ex. "Diário de Obra"). Nunca uma URI interna gmail://...
// no href — só HTTPS para a âncora estável da evidência no ACC.
export type ContractAlertEvidenceItem =
  | string
  | {
      kind: "EMAIL";
      url: string;
      direction: EvidenceEmailDirection;
      from: string;
      to: string;
      date: string; // já formatado
      subject: string;
    }
  | {
      kind: "OTHER";
      url: string;
      sourceTypeLabel: string;
      label: string;
    };

export interface ContractAlertEmailInput {
  recipientName: string | null;
  projectName: string; // "obra"
  severity: AlertSeverity; // "risco"
  title: string;
  summary: string;
  relatedEventTitle: string | null; // "evento relacionado"
  // Fallback genérico para cross-references que NÃO correspondem a um
  // candidato de confrontação aprovado (ex.: vínculo manual a documento/
  // e-mail/cronograma) — quando a cross-reference É um confronto aprovado,
  // ela sai daqui e vira um item de confrontationBlocks (estruturado,
  // Parte D), nunca as duas coisas ao mesmo tempo.
  contractualBasis: string | null;
  // Confronto Evento x Cláusula aprovado, estruturado em 5 partes
  // rastreáveis (Parte D) — normalmente 0 ou 1 item.
  confrontationBlocks: ContractConfrontationBlock[];
  keyEvidence: ContractAlertEvidenceItem[]; // "evidências principais"
  potentialImpact: string | null; // "impacto potencial"
  recommendedAction: string | null; // "ação recomendada"
  responsibleName: string | null; // "responsável quando disponível"
  dueDate: string | null; // "prazo quando disponível" — ISO date
  eventUrl: string; // "link para abrir o evento no ACC" — neutro, sem token
  // Botões de ação (DAR CIÊNCIA/ASSUMIR RESPONSABILIDADE/DEFINIR PRAZO/
  // RESPONDER AO ACC) — vem de issueEmailAlertActionButtons(), nunca
  // montado aqui.
  actionButtons: EmailActionButton[];
  // Reflete se o logo real está disponível nesta execução
  // (loadAccLogoInlineImage, decidido por send-contract-alert-email.ts,
  // ANTES de chamar este builder) — quando falso, o cabeçalho NUNCA
  // referencia "cid:" (isso quebraria a exibição em qualquer cliente de
  // e-mail), e cai para só o texto da marca, mesma regra já usada pela
  // assinatura (acc-email-signature.ts).
  hasInlineLogo: boolean;
  // Logo INVERTIDO (derivado do oficial) para as caixas CRÍTICO/ALTO — padrão:
  // segue hasInlineLogo (os dois arquivos são carregados juntos).
  hasInlineInvertedLogo?: boolean;
  // true só quando o alerta tem acompanhamento recorrente ativo (mostra
  // "Repete: …"). Padrão false: o e-mail individual manual não promete repetição.
  repeatNotice?: boolean;
}

export interface ContractAlertEmail {
  subject: string;
  html: string;
  text: string;
}

// Exportado (além do uso interno neste arquivo) para ser reaproveitado
// por contract-alert-batch-template.ts — nunca uma segunda implementação
// de escapeHtml/evidenceItemHtml/evidenceItemText divergente desta.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textRow(label: string, value: string | null): string {
  if (!value) return "";
  return `${label}: ${value}`;
}

// Nunca inclui a locator/gmail://: cada evidência com metadados (EMAIL ou
// OTHER) sempre tem uma url HTTPS própria; string simples (compat) nunca
// vira link.
export function evidenceItemHtml(item: ContractAlertEvidenceItem): string {
  const baseLiStyle = `margin-bottom:8px;font-family:${ACC_FONT_FAMILY};`;

  if (typeof item === "string") {
    return `<li style="${baseLiStyle}list-style:disc;font-size:${ACC_FONT_SIZE_BODY};color:${ACC_COLOR_BODY};word-break:break-word;">${escapeHtml(item)}</li>`;
  }

  const headerLabel = item.kind === "EMAIL" ? EVIDENCE_EMAIL_DIRECTION_LABELS[item.direction] : item.sourceTypeLabel;
  const detailRows =
    item.kind === "EMAIL"
      ? [
          `De: ${escapeHtml(item.from)}`,
          `Para: ${escapeHtml(item.to)}`,
          `Data: ${escapeHtml(item.date)}`,
          `Assunto: ${escapeHtml(item.subject)}`,
        ]
      : [escapeHtml(item.label)];

  return `<li style="${baseLiStyle}list-style:none;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;word-break:break-word;">
    <p style="margin:0 0 4px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;color:${ACC_COLOR_HEADING};text-transform:uppercase;letter-spacing:0.02em;">${escapeHtml(headerLabel)}</p>
    ${detailRows.map((row) => `<p style="margin:0 0 2px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_BODY};">${row}</p>`).join("")}
    <a href="${escapeHtml(item.url)}" style="display:inline-block;margin-top:4px;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_HEADING};text-decoration:underline;">Abrir evidência no ACC</a>
  </li>`;
}

export function evidenceItemText(item: ContractAlertEvidenceItem): string {
  if (typeof item === "string") return `- ${item}`;
  if (item.kind === "EMAIL") {
    const direction = EVIDENCE_EMAIL_DIRECTION_LABELS[item.direction];
    return `- ${direction} — De: ${item.from} — Para: ${item.to} — Data: ${item.date} — Assunto: ${item.subject} — ${item.url}`;
  }
  return `- ${item.sourceTypeLabel} — ${item.label} — ${item.url}`;
}

function confrontationBlockHtml(block: ContractConfrontationBlock): string {
  const section = (title: string, value: string) => `
    <p style="margin:0 0 2px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;color:${ACC_COLOR_HEADING};text-transform:uppercase;letter-spacing:0.02em;">${escapeHtml(title)}</p>
    <p style="margin:0 0 10px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};color:${ACC_COLOR_BODY};word-break:break-word;">${escapeHtml(value)}</p>`;

  return `
  <div style="margin-top:12px;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;background-color:#fafafa;">
    <p style="margin:0 0 10px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;color:${ACC_COLOR_HEADING};">Confronto contratual — Cláusula ${escapeHtml(block.clauseNumber)}</p>
    ${section("O que foi identificado no evento", block.eventFinding)}
    ${section("O que o contrato estabelece", block.contractProvision)}
    ${section("Conclusão do confronto", block.conclusion)}
    ${section("Possível impacto", block.potentialImpact)}
    <p style="margin:8px 0 6px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;color:${ACC_COLOR_HEADING};">${escapeHtml(block.approvedByLine)}</p>
    <a href="${escapeHtml(block.detailUrl)}" style="font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_HEADING};text-decoration:underline;">Ver confronto completo no ACC</a>
  </div>`;
}

function confrontationBlockText(block: ContractConfrontationBlock): string {
  return [
    `Confronto contratual — Cláusula ${block.clauseNumber}`,
    `O que foi identificado no evento: ${block.eventFinding}`,
    `O que o contrato estabelece: ${block.contractProvision}`,
    `Conclusão do confronto: ${block.conclusion}`,
    `Possível impacto: ${block.potentialImpact}`,
    block.approvedByLine,
    `Ver confronto completo no ACC: ${block.detailUrl}`,
  ].join("\n");
}

// Abre em ${eventUrl} (link neutro, sem token) — sempre disponível, mesmo
// sem qualquer botão de ação acionável emitido. Rótulo curto: a explicação
// vai em title/aria-label + legenda discreta sempre visível abaixo. Em
// caixas de fundo escuro o botão inverte (fundo branco, texto vinho) para
// manter contraste.
function buildOpenEventButtonHtml(eventUrl: string, severity: AlertSeverity): string {
  const dark = ALERT_TONES[severity].dark;
  const description = "Abre o evento completo no ACC.";
  const bg = dark ? "#ffffff" : ACC_COLOR_HEADING;
  const fg = dark ? ACC_COLOR_HEADING : "#ffffff";
  const button = `<a href="${escapeHtml(eventUrl)}" title="${escapeHtml(description)}" aria-label="${escapeHtml(
    `Abrir evento no ACC — ${description}`
  )}" class="acc-open-event-btn" style="display:block;width:100%;box-sizing:border-box;margin:0;padding:10px 14px;background-color:${bg};color:${fg};font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;text-decoration:none;border-radius:6px;text-align:center;">Abrir evento no ACC</a>`;
  const caption = `<p style="margin:4px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ALERT_TONES[severity].muted};text-align:center;">${escapeHtml(description)}</p>`;
  return `${button}${caption}`;
}

// Constrói {subject, html, text} do padrão institucional de alerta
// contratual. Nunca inventa "prazo"/"ação recomendada" — quando o caller
// não tem essa informação real, o campo fica null e a linha correspondente
// simplesmente não aparece (nunca um placeholder fabricado tipo "A definir").
//
// "Responsável" NÃO aparece no corpo do e-mail: quem recebe o alerta já é o
// destinatário. O responsável continua registrado nos registros internos, no
// histórico e na tabela de providências (input.responsibleName é mantido só
// por compatibilidade de chamadores e não é renderizado).
//
// Caixa do alerta (alert-box-style.ts): cabeçalho com o LOGO OFICIAL à
// esquerda e "RISCO …" em negrito na mesma linha, cor/borda por grau de
// risco; título do evento logo abaixo do cabeçalho. Duas colunas em telas
// largas — conteúdo (~64%) e ações (~36%); estrutura em <table>+estilos
// inline (Gmail/Outlook); só o empilhamento mobile vem de <style>+@media.
export function buildContractAlertEmail(input: ContractAlertEmailInput): ContractAlertEmail {
  const subject = buildContractAlertSubject(input.projectName, input.severity);
  const tone = ALERT_TONES[input.severity];
  const riskLabel = alertRiskLevelLabels[input.severity];
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const logos = {
    maroon: input.hasInlineLogo,
    inverted: input.hasInlineInvertedLogo ?? input.hasInlineLogo,
  };
  const panel = panelStyle(input.severity);
  const font = `font-family:${ACC_FONT_FAMILY};`;

  const evidenceListHtml =
    input.keyEvidence.length > 0
      ? `<ul style="margin:4px 0 0 0;padding-left:16px;">${input.keyEvidence.map(evidenceItemHtml).join("")}</ul>`
      : `<span style="${font}color:${tone.dark ? ACC_COLOR_BODY : tone.text};font-size:${ACC_FONT_SIZE_BODY};">Nenhuma evidência vinculada nesta fase.</span>`;
  // Fundo escuro: a lista de evidências (cores próprias de texto escuro) vai
  // num painel branco, para continuar legível.
  const evidenceHtml = tone.dark ? `<div style="${panel}">${evidenceListHtml}</div>` : evidenceListHtml;

  const confrontationHtml = input.confrontationBlocks.map(confrontationBlockHtml).join("");

  const toneRow = (label: string, value: string | null): string => {
    if (!value) return "";
    return `
    <tr>
      <td style="padding:6px 0;color:${tone.text};${font}font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:6px 0 6px 12px;color:${tone.text};${font}font-size:${ACC_FONT_SIZE_BODY};word-break:break-word;">${escapeHtml(value)}</td>
    </tr>`;
  };

  const repeatHtml = input.repeatNotice
    ? `<p style="margin:12px 0 0 0;${font}font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;color:${tone.text};">${escapeHtml(repeatNoticeText(input.severity))}</p>`
    : "";

  const criticalSentenceHtml =
    input.severity === "CRITICA"
      ? `<p style="margin:0 0 12px 0;${font}font-size:${ACC_FONT_SIZE_AUX};color:${tone.text};">Atraso contratual com baixa probabilidade de recuperação</p>`
      : "";

  const actionsColumnHtml = `${buildOpenEventButtonHtml(input.eventUrl, input.severity)}${renderEmailActionButtonsHtml(input.actionButtons, input.summary, tone.dark ? tone.muted : undefined)}`;

  const boxInner = `
    ${buildAlertHeaderHtml(input.severity, riskLabel, logos)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
      <tr>
        <td class="acc-content-col" valign="top" width="64%" style="width:64%;padding:0 24px 0 0;word-break:break-word;color:${tone.text};">
          <h1 style="margin:0 0 4px 0;${font}color:${tone.text};font-size:${ACC_FONT_SIZE_TITLE};word-break:break-word;">${escapeHtml(input.title)}</h1>
          <p style="margin:0 0 12px 0;${font}color:${tone.text};font-size:${ACC_FONT_SIZE_BODY};">Obra: <strong>${escapeHtml(input.projectName)}</strong></p>
          ${criticalSentenceHtml}
          <p style="margin:0 0 16px 0;${font}color:${tone.text};font-size:${ACC_FONT_SIZE_BODY};">${escapeHtml(input.summary)}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${toneRow("Evento relacionado", input.relatedEventTitle)}
            ${toneRow("Base contratual", input.contractualBasis)}
            ${toneRow("Impacto potencial", input.potentialImpact)}
            ${toneRow("Ação recomendada", input.recommendedAction)}
            ${toneRow("Prazo", input.dueDate)}
          </table>

          ${confrontationHtml}

          <p style="margin:16px 0 6px 0;${font}font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;color:${tone.text};">Evidências principais</p>
          ${evidenceHtml}
          ${repeatHtml}
        </td>
        <td class="acc-actions-col" valign="top" width="36%" style="width:36%;padding:0 0 0 4px;border-left:1px solid ${tone.dark ? "#ffffff" : "#e5e7eb"};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 0 8px 20px;">
                <p style="margin:0;${font}font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;color:${tone.text};">Ações disponíveis</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 0 20px;">
                ${actionsColumnHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;

  const html = `
<style>
  @media only screen and (max-width:640px) {
    .acc-content-col, .acc-actions-col { display:block !important; width:100% !important; }
    .acc-content-col { padding:0 !important; }
    .acc-actions-col { padding:20px 0 0 0 !important; border-left:none !important; border-top:1px solid ${tone.dark ? "#ffffff" : "#e5e7eb"} !important; }
  }
  .acc-open-event-btn:hover { background-color:${tone.dark ? "#f3f4f6" : "#5c1616"} !important; }
  .${ACC_ACTION_BUTTON_CLASS}:hover { background-color:${ACC_COLOR_HEADING} !important; color:#ffffff !important; }
</style>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="820" cellpadding="0" cellspacing="0" style="width:100%;max-width:820px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px 12px 24px;">
            <p style="margin:0;${font}color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">${escapeHtml(greeting)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px 24px;">
            ${buildAlertBoxHtml(input.severity, boxInner)}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;${font}color:${ACC_COLOR_MUTED};font-size:${ACC_FONT_SIZE_AUX};">
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
    textRow("Prazo", input.dueDate),
  ].filter((row) => row !== "");

  const text = [
    `ACC - AXION Controle de Contratos`,
    `RISCO ${riskLabel}`,
    ...(input.severity === "CRITICA" ? ["Atraso contratual com baixa probabilidade de recuperação"] : []),
    "",
    greeting,
    input.title,
    `Obra: ${input.projectName}`,
    "",
    input.summary,
    ...(fieldRows.length > 0 ? ["", ...fieldRows] : []),
    ...(input.confrontationBlocks.length > 0 ? ["", ...input.confrontationBlocks.map(confrontationBlockText)] : []),
    "",
    "Evidências principais:",
    input.keyEvidence.length > 0 ? input.keyEvidence.map(evidenceItemText).join("\n") : "Nenhuma evidência vinculada nesta fase.",
    ...(input.repeatNotice ? ["", repeatNoticeText(input.severity)] : []),
    "",
    `Abrir evento no ACC: ${input.eventUrl}`,
    ...(input.actionButtons.length > 0 ? ["", "Ações disponíveis:", renderEmailActionButtonsText(input.actionButtons)] : []),
    "",
    "Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.",
  ].join("\n");

  return { subject, html, text };
}
