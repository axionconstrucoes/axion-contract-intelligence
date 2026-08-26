// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// Único lugar que sabe desenhar os botões/links de ação de e-mail —
// contract-alert-template.ts, sla-escalation-template.ts e o corpo de
// texto de action-request-notification-core.ts chamam estas duas
// funções (HTML e texto) em vez de montar o markup cada um por conta
// própria. Mesmo estilo visual dos botões "Abrir evento no ACC" /
// "RESPONDER AO ACC" já existentes nos templates (cor sólida escura
// para o botão primário, contorno para os demais) — nunca um segundo
// estilo de botão convivendo com o antigo.
import { EMAIL_ALERT_ACTION_LABELS, type EmailAlertActionType } from "./types";

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

// HTML dos botões de ação — chamado depois do botão "Abrir X no ACC" já
// existente em cada template (nunca o substitui: abrir o registro no
// ACC continua uma ação neutra e sempre disponível, sem token).
export function renderEmailActionButtonsHtml(buttons: EmailActionButton[]): string {
  if (buttons.length === 0) return "";

  return buttons
    .map(
      (button, index) => `<a href="${escapeHtml(button.url)}" style="display:inline-block;margin:${
        index === 0 ? "0" : "8px 0 0 0"
      } 8px 0 0;padding:10px 18px;background-color:#ffffff;color:#111827;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;border:1px solid #111827;">${escapeHtml(
        EMAIL_ALERT_ACTION_LABELS[button.action]
      )}</a>`
    )
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
