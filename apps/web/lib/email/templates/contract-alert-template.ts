// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.

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
import type { ContractConfrontationBlock } from "@/lib/email/build-confrontation-block";
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
// forte, exatamente como especificado. Indicador de STATUS, não hierarquia
// de texto — por isso não vem de brand-style.ts. Exportado para ser
// reaproveitado por sla-escalation-template.ts — nunca duplicado.
export const BADGE_STYLES: Record<AlertSeverity, BadgeStyle> = {
  BAIXA: { background: "#16a34a", color: "#ffffff" },
  MEDIA: { background: "#2563eb", color: "#ffffff" },
  ALTA: { background: "#f97316", color: "#ffffff" },
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
      <td style="padding:6px 0;color:${ACC_COLOR_BODY};font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:6px 0 6px 12px;color:${ACC_COLOR_BODY};font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};word-break:break-word;">${escapeHtml(value)}</td>
    </tr>`;
}

function textRow(label: string, value: string | null): string {
  if (!value) return "";
  return `${label}: ${value}`;
}

// Nunca inclui a locator/gmail://: cada evidência com metadados (EMAIL ou
// OTHER) sempre tem uma url HTTPS própria; string simples (compat) nunca
// vira link.
function evidenceItemHtml(item: ContractAlertEvidenceItem): string {
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

function evidenceItemText(item: ContractAlertEvidenceItem): string {
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
// sem qualquer botão de ação acionável emitido. Rótulo curto (Parte C.12):
// a explicação vai em title/aria-label + legenda discreta sempre visível
// abaixo, nunca dentro do próprio botão.
function buildOpenEventButtonHtml(eventUrl: string): string {
  const description = "Abre o evento completo no ACC.";
  const button = `<a href="${escapeHtml(eventUrl)}" title="${escapeHtml(description)}" aria-label="${escapeHtml(
    `Abrir evento no ACC — ${description}`
  )}" class="acc-open-event-btn" style="display:block;width:100%;box-sizing:border-box;margin:0;padding:10px 14px;background-color:${ACC_COLOR_HEADING};color:#ffffff;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;text-decoration:none;border-radius:6px;text-align:center;">Abrir evento no ACC</a>`;
  const caption = `<p style="margin:4px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_MUTED};text-align:center;">${escapeHtml(description)}</p>`;
  return `${button}${caption}`;
}

// Logo do e-mail 20% MAIOR que o tamanho renderizado anterior (32px):
// 32 * 1.2 = 38.4px — width/height do <img> ficam no inteiro mais
// próximo (38, exigido por muitos clientes de e-mail que ignoram
// atributos fracionários) e o style inline carrega o valor exato
// (38.4px) para quem respeita CSS. Nunca confundir com o logotipo da
// tela de login (30% maior, ajuste TOTALMENTE separado — ver
// apps/web/app/login/page.tsx).
const EMAIL_LOGO_PREVIOUS_SIZE_PX = 32;
const EMAIL_LOGO_GROWTH_FACTOR = 1.2;
const EMAIL_LOGO_EXACT_SIZE_PX = EMAIL_LOGO_PREVIOUS_SIZE_PX * EMAIL_LOGO_GROWTH_FACTOR;
const EMAIL_LOGO_ATTR_SIZE_PX = Math.round(EMAIL_LOGO_EXACT_SIZE_PX);

// Cabeçalho do e-mail — grau de RISCO à ESQUERDA, marca (logo + "ACC ·
// AXION CONTROLE DE CONTRATOS") à DIREITA, alinhados verticalmente na
// mesma linha. Requisito específico do E-MAIL — nunca a tela de login,
// que segue seu próprio ajuste separado (30%, centralizado, ver
// apps/web/app/login/page.tsx). Tabela de apresentação + estilos
// inline, sem flexbox (compatibilidade Gmail/Outlook). No mobile
// (<=640px), empilha risco acima da marca via a MESMA técnica de
// <style>+@media já usada para as duas colunas do corpo abaixo —
// nunca sobreposição nem rolagem horizontal.
function buildHeaderRowHtml(hasInlineLogo: boolean, riskLabel: string, badge: BadgeStyle): string {
  const logoCell = hasInlineLogo
    ? `<td style="vertical-align:middle;padding-right:8px;"><img src="cid:${ACC_EMAIL_LOGO_CID}" alt="ACC" width="${EMAIL_LOGO_ATTR_SIZE_PX}" height="${EMAIL_LOGO_ATTR_SIZE_PX}" style="display:block;border:0;width:${EMAIL_LOGO_EXACT_SIZE_PX}px;height:${EMAIL_LOGO_EXACT_SIZE_PX}px;" /></td>`
    : "";

  const riskBadgeHtml = `<span style="display:inline-block;background-color:${badge.background};color:${badge.color};font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;padding:6px 14px;border-radius:999px;">RISCO ${escapeHtml(riskLabel)}</span>`;

  const brandHtml = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${logoCell}<td style="vertical-align:middle;"><span style="font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};font-weight:bold;letter-spacing:0.04em;color:${ACC_COLOR_BODY};">ACC · AXION CONTROLE DE CONTRATOS</span></td></tr></table>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td class="acc-header-risk-col" valign="middle" align="left" style="vertical-align:middle;">${riskBadgeHtml}</td>
    <td class="acc-header-brand-col" valign="middle" align="right" style="vertical-align:middle;text-align:right;">${brandHtml}</td>
  </tr></table>`;
}

// Faixa de PERIGO exclusiva do risco CRÍTICO — mesma linguagem visual
// (amarelo #facc15 / preto) do aviso global "SISTEMA EM TESTE"
// (apps/web/components/layout/test-mode-banner.tsx: texto sobre placa
// preta sólida, nunca direto sobre a listra), mas NUNCA o mesmo texto —
// são dois elementos completamente separados (um é o selo de risco do
// alerta, o outro é o aviso de ambiente). Implementado com células de
// <table> com bgcolor (não CSS linear-gradient nem imagem): o suporte a
// bgcolor em <td> é praticamente universal em Gmail/Outlook, mais
// robusto aqui do que depender de gradient (que o Outlook desktop não
// renderiza) ou de uma imagem nova (que exigiria gerar um asset
// binário — fora do que este ambiente consegue produzir/validar de
// forma confiável). O <table> externo com bgcolor="#dc2626" (mesmo
// vermelho de BADGE_STYLES.CRITICA) funciona como o "fallback sólido
// em vermelho" pedido — aqui ele está sempre visível (não há imagem
// para bloquear), então a faixa listrada e o fallback vermelho
// coexistem na mesma peça, nunca dependem de uma imagem carregar.
// Nenhum Content-ID novo é criado (nenhuma imagem aqui) — o único CID
// do e-mail continua sendo o do logotipo, nunca duplicado.
function buildCriticalRiskBannerHtml(): string {
  const stripeColors = Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? "#facc15" : "#000000"));
  const stripeRowHtml = (heightPx: number) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${stripeColors
      .map(
        (color) =>
          `<td width="8.333%" bgcolor="${color}" style="width:8.333%;height:${heightPx}px;line-height:${heightPx}px;font-size:0;">&nbsp;</td>`
      )
      .join("")}</tr></table>`;

  return `<tr><td style="padding:0 24px 16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#dc2626" style="border-collapse:collapse;border-radius:6px;">
      <tr><td style="padding:0;line-height:0;font-size:0;">${stripeRowHtml(8)}</td></tr>
      <tr>
        <td bgcolor="#000000" style="padding:10px 16px;text-align:center;">
          <span style="font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;letter-spacing:0.06em;color:#facc15;">RISCO CRÍTICO</span>
        </td>
      </tr>
      <tr><td style="padding:0;line-height:0;font-size:0;">${stripeRowHtml(8)}</td></tr>
    </table>
    <p style="margin:8px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_BODY};text-align:center;">Atraso contratual com baixa probabilidade de recuperação</p>
  </td></tr>`;
}

// Constrói {subject, html, text} do padrão institucional de alerta
// contratual. Nunca inventa "responsável"/"prazo"/"ação recomendada" —
// quando o caller não tem essa informação real, o campo fica null e a
// linha correspondente simplesmente não aparece (nunca um placeholder
// fabricado tipo "A definir").
//
// Layout: duas colunas em telas largas — conteúdo à esquerda (~64%),
// coluna estreita de ações à direita (~36%), botões em pilha vertical de
// largura consistente. Estrutura principal em <table>+estilos inline
// (compatível com Gmail/Outlook); as únicas regras que não podem ser
// inline (empilhar as colunas em telas pequenas + hover dos botões) vêm de
// um <style>+@media no topo do HTML — Gmail aplica esse bloco mesmo sem
// <head>; clientes que ignoram @media/:hover (Outlook desktop) mantêm o
// layout de duas colunas e a aparência padrão dos botões, nunca quebram.
export function buildContractAlertEmail(input: ContractAlertEmailInput): ContractAlertEmail {
  const subject = buildContractAlertSubject(input.projectName, input.severity);
  const badge = BADGE_STYLES[input.severity];
  const riskLabel = alertRiskLevelLabels[input.severity];
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";

  const evidenceHtml =
    input.keyEvidence.length > 0
      ? `<ul style="margin:4px 0 0 0;padding-left:16px;">${input.keyEvidence.map(evidenceItemHtml).join("")}</ul>`
      : `<span style="font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">Nenhuma evidência vinculada nesta fase.</span>`;

  const confrontationHtml = input.confrontationBlocks.map(confrontationBlockHtml).join("");

  const actionsColumnHtml = `${buildOpenEventButtonHtml(input.eventUrl)}${renderEmailActionButtonsHtml(input.actionButtons)}`;

  const criticalBannerHtml = input.severity === "CRITICA" ? buildCriticalRiskBannerHtml() : "";

  const html = `
<style>
  @media only screen and (max-width:640px) {
    .acc-content-col, .acc-actions-col { display:block !important; width:100% !important; }
    .acc-actions-col { padding:20px 0 0 0 !important; border-left:none !important; border-top:1px solid #e5e7eb !important; }
    .acc-header-risk-col, .acc-header-brand-col { display:block !important; width:100% !important; text-align:left !important; }
    .acc-header-brand-col { padding-top:10px !important; text-align:left !important; }
    .acc-header-brand-col table { margin:0 !important; }
  }
  .acc-open-event-btn:hover { background-color:#5c1616 !important; }
  .${ACC_ACTION_BUTTON_CLASS}:hover { background-color:${ACC_COLOR_HEADING} !important; color:#ffffff !important; }
</style>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="820" cellpadding="0" cellspacing="0" style="width:100%;max-width:820px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px 16px 24px;">
            ${buildHeaderRowHtml(input.hasInlineLogo, riskLabel, badge)}
          </td>
        </tr>
        ${criticalBannerHtml}
        <tr>
          <td style="padding:0 24px 24px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td class="acc-content-col" valign="top" width="64%" style="width:64%;padding:0 24px 0 0;word-break:break-word;">
                  <p style="margin:0 0 12px 0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">${escapeHtml(greeting)}</p>
                  <h1 style="margin:0 0 4px 0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_HEADING};font-size:${ACC_FONT_SIZE_TITLE};word-break:break-word;">${escapeHtml(input.title)}</h1>
                  <p style="margin:0 0 16px 0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">Obra: <strong>${escapeHtml(input.projectName)}</strong></p>
                  <p style="margin:0 0 16px 0;font-family:${ACC_FONT_FAMILY};color:${ACC_COLOR_BODY};font-size:${ACC_FONT_SIZE_BODY};">${escapeHtml(input.summary)}</p>

                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${htmlRow("Evento relacionado", input.relatedEventTitle)}
                    ${htmlRow("Base contratual", input.contractualBasis)}
                    ${htmlRow("Impacto potencial", input.potentialImpact)}
                    ${htmlRow("Ação recomendada", input.recommendedAction)}
                    ${htmlRow("Responsável", input.responsibleName)}
                    ${htmlRow("Prazo", input.dueDate)}
                  </table>

                  ${confrontationHtml}

                  <p style="margin:16px 0 6px 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;color:${ACC_COLOR_HEADING};">Evidências principais</p>
                  ${evidenceHtml}
                </td>
                <td class="acc-actions-col" valign="top" width="36%" style="width:36%;padding:0 0 0 4px;border-left:1px solid #e5e7eb;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:0 0 8px 20px;">
                        <p style="margin:0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;color:${ACC_COLOR_HEADING};">Ações disponíveis</p>
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
            </table>
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
    textRow("Responsável", input.responsibleName),
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
    "",
    `Abrir evento no ACC: ${input.eventUrl}`,
    ...(input.actionButtons.length > 0 ? ["", "Ações disponíveis:", renderEmailActionButtonsText(input.actionButtons)] : []),
    "",
    "Este alerta é uma sugestão de análise automatizada e exige revisão humana — não é uma decisão contratual ou jurídica definitiva.",
  ].join("\n");

  return { subject, html, text };
}
