// Template puro do único resumo semanal de riscos MÉDIO e BAIXO.
// Formulários dentro de e-mail não são confiáveis entre clientes; por isso
// a mensagem contém um só botão para a tela autenticada que exige resposta
// de todos os itens.

export type WeeklyDigestRiskLevel = "MEDIUM" | "LOW";

export interface WeeklyAlertDigestItem {
  actionId: string;
  title: string;
  description: string;
  riskLevel: WeeklyDigestRiskLevel;
  dueAt: string | null;
}

export interface WeeklyAlertDigestEmailInput {
  recipientName: string | null;
  projectName: string;
  items: WeeklyAlertDigestItem[];
  responseUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const RISK = {
  MEDIUM: { label: "MÉDIO", color: "#ffffff", background: "#2563eb" },
  LOW: { label: "BAIXO", color: "#ffffff", background: "#16a34a" },
} as const;

export function sortWeeklyDigestItems(items: WeeklyAlertDigestItem[]): WeeklyAlertDigestItem[] {
  return [...items].sort((a, b) => {
    const byRisk = (a.riskLevel === "MEDIUM" ? 0 : 1) - (b.riskLevel === "MEDIUM" ? 0 : 1);
    if (byRisk !== 0) return byRisk;
    return a.title.localeCompare(b.title, "pt-BR");
  });
}

export function buildWeeklyAlertDigestEmail(input: WeeklyAlertDigestEmailInput) {
  const items = sortWeeklyDigestItems(input.items);
  const mediumCount = items.filter((item) => item.riskLevel === "MEDIUM").length;
  const lowCount = items.length - mediumCount;
  const greeting = input.recipientName ? `Olá, ${input.recipientName}.` : "Olá.";
  const subject = `🔵 [RESUMO SEMANAL] RISCOS MÉDIOS E BAIXOS · ACC · OBRA ${input.projectName.toUpperCase()}`;

  const htmlItems = items
    .map((item) => {
      const risk = RISK[item.riskLevel];
      return `
        <tr>
          <td style="padding:12px 0;border-top:1px solid #e5e7eb;vertical-align:top;">
            <span style="display:inline-block;background:${risk.background};color:${risk.color};font-size:11px;font-weight:bold;padding:4px 9px;border-radius:999px;">RISCO ${risk.label}</span>
          </td>
          <td style="padding:12px 0 12px 12px;border-top:1px solid #e5e7eb;vertical-align:top;">
            <strong style="color:#111827;font-size:14px;">${escapeHtml(item.title)}</strong>
            ${item.description ? `<div style="margin-top:3px;color:#4b5563;font-size:12px;">${escapeHtml(item.description)}</div>` : ""}
            ${item.dueAt ? `<div style="margin-top:3px;color:#6b7280;font-size:11px;">Prazo: ${escapeHtml(item.dueAt)}</div>` : ""}
          </td>
        </tr>`;
    })
    .join("");

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:20px 24px 8px;"><strong style="font-size:12px;color:#111827;">ACC · AXION CONTROLE DE CONTRATOS</strong></td></tr>
      <tr><td style="padding:8px 24px 4px;color:#111827;font-size:14px;">${escapeHtml(greeting)}</td></tr>
      <tr><td style="padding:4px 24px 12px;"><h1 style="margin:0;color:#111827;font-size:19px;">Resumo semanal — ${escapeHtml(input.projectName)}</h1></td></tr>
      <tr><td style="padding:0 24px 12px;color:#374151;font-size:13px;">
        ${mediumCount} risco(s) médio(s) e ${lowCount} risco(s) baixo(s). Todos precisam de uma resposta antes do envio.
      </td></tr>
      <tr><td style="padding:0 24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${htmlItems}</table>
      </td></tr>
      <tr><td style="padding:4px 24px 24px;">
        <a href="${escapeHtml(input.responseUrl)}" style="display:inline-block;padding:11px 18px;background:#7f1d1d;color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;">Responder todos os itens no ACC</a>
      </td></tr>
      <tr><td style="padding:14px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11px;">
        Opções disponíveis: Ciente, Estudando solução, Resolvido ou Direcionar para outra pessoa. O direcionamento não altera os prazos nem o escalonamento.
      </td></tr>
    </table>
  </td></tr>
</table>`.trim();

  const textItems = items.map((item, index) => {
    const risk = RISK[item.riskLevel];
    return `${index + 1}. [RISCO ${risk.label}] ${item.title}${item.description ? ` — ${item.description}` : ""}${item.dueAt ? ` — Prazo: ${item.dueAt}` : ""}`;
  });

  const text = [
    "ACC · AXION CONTROLE DE CONTRATOS",
    "",
    greeting,
    `Resumo semanal — ${input.projectName}`,
    `${mediumCount} risco(s) médio(s) e ${lowCount} risco(s) baixo(s).`,
    "",
    ...textItems,
    "",
    "Responda todos os itens no ACC:",
    input.responseUrl,
    "",
    "Opções: Ciente, Estudando solução, Resolvido ou Direcionar para outra pessoa.",
    "O direcionamento não altera os prazos nem o escalonamento.",
  ].join("\n");

  return { subject, html, text, mediumCount, lowCount };
}
