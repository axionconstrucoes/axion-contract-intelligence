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
} from "@/lib/email/brand-style";
import { repeatNoticeText } from "@/lib/alerts/repeat-policy";
import type { ContractConfrontationBlock } from "@/lib/email/build-confrontation-block";
import {
  ALERT_TONES,
  BUTTON_COLUMN_WIDTH_PX,
  HEADER_GAP_PX,
  ALERT_MOBILE_CSS,
  buildActionsPanelHtml,
  buildAlertBoxHtml,
  buildAlertHeaderHtml,
  buildThreeActionButtonsHtml,
  textStyle,
  type ThreeActions,
} from "@/lib/email/templates/alert-box-style";
import {
  alertClauseHtml,
  alertClauseText,
  alertConfrontationHtml,
  alertDescriptionHtml,
  alertEvidenceHtml,
  alertEvidenceText,
  alertFieldRowHtml,
  alertRepeatHtml,
  alertTitleHtml,
} from "@/lib/email/templates/alert-body-parts";
import { EMAIL_ALERT_ACTION_LABELS } from "@/lib/email-actions/types";
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

// Assunto do e-mail INDIVIDUAL do envio manual (mesmo padrão do lote, para um único alerta):
//   crítico -> "[RISCO CRÍTICO] OBRA | ACC"; alto -> "[RISCO ALTO] OBRA | ACC";
//   médio/baixo -> "OBRA | ACC" (sem risco no assunto). O prefixo do modo piloto NÃO é aplicado
// aqui: quem o coloca é applyPilotOutboundGuard, no momento do envio.
export function buildIndividualAlertSubject(projectName: string, severity: AlertSeverity): string {
  const prefix = severity === "CRITICA" ? "[RISCO CRÍTICO] " : severity === "ALTA" ? "[RISCO ALTO] " : "";
  return `${prefix}${projectName} | ACC`;
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
  // Links dos três botões (RESOLVIDO / EM ANDAMENTO / ENVIADO P/) — só informados quando há
  // acompanhamento válido (página de confirmação + follow-up). Sem eles, os botões por token
  // existentes (actionButtons) continuam como antes.
  quickActionUrls?: Record<ThreeActions, string> | null;
  /** Link "CONSULTAR IA" (página do ACC; lib/alerts/ai-consult-link.ts). */
  aiConsultUrl?: string | null;
  // Cláusula impactada VERIFICADA (número e título). undefined = derivar do confronto aprovado,
  // se houver; null/sem rótulo = "Cláusula: Pendente de confirmação".
  impactedClause?: { label: string | null; text?: string | null } | null;
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

// Constrói {subject, html, text} do padrão institucional de alerta contratual. Nunca inventa
// "prazo"/"ação recomendada" — quando o caller não tem essa informação real, o campo fica null e a
// linha simplesmente não aparece (nunca um placeholder fabricado).
//
// "Responsável" NÃO aparece no corpo do e-mail: quem recebe o alerta já é o destinatário. O
// responsável continua nos registros internos, no histórico e na tabela de providências
// (input.responsibleName é mantido só por compatibilidade e não é renderizado).
//
// Caixa do alerta (alert-box-style.ts): cabeçalho com o LOGO OFICIAL à esquerda e
// "RISCO [NÍVEL] | [OBRA]" em negrito na mesma linha; espaço visível; título do evento como LINK
// para o ACC; descrição; cláusula (número e título, sem cabeçalho) ou "Pendente de confirmação";
// evidência como link para a origem; "Repete". UM único tamanho de fonte; só o peso muda. Os três
// botões (RESOLVIDO / EM ANDAMENTO / ENVIADO P/) ficam numa coluna BRANCA estreita quando há
// acompanhamento válido (quickActionUrls); sem ele, o comportamento anterior (botões por token) é
// preservado. Estrutura em <table>+estilos inline (Gmail/Outlook).
export function buildContractAlertEmail(input: ContractAlertEmailInput): ContractAlertEmail {
  const subject = buildIndividualAlertSubject(input.projectName, input.severity);
  const tone = ALERT_TONES[input.severity];
  const riskLabel = alertRiskLevelLabels[input.severity];
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const logos = {
    maroon: input.hasInlineLogo,
    inverted: input.hasInlineInvertedLogo ?? input.hasInlineLogo,
  };

  const clause =
    input.impactedClause !== undefined
      ? input.impactedClause
      : input.confrontationBlocks[0]
        ? { label: `Cláusula ${input.confrontationBlocks[0].clauseNumber}`, text: null }
        : null;

  const quick = input.quickActionUrls ?? null;
  const tokenLinksHtml =
    quick && input.actionButtons.length > 0
      ? `<p style="margin:12px 0 0 0;${textStyle("regular", tone.text)}">Outras ações: ${input.actionButtons
          .map(
            (b) =>
              `<a href="${escapeHtml(b.url)}" style="${textStyle("regular", tone.link, "text-decoration:underline;")}">${escapeHtml(EMAIL_ALERT_ACTION_LABELS[b.action])}</a>`
          )
          .join(" · ")}</p>`
      : "";

  const rows = [
    alertFieldRowHtml("Evento relacionado", input.relatedEventTitle, input.severity),
    alertFieldRowHtml("Base contratual", input.contractualBasis, input.severity),
    alertFieldRowHtml("Impacto potencial", input.potentialImpact, input.severity),
    alertFieldRowHtml("Ação recomendada", input.recommendedAction, input.severity),
    alertFieldRowHtml("Prazo", input.dueDate, input.severity),
  ].join("");

  const criticalSentence =
    input.severity === "CRITICA"
      ? `<p style="margin:0 0 12px 0;${textStyle("regular", tone.text)}">Atraso contratual com baixa probabilidade de recuperação</p>`
      : "";

  const contentHtml = `
          ${alertTitleHtml(input.title, input.eventUrl, input.severity)}
          ${alertDescriptionHtml(input.summary, input.severity)}
          ${criticalSentence}
          ${alertClauseHtml(clause, input.severity)}
          ${rows}
          ${input.confrontationBlocks.map((b) => alertConfrontationHtml(b, input.severity)).join("")}
          ${alertEvidenceHtml(input.keyEvidence, input.severity)}
          ${input.repeatNotice ? alertRepeatHtml(input.severity) : ""}
          ${tokenLinksHtml}`;

  // Coluna de ações: três botões numa coluna BRANCA estreita (acompanhamento válido) ou, sem ele,
  // a coluna anterior com os botões por token (preservada).
  let actionsColumnHtml = "";
  if (quick) {
    actionsColumnHtml = `<td class="acc-actions-col" valign="top" width="${BUTTON_COLUMN_WIDTH_PX}" style="width:${BUTTON_COLUMN_WIDTH_PX}px;padding:0 0 0 16px;">${buildActionsPanelHtml(buildThreeActionButtonsHtml((action) => quick[action]), input.aiConsultUrl)}</td>`;
  } else if (input.actionButtons.length > 0) {
    actionsColumnHtml = `<td class="acc-actions-col" valign="top" width="36%" style="width:36%;padding:0 0 0 16px;"><div style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;padding:8px;">${renderEmailActionButtonsHtml(input.actionButtons, input.summary, "#4B5563", "14px")}</div></td>`;
  }

  const boxInner = `
    ${buildAlertHeaderHtml(input.severity, riskLabel, input.projectName, logos)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${HEADER_GAP_PX}px;">
      <tr>
        <td class="acc-content-col" valign="top" style="padding:0;word-break:break-word;color:${tone.text};">${contentHtml}
        </td>
        ${actionsColumnHtml}
      </tr>
    </table>`;

  const html = `
<style>
  @media only screen and (max-width:640px) {
    .acc-content-col, .acc-actions-col { display:block !important; width:100% !important; }
    .acc-actions-col { padding:16px 0 0 0 !important; }${ALERT_MOBILE_CSS}
  }
  .${ACC_ACTION_BUTTON_CLASS}:hover { background-color:${ACC_COLOR_HEADING} !important; color:#ffffff !important; }
</style>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="820" cellpadding="0" cellspacing="0" style="width:100%;max-width:820px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px 12px 24px;">
            <p style="margin:0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">${escapeHtml(greeting)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px 24px;">
            ${buildAlertBoxHtml(input.severity, boxInner)}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_MUTED};font-size:${ACC_FONT_SIZE_AUX};">
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
    `RISCO ${riskLabel} | ${input.projectName}`,
    ...(input.severity === "CRITICA" ? ["Atraso contratual com baixa probabilidade de recuperação"] : []),
    "",
    greeting,
    `${input.title} — ${input.eventUrl}`,
    "",
    input.summary,
    "",
    alertClauseText(clause),
    ...(fieldRows.length > 0 ? ["", ...fieldRows] : []),
    ...(input.confrontationBlocks.length > 0 ? ["", ...input.confrontationBlocks.map(confrontationBlockText)] : []),
    "",
    alertEvidenceText(input.keyEvidence),
    ...(input.repeatNotice ? ["", repeatNoticeText(input.severity)] : []),
    ...(quick ? ["", "Ações:", `RESOLVIDO: ${quick.RESOLVIDO}`, `EM ANDAMENTO: ${quick.EM_ANDAMENTO}`, `ENVIADO P/: ${quick.ENVIADO_PARA}`] : []),
    ...(input.actionButtons.length > 0 ? ["", quick ? "Outras ações:" : "Ações disponíveis:", renderEmailActionButtonsText(input.actionButtons)] : []),
    "",
    "Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.",
  ].join("\n");

  return { subject, html, text };
}
