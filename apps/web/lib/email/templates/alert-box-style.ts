// Puro, sem I/O — deliberadamente sem "server-only" (testável por script Node).
//
// Identidade visual da CAIXA de cada alerta (e-mail individual e de lote):
// cor de fundo/borda/texto por grau de risco, cabeçalho (logo oficial à
// esquerda + classificação em negrito na MESMA linha, centralizada na área
// de texto) e os botões compactos de ação.
//
// Decisão de produto (substitui orientações visuais anteriores):
//   CRÍTICO : fundo vermelho,                 texto branco, logo invertido
//   ALTO    : fundo amarelo escuro,           texto branco, logo invertido
//   MÉDIO   : fundo branco,                   texto preto,  logo vinho
//   BAIXO   : fundo branco,                   texto preto,  logo vinho
//   Borda contínua de 2px: tom mais escuro que o fundo nos coloridos,
//   cinza médio nos brancos.
//
// BADGE_STYLES (contract-alert-template.ts) NÃO é alterado: continua sendo
// usado pelos demais e-mails (SLA, alertas de risco) que não fazem parte
// desta definição.

import type { AlertSeverity } from "@axion/types";

import { ACC_EMAIL_LOGO_CID, ACC_EMAIL_LOGO_INVERTED_CID } from "@/lib/email/branding/acc-email-signature";
import { ACC_FONT_FAMILY, ACC_FONT_SIZE_TITLE } from "@/lib/email/brand-style";

export type LogoVariant = "inverted" | "maroon";

export interface AlertTone {
  background: string;
  border: string;
  /** Texto principal (título, resumo, rótulos) diretamente sobre o fundo da caixa. */
  text: string;
  /** Texto secundário diretamente sobre o fundo da caixa. */
  muted: string;
  /** Cor de links diretamente sobre o fundo da caixa. */
  link: string;
  /** Cor da classificação "RISCO …" no cabeçalho. */
  label: string;
  logo: LogoVariant;
  /** Fundo escuro: blocos internos de detalhe viram painéis brancos. */
  dark: boolean;
}

// Amarelo de atenção ESCURO para ALTO — Tailwind yellow-700. Texto branco
// sobre ele: ver contrastRatio() e o teste (≥ 4,5:1, WCAG AA para texto normal).
export const ALTO_BACKGROUND = "#A16207";
export const ALTO_BORDER = "#713F12"; // yellow-900, mais escuro que o fundo
export const CRITICO_BACKGROUND = "#DC2626";
export const CRITICO_BORDER = "#991B1B"; // red-800, mais escuro que o fundo
export const NEUTRAL_BORDER = "#9CA3AF"; // cinza médio (gray-400)

export const ALERT_TONES: Record<AlertSeverity, AlertTone> = {
  CRITICA: {
    background: CRITICO_BACKGROUND,
    border: CRITICO_BORDER,
    text: "#FFFFFF",
    muted: "#FFFFFF",
    link: "#FFFFFF",
    label: "#FFFFFF",
    logo: "inverted",
    dark: true,
  },
  ALTA: {
    background: ALTO_BACKGROUND,
    border: ALTO_BORDER,
    text: "#FFFFFF",
    muted: "#FFFFFF",
    link: "#FFFFFF",
    label: "#FFFFFF",
    logo: "inverted",
    dark: true,
  },
  MEDIA: {
    background: "#FFFFFF",
    border: NEUTRAL_BORDER,
    text: "#000000",
    muted: "#374151",
    link: "#7F1D1D",
    label: "#000000",
    logo: "maroon",
    dark: false,
  },
  BAIXA: {
    background: "#FFFFFF",
    border: NEUTRAL_BORDER,
    text: "#000000",
    muted: "#374151",
    link: "#7F1D1D",
    label: "#000000",
    logo: "maroon",
    dark: false,
  },
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

// ---------- logo / cabeçalho ----------

// Logo oficial 44px (quadrado). Mantém proporção 1:1 do arquivo oficial —
// width E height fixos iguais, nunca só um deles.
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
 * Cabeçalho da caixa: logo oficial à ESQUERDA e "RISCO …" na MESMA linha,
 * em negrito, centralizado vertical (valign=middle nas duas células) e
 * horizontalmente na área de texto (a célula do texto ocupa todo o espaço
 * restante e tem text-align:center — o logo não se desloca). Sem selo
 * arredondado. Sem flexbox (Gmail/Outlook).
 */
export function buildAlertHeaderHtml(
  severity: AlertSeverity,
  riskWord: string,
  logos: AlertLogoAvailability
): string {
  const tone = ALERT_TONES[severity];
  const hasLogo = tone.logo === "inverted" ? logos.inverted : logos.maroon;
  const size = ALERT_LOGO_SIZE_PX;

  const logoCell = hasLogo
    ? `<td class="acc-box-logo" width="${size + 12}" valign="middle" style="width:${size + 12}px;vertical-align:middle;padding:0 12px 0 0;"><img src="cid:${logoCidFor(tone.logo)}" alt="ACC" width="${size}" height="${size}" style="display:block;border:0;width:${size}px;height:${size}px;" /></td>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${logoCell}<td class="acc-box-risk" valign="middle" align="center" style="vertical-align:middle;text-align:center;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_TITLE};line-height:28px;font-weight:bold;letter-spacing:0.05em;color:${tone.label};">RISCO ${escapeAttr(riskWord)}</td></tr></table>`;
}

// ---------- caixa ----------

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

// ---------- botões ----------

export const BUTTON_FONT_SIZE_PX = 12;
// Largura do texto "EM ANDAMENTO" em Arial negrito 12px MEDIDA NO HTML
// RENDERIZADO (Chrome, escala 1x, Range.getBoundingClientRect): 93px.
// Largura do botão = texto + 12px à esquerda + 12px à direita = 117px.
// Observação: a métrica tipográfica sem hinting (canvas/FreeType) dá ~98,7px;
// clientes que renderizam nessa métrica ficam com ~9px de folga lateral em vez
// de 12px — nunca cortam o texto (nowrap, largura fixa maior que o texto).
export const EM_ANDAMENTO_TEXT_WIDTH_PX = 93;
export const BUTTON_SIDE_PADDING_PX = 12;
export const BUTTON_WIDTH_PX = Math.ceil(EM_ANDAMENTO_TEXT_WIDTH_PX + 2 * BUTTON_SIDE_PADDING_PX); // 117
export const BUTTON_HEIGHT_PX = 32;

export interface AlertActionButtonStyle {
  background: string;
  color: string;
  label: string;
}

/**
 * Botão compacto de largura/altura FIXAS e iguais para todos. Estrutura
 * <table width=W><td width=W height=H bgcolor> + <a display:block width:W
 * height:H line-height:H> — sem padding horizontal, sem min-width e sem
 * largura 100%: nada herdado consegue alargá-lo. Centralizado na coluna.
 */
export function buildCompactButtonHtml(
  href: string,
  style: AlertActionButtonStyle,
  title: string,
  isFirst: boolean
): string {
  const w = BUTTON_WIDTH_PX;
  const h = BUTTON_HEIGHT_PX;
  return `<table class="acc-compact-btn" role="presentation" align="center" width="${w}" cellpadding="0" cellspacing="0" style="width:${w}px;margin:${isFirst ? "0" : "8px"} auto 0 auto;border-collapse:separate;"><tr><td width="${w}" height="${h}" align="center" bgcolor="${style.background}" style="width:${w}px;height:${h}px;background-color:${style.background};border-radius:6px;text-align:center;"><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(title)}" aria-label="${escapeAttr(`${style.label} — ${title}`)}" style="display:block;width:${w}px;height:${h}px;line-height:${h}px;margin:0;padding:0;color:${style.color};font-family:${ACC_FONT_FAMILY};font-size:${BUTTON_FONT_SIZE_PX}px;font-weight:bold;text-decoration:none;text-align:center;white-space:nowrap;overflow:hidden;">${escapeAttr(style.label)}</a></td></tr></table>`;
}

