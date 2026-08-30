// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// Único lugar que sabe desenhar os botões/links de ação de e-mail —
// contract-alert-template.ts, sla-escalation-template.ts e o corpo de
// texto de action-request-notification-core.ts chamam estas duas
// funções (HTML e texto) em vez de montar o markup cada um por conta
// própria.
import { ACC_COLOR_BODY, ACC_COLOR_HEADING, ACC_COLOR_MUTED, ACC_FONT_FAMILY, ACC_FONT_SIZE_AUX, ACC_FONT_SIZE_BODY } from "@/lib/email/brand-style";
import { EMAIL_ALERT_ACTION_DESCRIPTIONS, EMAIL_ALERT_ACTION_LABELS, type EmailAlertActionType } from "./types";

export interface EmailActionButton {
  action: EmailAlertActionType;
  url: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Classe usada pelo <style>+:hover embutido no template que renderiza o
// botão (contract-alert-template.ts) — puramente decorativo/progressivo:
// Gmail/a maioria dos clientes aplicam o :hover, Outlook desktop ignora e
// o botão continua com a aparência padrão abaixo, sempre completa e
// legível por conta própria (nunca depende do hover para fazer sentido).
export const ACC_ACTION_BUTTON_CLASS = "acc-action-btn";

// HTML dos botões de ação — chamado depois do botão "Abrir X no ACC" já
// existente em cada template (nunca o substitui: abrir o registro no ACC
// continua uma ação neutra e sempre disponível, sem token).
//
// Cada botão é um único <a> de bloco, largura 100% do container (pensado
// para uma coluna de ações estreita e vertical — o chamador é responsável
// por essa coluna) — nunca inline-block lado a lado. O rótulo do botão
// fica CURTO (só o nome da ação, ex. "DAR CIÊNCIA") para não prejudicar a
// leitura; a explicação vai em title/aria-label (leitores de tela/clientes
// com tooltip) E como um parágrafo discreto e SEMPRE visível logo abaixo
// do botão — nunca dependente de hover, já que Gmail/Outlook não garantem
// suporte uniforme a ele. Continua exatamente 1 <a> por botão — mesma
// URL/token de sempre, nada de link extra.
export function renderEmailActionButtonsHtml(buttons: EmailActionButton[]): string {
  if (buttons.length === 0) return "";

  return buttons
    .map((button, index) => {
      const label = EMAIL_ALERT_ACTION_LABELS[button.action];
      const description = EMAIL_ALERT_ACTION_DESCRIPTIONS[button.action];
      const marginTop = index === 0 ? "0" : "12px";
      const buttonHtml = `<a href="${escapeHtml(button.url)}" title="${escapeHtml(description)}" aria-label="${escapeHtml(
        `${label} — ${description}`
      )}" class="${ACC_ACTION_BUTTON_CLASS}" style="display:block;width:100%;box-sizing:border-box;margin:${marginTop} 0 0 0;padding:10px 14px;background-color:#ffffff;color:${ACC_COLOR_BODY};font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_BODY};font-weight:bold;text-decoration:none;border-radius:6px;border:1px solid ${ACC_COLOR_HEADING};text-align:center;">${escapeHtml(
        label
      )}</a>`;
      const captionHtml = `<p style="margin:4px 0 0 0;font-family:${ACC_FONT_FAMILY};font-size:${ACC_FONT_SIZE_AUX};color:${ACC_COLOR_MUTED};text-align:center;">${escapeHtml(
        description
      )}</p>`;
      return `${buttonHtml}${captionHtml}`;
    })
    .join("");
}

// Equivalente em texto puro (rodapé de e-mails text-only, ex.:
// action-request-notification-core.ts, que hoje não envia HTML).
export function renderEmailActionButtonsText(buttons: EmailActionButton[]): string {
  if (buttons.length === 0) return "";

  return buttons
    .map((button) => `${EMAIL_ALERT_ACTION_LABELS[button.action]}: ${button.url}`)
    .join("\n");
}
