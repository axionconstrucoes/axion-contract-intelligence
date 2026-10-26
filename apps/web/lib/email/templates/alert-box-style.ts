// Puro, sem I/O — deliberadamente sem "server-only" (testável por script Node).
//
// Identidade visual da CAIXA de cada alerta (e-mail individual e de lote):
// cor de fundo/borda/texto por grau de risco, cabeçalho (logo oficial à esquerda +
// "RISCO [NÍVEL] | [OBRA]" em negrito na MESMA linha, centralizado na área de texto), tipografia
// única e coluna branca com os três botões de ação.
//
// Decisão de produto (substitui orientações visuais anteriores):
//   CRÍTICO : fundo VERMELHO forte,           texto branco, logo invertido
//   ALTO    : fundo AMARELO forte,            texto preto,  logo vinho
//   MÉDIO   : fundo branco,                   texto preto,  logo vinho
//   BAIXO   : fundo branco,                   texto preto,  logo vinho
//   Borda contínua de 2px: tom mais escuro que o fundo nos coloridos, cinza médio nos brancos.
//   UM único tamanho de fonte em todo o alerta (14px); só o PESO diferencia: título "black",
//   cabeçalho/cláusula/evidência/"Repete" em negrito, descrição em regular.
//
// BADGE_STYLES (contract-alert-template.ts) NÃO é alterado: continua sendo usado pelos demais
// e-mails (SLA, alertas de risco) que não fazem parte desta definição.

import type { AlertSeverity } from "@axion/types";

import { ACC_EMAIL_LOGO_CID, ACC_EMAIL_LOGO_INVERTED_CID } from "@/lib/email/branding/acc-email-signature";
import { ACC_FONT_FAMILY } from "@/lib/email/brand-style";

export type LogoVariant = "inverted" | "maroon";

export interface AlertTone {
  background: string;
  border: string;
  /** Texto principal (título, descrição, cláusula, evidência) diretamente sobre o fundo da caixa. */
  text: string;
  /** Texto secundário diretamente sobre o fundo da caixa. */
  muted: string;
  /** Cor de links diretamente sobre o fundo da caixa. */
  link: string;
  /** Cor do cabeçalho "RISCO … | OBRA". */
  label: string;
  logo: LogoVariant;
  /** Fundo escuro: blocos internos de detalhe viram painéis brancos. */
  dark: boolean;
}

// Semáforo de trânsito: vermelho forte (texto branco) e amarelo forte (texto preto). Contrastes
// verificados por contrastRatio() no teste (≥ 4,5:1, WCAG AA para texto normal).
export const ALTO_BACKGROUND = "#FFC700";
export const ALTO_BORDER = "#8A6A00"; // amarelo-ouro escuro, mais escuro que o fundo
export const CRITICO_BACKGROUND = "#CC0000";
export const CRITICO_BORDER = "#7F0000"; // mais escuro que o fundo
export const NEUTRAL_BORDER = "#9CA3AF"; // cinza médio (gray-400)

export const ALERT_TONES: Record<AlertSeverity, AlertTone> = {
  CRITICA: { background: CRITICO_BACKGROUND, border: CRITICO_BORDER, text: "#FFFFFF", muted: "#FFFFFF", link: "#FFFFFF", label: "#FFFFFF", logo: "inverted", dark: true },
  ALTA: { background: ALTO_BACKGROUND, border: ALTO_BORDER, text: "#000000", muted: "#000000", link: "#000000", label: "#000000", logo: "maroon", dark: false },
  MEDIA: { background: "#FFFFFF", border: NEUTRAL_BORDER, text: "#000000", muted: "#374151", link: "#000000", label: "#000000", logo: "maroon", dark: false },
  BAIXA: { background: "#FFFFFF", border: NEUTRAL_BORDER, text: "#000000", muted: "#374151", link: "#000000", label: "#000000", logo: "maroon", dark: false },
};

// ---------- contraste (WCAG 2.x) ----------

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const a = relativeLuminance(foregroundHex);
  const b = relativeLuminance(backgroundHex);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

// ---------- tipografia ÚNICA ----------

/** Tamanho de fonte único de todo texto do alerta (cabeçalho, título, descrição, cláusula, evidência, "Repete", botões). */
export const ALERT_FONT_SIZE = "14px";
export const ALERT_LINE_HEIGHT = "20px";

/** Corpo MAIOR (cabeçalho "RISCO … | OBRA" e título do alerta); o restante segue em 14px. */
export const ALERT_EMPHASIS_FONT_SIZE = "16px";
export const ALERT_EMPHASIS_LINE_HEIGHT = "22px";

/** Família "black" só para o título (Arial Black onde existir; cai para Arial negrito). */
// Aspas SIMPLES: o valor vai dentro de style="..." (aspas duplas quebrariam o atributo).
export const ALERT_TITLE_FONT_FAMILY = `'Arial Black', ${ACC_FONT_FAMILY}`;

export const WEIGHT = { regular: 400, bold: 700, black: 900 } as const;

/** Estilo base inline de qualquer texto do alerta (mesmo tamanho; muda só o peso). */
export function textStyle(weight: keyof typeof WEIGHT, color: string, extra = "", emphasis = false): string {
  const family = weight === "black" ? ALERT_TITLE_FONT_FAMILY : ACC_FONT_FAMILY;
  const size = emphasis ? ALERT_EMPHASIS_FONT_SIZE : ALERT_FONT_SIZE;
  const line = emphasis ? ALERT_EMPHASIS_LINE_HEIGHT : ALERT_LINE_HEIGHT;
  return `font-family:${family};font-size:${size};line-height:${line};font-weight:${WEIGHT[weight]};color:${color};${extra}`;
}

// ---------- logo / cabeçalho ----------

// Logo oficial 44px (quadrado). Mantém proporção 1:1 do arquivo oficial.
export const ALERT_LOGO_SIZE_PX = 44;

export function logoCidFor(variant: LogoVariant): string {
  return variant === "inverted" ? ACC_EMAIL_LOGO_INVERTED_CID : ACC_EMAIL_LOGO_CID;
}

export interface AlertLogoAvailability {
  /** Logo vinho (oficial) disponível como imagem embutida nesta execução. */
  maroon: boolean;
  /** Logo invertido (derivado do oficial) disponível nesta execução. */
  inverted: boolean;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Cabeçalho da caixa: logo oficial à ESQUERDA e "RISCO [NÍVEL] | [OBRA]" na MESMA linha, em
 * negrito, centralizado vertical (valign=middle nas duas células) e horizontalmente na área de
 * texto. A obra é a do PRÓPRIO alerta (um lote pode reunir alertas de obras diferentes). Nomes
 * longos quebram linha dentro da célula, sem sobrepor o logo. Sem flexbox (Gmail/Outlook).
 */
export function buildAlertHeaderHtml(
  severity: AlertSeverity,
  riskWord: string,
  projectName: string,
  logos: AlertLogoAvailability
): string {
  const tone = ALERT_TONES[severity];
  const hasLogo = tone.logo === "inverted" ? logos.inverted : logos.maroon;
  const size = ALERT_LOGO_SIZE_PX;

  const logoCell = hasLogo
    ? `<td class="acc-box-logo" width="${size + 12}" valign="middle" style="width:${size + 12}px;vertical-align:middle;padding:0 12px 0 0;"><img src="cid:${logoCidFor(tone.logo)}" alt="ACC" width="${size}" height="${size}" style="display:block;border:0;width:${size}px;height:${size}px;" /></td>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${logoCell}<td class="acc-box-risk" valign="middle" align="center" style="vertical-align:middle;text-align:center;${textStyle("bold", tone.label, "letter-spacing:0.03em;word-break:break-word;overflow-wrap:anywhere;", true)}">RISCO ${escapeAttr(riskWord)} | ${escapeAttr(projectName)}</td></tr></table>`;
}

// ---------- caixa ----------

/** Espaço visível entre a linha logo/risco e o primeiro texto abaixo. */
export const HEADER_GAP_PX = 18;

/** Caixa individual de UM alerta: borda contínua de 2px, cantos arredondados. */
export function buildAlertBoxHtml(severity: AlertSeverity, innerHtml: string): string {
  const tone = ALERT_TONES[severity];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${tone.background}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${tone.background};border:2px solid ${tone.border};border-radius:8px;"><tr><td style="padding:16px 18px;">${innerHtml}</td></tr></table>`;
}

/** Painel interno branco usado nos blocos de detalhe quando o fundo da caixa é escuro. */
export function panelStyle(severity: AlertSeverity): string {
  return ALERT_TONES[severity].dark
    ? "background-color:#ffffff;color:#111111;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;"
    : "";
}

// ---------- botões (RESOLVIDO / EM ANDAMENTO / ENVIADO P/) ----------

export const BUTTON_FONT_SIZE_PX = 14;
// Largura do texto "EM ANDAMENTO" em Arial negrito 14px MEDIDA NO HTML RENDERIZADO (Chrome,
// escala 1x, getBoundingClientRect): 114px. Largura do botão = texto + 12px de cada lado = 138px.
// Observação: a métrica sem hinting pode diferir ~1–5%; a folga lateral varia um pouco, sem cortar
// o texto (nowrap, largura fixa maior que o texto).
export const EM_ANDAMENTO_TEXT_WIDTH_PX = 114;
export const BUTTON_SIDE_PADDING_PX = 12;
export const BUTTON_WIDTH_PX = Math.ceil(EM_ANDAMENTO_TEXT_WIDTH_PX + 2 * BUTTON_SIDE_PADDING_PX); // 138
export const BUTTON_HEIGHT_PX = 34;

/** Coluna branca dos botões: um pouco mais larga que os botões, com pequena margem lateral. */
export const BUTTON_COLUMN_MARGIN_PX = 8;
export const BUTTON_COLUMN_WIDTH_PX = BUTTON_WIDTH_PX + 2 * BUTTON_COLUMN_MARGIN_PX; // 154

export interface AlertActionButtonStyle {
  background: string;
  color: string;
  label: string;
}

/**
 * Botão compacto de largura/altura FIXAS e iguais para todos. Estrutura
 * <table width=W><td width=W height=H bgcolor> + <a display:block width:W height:H line-height:H>
 * — sem padding horizontal, sem min-width e sem largura 100%: nada herdado consegue alargá-lo.
 */
export function buildCompactButtonHtml(href: string, style: AlertActionButtonStyle, title: string, isFirst: boolean): string {
  const w = BUTTON_WIDTH_PX;
  const h = BUTTON_HEIGHT_PX;
  return `<table class="acc-compact-btn" role="presentation" align="center" width="${w}" cellpadding="0" cellspacing="0" style="width:${w}px;margin:${isFirst ? "0" : "8px"} auto 0 auto;border-collapse:separate;"><tr><td width="${w}" height="${h}" align="center" bgcolor="${style.background}" style="width:${w}px;height:${h}px;background-color:${style.background};border-radius:6px;text-align:center;"><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(title)}" aria-label="${escapeAttr(`${style.label} — ${title}`)}" style="display:block;width:${w}px;height:${h}px;line-height:${h}px;margin:0;padding:0;color:${style.color};font-family:${ACC_FONT_FAMILY};font-size:${BUTTON_FONT_SIZE_PX}px;font-weight:700;text-decoration:none;text-align:center;white-space:nowrap;overflow:hidden;">${escapeAttr(style.label)}</a></td></tr></table>`;
}

/** Cores e rótulos dos três botões (cores e funções preservadas do layout aprovado). */
export const ACTION_BUTTON_STYLES = {
  RESOLVIDO: { background: "#1B2A4A", color: "#ffffff", label: "RESOLVIDO" },
  EM_ANDAMENTO: { background: "#15803D", color: "#ffffff", label: "EM ANDAMENTO" },
  ENVIADO_PARA: { background: "#F97316", color: "#ffffff", label: "ENVIADO P/" },
} as const;

export type ThreeActions = "RESOLVIDO" | "EM_ANDAMENTO" | "ENVIADO_PARA";

const ACTION_TITLES: Record<ThreeActions, string> = {
  RESOLVIDO: "Abre a confirmação de RESOLVIDO — nada é registrado até você confirmar.",
  EM_ANDAMENTO: "Abre a confirmação de EM ANDAMENTO — nada é registrado até você confirmar.",
  ENVIADO_PARA: "Abre a confirmação de ENVIADO P/ com a lista de colaboradores — nada é registrado até você confirmar.",
};

/** Os três botões, na ordem RESOLVIDO / EM ANDAMENTO / ENVIADO P/. */
export function buildThreeActionButtonsHtml(urlFor: (action: ThreeActions) => string): string {
  return (["RESOLVIDO", "EM_ANDAMENTO", "ENVIADO_PARA"] as const)
    .map((action, index) => buildCompactButtonHtml(urlFor(action), ACTION_BUTTON_STYLES[action], ACTION_TITLES[action], index === 0))
    .join("");
}

/**
 * Link "CONSULTAR IA" acima dos três botões. É um LINK para a página de consulta no ACC (login,
 * autorização e vínculo com a obra são verificados lá); o e-mail nunca abre uma caixa interativa.
 * Visual distinto dos botões de ação (contorno vinho sobre branco) e mesma largura.
 */
export function buildConsultAiHtml(href: string): string {
  const w = BUTTON_WIDTH_PX;
  return `<table class="acc-consult-ai" role="presentation" align="center" width="${w}" cellpadding="0" cellspacing="0" style="width:${w}px;margin:0 auto;border-collapse:separate;"><tr><td width="${w}" height="${BUTTON_HEIGHT_PX}" align="center" bgcolor="#FFFFFF" style="width:${w}px;height:${BUTTON_HEIGHT_PX}px;background-color:#FFFFFF;border:2px solid #7F1D1D;border-radius:6px;text-align:center;"><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" title="Abre a consulta a especialistas de IA no ACC — a consulta não altera o alerta." aria-label="CONSULTAR IA — abre no ACC" style="display:block;width:${w - 4}px;line-height:${BUTTON_HEIGHT_PX - 4}px;margin:0;padding:0;color:#7F1D1D;font-family:${ACC_FONT_FAMILY};font-size:${BUTTON_FONT_SIZE_PX}px;font-weight:700;text-decoration:none;text-align:center;white-space:nowrap;overflow:hidden;">&#10022; CONSULTAR IA</a></td></tr></table>`;
}

/** Coluna BRANCA dos botões (largura = botões + pequena margem lateral), centralizada. */
export function buildActionsPanelHtml(innerHtml: string, consultAiHref?: string | null): string {
  const w = BUTTON_COLUMN_WIDTH_PX;
  const pad = BUTTON_COLUMN_MARGIN_PX;
  const consultWrap = consultAiHref
    ? `<div class="acc-consult-wrap" style="margin:0 0 ${pad}px 0;text-align:center;">${buildConsultAiHtml(consultAiHref)}</div>`
    : "";
  return `<table class="acc-actions-panel" role="presentation" align="center" width="${w}" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="width:${w}px;border-collapse:separate;background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;margin:0 auto;"><tr><td class="acc-panel-cell" align="center" valign="middle" style="padding:${pad}px;text-align:center;">${consultWrap}<div class="acc-buttons-wrap" style="text-align:center;">${innerHtml}</div></td></tr></table>`;
}

/**
 * CSS responsivo comum aos e-mails de alerta (individual e lote). No celular a coluna de ações vai para
 * BAIXO do conteúdo (nunca o cobre) e o CONSULTAR IA fica AO LADO dos três botões, com áreas de toque
 * de 44px (inline-block, sem flex/grid). Sem suporte a <style> no cliente, vale o layout vertical padrão.
 */
export const ALERT_MOBILE_CSS = `
    .acc-actions-panel { width:100% !important; }
    .acc-consult-wrap, .acc-buttons-wrap { display:inline-block !important; vertical-align:middle !important; box-sizing:border-box !important; margin:0 !important; }
    .acc-consult-wrap { width:43% !important; padding:0 4px !important; }
    .acc-buttons-wrap { width:55% !important; padding:0 4px !important; }
    .acc-consult-ai { width:100% !important; max-width:138px !important; }
    .acc-consult-ai td { height:48px !important; width:auto !important; }
    .acc-consult-ai a { height:44px !important; line-height:44px !important; width:auto !important; font-size:12px !important; }
    .acc-compact-btn td { height:44px !important; }
    .acc-compact-btn a { height:44px !important; line-height:44px !important; }`;
